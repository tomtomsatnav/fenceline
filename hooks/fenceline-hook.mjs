#!/usr/bin/env node
// Claude Code hook entry point for Fenceline. SessionStart records the fences in force and the file list the map is drawn
// from; PreToolUse denies writes that cross a block-mode fence (the only time Fenceline steers the agent); PostToolUse
// records the trail and every crossing; Stop writes the summary and shows it to the user. No LLM call happens here.
// Any internal error is logged and the hook exits 0, so a Fenceline bug never stops the agent.
import fs from 'node:fs';
import path from 'node:path';
import { startSession, readMeta, readSnapshot, writeSnapshot, withLock, appendEvents, readEvents, sessionDir, rescan, listFiles, repoRoot, home } from '../src/session.mjs';
import { loadFences } from '../src/fences.mjs';
import { preDecision, postEvent, blockedEvent, summarize } from '../src/trail.mjs';

function fencesAt(cwd) {
  const root = repoRoot(cwd) || cwd;
  try { return loadFences(root).fences; } catch (e) { return { error: String(e.message || e) }; }
}

async function main() {
  let raw = ''; for await (const c of process.stdin) raw += c;
  if (process.env.FENCELINE_DISABLE === '1') return; // e.g. the compiler's own claude -p call
  const p = JSON.parse(raw || '{}');
  const id = p.session_id; if (!id) return;
  const ev = p.hook_event_name; const cwd = p.cwd || process.cwd();
  let meta = readMeta(id);
  if (!meta) {
    const fences = fencesAt(cwd);
    meta = startSession({ session_id: id, cwd, fences: Array.isArray(fences) ? fences : [] });
    const first = [{ kind: 'session', source: p.source ?? (ev === 'SessionStart' ? null : 'late-start') }];
    if (!Array.isArray(fences)) first.push({ kind: 'warning', warning: `fences not loaded: ${fences.error}` });
    withLock(id, () => appendEvents(id, first));
  } else if (ev === 'SessionStart') {
    withLock(id, () => appendEvents(id, [{ kind: 'session', source: p.source ?? null }]));
  }
  if (ev === 'SessionStart') return;
  const root = meta.repo;
  // fences are re-read on every event so /fenceline:fence takes effect at once; a change mid-session is recorded (and an
  // edit to the file is itself a crossing), so it is never silent
  let fences = meta.fences || [];
  const now = fencesAt(cwd);
  if (Array.isArray(now) && JSON.stringify(now) !== JSON.stringify(fences)) {
    fences = now;
    withLock(id, () => {
      const m = readMeta(id); m.fences = now; fs.writeFileSync(path.join(sessionDir(id), 'meta.json'), JSON.stringify(m, null, 2));
      appendEvents(id, [{ kind: 'fences', fences: now }]);
    });
  }
  const startedMs = Date.parse(meta.started_at);

  if (ev === 'PreToolUse') {
    const known = new Set(Object.keys(readSnapshot(id)));
    const d = preDecision(p, { root, cwd, fences, exists: (rel) => known.has(rel) || fs.existsSync(path.join(root, rel)),
      filesUnder: (rel) => [...known].filter((f) => f.startsWith(`${rel.replace(/\/$/, '')}/`)) });
    if (!d.deny) return;
    withLock(id, () => appendEvents(id, [blockedEvent(p, d, { now: Date.now(), startedMs })]));
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: d.reason } }));
    return;
  }

  if (ev === 'PostToolUse' || ev === 'PostToolUseFailure') {
    withLock(id, () => {
      const snapshot = readSnapshot(id); let changed = false;
      const e = postEvent(p, { root, cwd, fences, now: Date.now(), startedMs,
        rescan: (rels) => { const r = rescan(root, snapshot, rels); if (r.length) changed = true; return r; },
        allFiles: () => [...new Set([...Object.keys(snapshot), ...listFiles(root)])] });
      if (changed) writeSnapshot(id, snapshot);
      appendEvents(id, [e]);
    });
    return;
  }

  if (ev === 'Stop') {
    const message = p.last_assistant_message ?? '';
    const s = summarize(readEvents(id), message, { startedMs, now: Date.now() });
    fs.writeFileSync(path.join(sessionDir(id), 'summary.json'), JSON.stringify({ at: new Date().toISOString(), message, ...s }, null, 2));
    withLock(id, () => appendEvents(id, [{ kind: 'stop', elapsed_ms: s.duration_ms, crossing_count: s.crossings.length, unmentioned: s.unmentioned }]));
    // shown to the user, never to the agent; silent when no fences are set
    if (fences.length || s.crossings.length) process.stdout.write(JSON.stringify({ systemMessage: s.text }));
  }
}

main().catch((e) => { try { fs.mkdirSync(home(), { recursive: true }); fs.appendFileSync(path.join(home(), 'hook-errors.log'), `${new Date().toISOString()} ${String(e?.stack || e).slice(0, 2000)}\n`); } catch { /* nothing */ } }).finally(() => process.exit(0));
