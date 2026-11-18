#!/usr/bin/env node
// Claude Code hook entry point for Fenceline. SessionStart records the fences in force and the file list the map is drawn
// from; PreToolUse denies what crosses a block-mode fence (the only time Fenceline steers the agent); PostToolUse
// records the trail and every crossing; Stop shows the user what happened this turn. No LLM call happens here.
// Chaos mode (opt-in: .fenceline/chaos.json with enabled: true) injects deliberate, labelled test faults on calls the fences
// allow: a deny with a realistic error before the call, or wrong context after it.
// Any internal error is logged and the hook exits 0, so a Fenceline bug never stops the agent; a chaos-mode error means no fault.
import fs from 'node:fs';
import path from 'node:path';
import { startSession, readMeta, readSnapshot, writeSnapshot, withLock, appendEvents, readEvents, sessionDir, rescan, listFiles, repoRoot, home, readJson } from '../src/session.mjs';
import { loadFences } from '../src/fences.mjs';
import { matchAny } from '../src/glob.mjs';
import { preDecision, postEvent, blockedEvent, summarize, relPath } from '../src/trail.mjs';
import { loadChaos, chaosFile, isActive, decide, hookOutput, chaosEvent, configEvent, configSig, callPaths, CHAOS_FILE } from '../src/chaos.mjs';

const logError = (e) => { try { fs.mkdirSync(home(), { recursive: true }); fs.appendFileSync(path.join(home(), 'hook-errors.log'), `${new Date().toISOString()} ${String(e?.stack || e).slice(0, 2000)}\n`); } catch { /* nothing */ } };
const tryFences = (root) => { try { return loadFences(root).fences; } catch (e) { return { error: String(e.message || e) }; } };
// an ignored file is watched only if a deny fence names it (.env); an "only" fence would otherwise pull in every ignored file
const fencedBy = (fences) => (rel) => fences.some((f) => f.kind === 'deny' && matchAny(f.paths, rel) && !matchAny(f.except, rel));

/**
 * Chaos mode for one call and phase. Returns the hook output to print, or null. The config is re-read on every call like the
 * fences; a change (or an invalid file) is recorded once. Under the session lock (counters, flaky attempts, rate-limit
 * windows live in chaos-state.json). Throws only on a Fenceline error, which the caller turns into "no fault".
 */
function chaosStep(id, p, phase, { root, cwd, startedMs }) {
  const stFile = path.join(sessionDir(id), 'chaos-state.json');
  let cfg = null; let bad = null;
  try { cfg = loadChaos(root); } catch (e) { bad = String(e.message || e).slice(0, 500); }
  if (!cfg && !bad && !fs.existsSync(stFile)) return null; // chaos never configured in this session: the fast path, no lock
  return withLock(id, () => {
    const st = readJson(stFile, {}); const evs = []; let out = null;
    const sig = bad ? `invalid:${bad}` : configSig(cfg);
    if ((st.sig ?? 'none') !== sig) {
      evs.push(bad ? { kind: 'warning', warning: `chaos config not loaded, no faults injected: ${bad}` } : { ...configEvent(cfg, path.relative(root, chaosFile(root)) || CHAOS_FILE), ...(st.sig == null ? { initial: true } : {}) });
      st.sig = sig;
    }
    if (!bad && isActive(cfg)) {
      const now = Date.now(); const rel = (f) => relPath(root, p.cwd || cwd, f);
      if (phase === 'pre' && callPaths(p, rel).includes(CHAOS_FILE)) {
        // the agent may not read the test config: it would learn which errors are fake
        out = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Fenceline: ${CHAOS_FILE} is your user's test configuration. Do not read or change it.` } };
        evs.push({ kind: 'blocked', tool: p.tool_name, tool_use_id: p.tool_use_id ?? null, elapsed_ms: Math.max(0, now - startedMs), touches: [],
          crossings: [{ fence: 'fenceline-config', text: 'Fenceline\'s chaos-mode config: only you read it', mode: 'block', file: CHAOS_FILE, op: 'read', elapsed_ms: Math.max(0, now - startedMs), prevented: true }] });
      } else {
        const d = decide(p, cfg, st, { now, rel }, phase);
        if (d) { evs.push(chaosEvent(p, d, cfg, { now, startedMs, rel })); out = hookOutput(d); }
      }
    }
    fs.writeFileSync(stFile, JSON.stringify(st));
    if (evs.length) appendEvents(id, evs);
    return out;
  });
}
const tryChaos = (...a) => { try { return chaosStep(...a); } catch (e) { logError(e); return null; } };

async function main() {
  let raw = ''; for await (const c of process.stdin) raw += c;
  if (process.env.FENCELINE_DISABLE === '1') return; // e.g. the compiler's own claude -p call
  const p = JSON.parse(raw || '{}');
  const id = p.session_id; if (!id) return;
  const ev = p.hook_event_name; const cwd = p.cwd || process.cwd();
  let meta = readMeta(id);
  if (!meta) {
    const root = repoRoot(cwd) || cwd; const fences = tryFences(root); const ok = Array.isArray(fences) ? fences : [];
    meta = startSession({ session_id: id, cwd, fences: ok, fenced: fencedBy(ok) });
    const first = [{ kind: 'session', source: p.source ?? (ev === 'SessionStart' ? null : 'late-start') }];
    if (!Array.isArray(fences)) first.push({ kind: 'warning', warning: `fences not loaded: ${fences.error}` });
    withLock(id, () => appendEvents(id, first));
  } else if (ev === 'SessionStart') {
    withLock(id, () => appendEvents(id, [{ kind: 'session', source: p.source ?? null }]));
  }
  if (ev === 'SessionStart') return;
  const root = meta.repo;
  // fences are re-read from the SESSION's repo on every event (not from wherever the agent has cd'd to), so
  // /fenceline:fence takes effect at once; every change is recorded and listed in the Stop summary
  let fences = meta.fences || [];
  const now = tryFences(root);
  if (Array.isArray(now) && JSON.stringify(now) !== JSON.stringify(fences)) {
    fences = now;
    withLock(id, () => {
      const m = readMeta(id); m.fences = now; fs.writeFileSync(path.join(sessionDir(id), 'meta.json'), JSON.stringify(m, null, 2));
      appendEvents(id, [{ kind: 'fences', fences: now }]);
    });
  }
  const startedMs = Date.parse(meta.started_at);

  if (ev === 'PreToolUse') {
    const snap = readSnapshot(id); const known = Object.keys(snap);
    const d = preDecision(p, { root, cwd, fences, exists: (rel) => rel in snap || fs.existsSync(path.join(root, rel)), files: () => known });
    if (!d.deny) {
      // the fences allow it: chaos mode may still inject a test fault (logged before it is printed)
      const out = tryChaos(id, p, 'pre', { root, cwd, startedMs });
      if (out) process.stdout.write(JSON.stringify(out));
      return;
    }
    // the deny goes out first: logging it must never be able to turn a block into an allow
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: d.reason } }));
    try { withLock(id, () => appendEvents(id, [blockedEvent(p, d, { now: Date.now(), startedMs })])); } catch (e) { logError(e); }
    return;
  }

  if (ev === 'PostToolUse' || ev === 'PostToolUseFailure') {
    withLock(id, () => {
      const snapshot = readSnapshot(id); let changed = false;
      const e = postEvent(p, { root, cwd, fences, now: Date.now(), startedMs,
        rescan: (rels) => { const r = rescan(root, snapshot, rels); if (r.length) changed = true; return r; },
        allFiles: () => [...new Set([...Object.keys(snapshot), ...listFiles(root, { fenced: fencedBy(fences) })])] });
      if (changed) writeSnapshot(id, snapshot);
      appendEvents(id, [e]);
    });
    // chaos mode: wrong context after a call that succeeded (recorded after the call's own event)
    if (ev === 'PostToolUse') { const out = tryChaos(id, p, 'post', { root, cwd, startedMs }); if (out) process.stdout.write(JSON.stringify(out)); }
    return;
  }

  if (ev === 'Stop') {
    const message = p.last_assistant_message ?? '';
    const s = summarize(readEvents(id), message, { startedMs, now: Date.now(), initialFences: meta.initial_fences ?? meta.fences ?? [] });
    fs.writeFileSync(path.join(sessionDir(id), 'summary.json'), JSON.stringify({ at: new Date().toISOString(), message, ...s }, null, 2));
    withLock(id, () => appendEvents(id, [{ kind: 'stop', elapsed_ms: s.duration_ms, crossing_count: s.crossings.length, unmentioned: s.unmentioned, fence_changes: s.fence_changes,
      ...(s.chaos.length ? { chaos_count: s.chaos.reduce((n, f) => n + f.count, 0), chaos_silent: s.chaos_silent } : {}) }]));
    // shown to the user, never to the agent, and only when this turn had something to report
    if (!s.quiet) process.stdout.write(JSON.stringify({ systemMessage: s.text }));
  }
}

main().catch(logError).finally(() => process.exit(0));
