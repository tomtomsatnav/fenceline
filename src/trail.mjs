// The trail: turn one Claude Code hook payload into what the map draws (touches: which file or folder, read / search /
// create / edit / delete) and which fences that crosses. Everything except path canonicalisation comes in through ctx,
// so the golden tests can replay recorded sessions through exactly this code.
import fs from 'node:fs';
import path from 'node:path';
import { crossingsFor, bashWriteTargets, words } from './fences.mjs';
import { matchGlob } from './glob.mjs';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'NotebookRead']);
const clip = (s, n = 160) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

/**
 * The path as the filesystem knows it: symlinks resolved and, on a case-insensitive disk, the on-disk case. A path that
 * does not exist yet keeps its missing tail as written under the canonical form of its nearest existing parent.
 */
export function canonical(abs) {
  let head = abs; const tail = [];
  for (;;) {
    try { return path.join(fs.realpathSync.native(head), ...tail.reverse()); } catch { /* not there yet */ }
    const up = path.dirname(head); if (up === head) return abs;
    tail.push(path.basename(head)); head = up;
  }
}
const canonRoot = new Map();
/** Repo-relative POSIX path of `f` (absolute or relative to cwd): '' for the root, null if it is outside the repo. */
export function relPath(root, cwd, f) {
  if (f == null || f === '' || !root) return null;
  if (!canonRoot.has(root)) canonRoot.set(root, canonical(root));
  const rel = path.relative(canonRoot.get(root), canonical(path.resolve(cwd || root, String(f)))).split(path.sep).join('/');
  return rel.startsWith('..') || path.isAbsolute(rel) ? null : rel;
}

/** "11 s", "4 min", "2h 14m": how far into the session. */
export function since(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60); if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** Expand one path the agent named into repo files: the root or "." is everything, a glob is what it matches, a folder is what is under it. */
function expand(rel, files) {
  if (rel === '' || rel === '.') return files;
  if (/[*?[{]/.test(rel)) { try { const hit = files.filter((f) => matchGlob(rel, f)); return hit.length ? hit : [rel]; } catch { return [rel]; } }
  const under = files.filter((f) => f.startsWith(`${rel}/`));
  return under.length ? under : [rel];
}

/**
 * PreToolUse: should this call be denied? Only block-mode fences are enforced here, and only for what can be seen before
 * it happens: the target of an edit tool, a Read of a fence with reads: true, and what bashWriteTargets / bashReads can
 * read off a command. ctx: {root, cwd, fences, exists(rel), files() -> [rel]}. Returns {deny: false} or {deny, reason, crossings}.
 */
export function preDecision(p, ctx) {
  const ti = p.tool_input || {}; const tool = p.tool_name; const cwd = p.cwd || ctx.cwd;
  const block = ctx.fences.filter((f) => f.mode === 'block');
  // the fences are the user's: the agent may not loosen them through the CLI (`fenceline accept` stays allowed, it is the
  // documented step after the user says yes, and the change is listed at Stop)
  if (tool === 'Bash' && /fenceline(?:\.mjs)?["']?\s+(?:rm|mode|add)\b|fenceline(?:\.mjs)?["']?\s+fence\b[^\n]*--yes/.test(ti.command || '')) {
    return { deny: true, reason: 'Fenceline: changing fences is your user\'s call. Use /fenceline:fence so they can confirm; do not change fences from the shell.', crossings: [{ fence: 'fenceline-config', text: 'Fenceline\'s fences file: only you change it', mode: 'block', file: '.fenceline/fences.json', op: 'edit' }] };
  }
  const touches = [];
  if (EDIT_TOOLS.has(tool)) {
    const rel = relPath(ctx.root, cwd, ti.file_path || ti.notebook_path);
    if (rel) touches.push({ file: rel, op: ctx.exists(rel) ? 'edit' : 'create' });
  } else if (READ_TOOLS.has(tool)) {
    const rel = relPath(ctx.root, cwd, ti.file_path || ti.notebook_path); if (rel) touches.push({ file: rel, op: 'read' });
  } else if (tool === 'Bash') {
    const files = ctx.files();
    for (const t of bashWriteTargets(ti.command)) {
      if (t.cd == null) continue; // `cd -` and friends: cannot know where it writes; caught after the fact
      const rel = relPath(ctx.root, path.resolve(cwd, t.cd), t.file); if (rel == null) continue;
      for (const f of expand(rel, files)) touches.push({ file: f, op: t.op });
    }
    if (block.some((f) => f.reads)) touches.push(...bashReads(ti.command, { root: ctx.root, cwd, files }).filter((t) => t.op === 'read'));
  }
  const crossings = touches.flatMap((t) => crossingsFor(block, t.file, t.op, { guardConfig: EDIT_TOOLS.has(tool) }));
  if (!crossings.length) return { deny: false };
  const first = crossings[0];
  const verb = first.op === 'delete' ? 'deletes' : first.op === 'read' ? 'reads' : 'changes';
  const reason = `Fenceline: this ${verb} ${first.file}, which is fenced off by your user's rule "${first.text}". `
    + 'Do not work around it (not through Bash, another path, or a copy). If the task needs it, stop and ask the user.';
  return { deny: true, reason, crossings };
}

/**
 * PostToolUse / PostToolUseFailure: what the call touched, and the crossings. ctx: {root, cwd, fences, rescan(rels) ->
 * [{file, op}], allFiles() -> [rel], startedMs, now}. Edit tools are confirmed by rescanning their target; Bash by
 * rescanning the whole repo, which is how an edit made through `sed -i` or `cat >` is seen.
 */
export function postEvent(p, ctx) {
  const ti = p.tool_input || {}; const tool = p.tool_name; const cwd = p.cwd || ctx.cwd;
  const touches = [];
  if (READ_TOOLS.has(tool)) {
    const rel = relPath(ctx.root, cwd, ti.file_path || ti.notebook_path); if (rel) touches.push({ file: rel, op: 'read' });
  } else if (tool === 'Grep' || tool === 'Glob') {
    const rel = ti.path ? relPath(ctx.root, cwd, ti.path) : '';
    if (rel != null) touches.push({ file: rel, op: 'search', dir: true });
  } else if (EDIT_TOOLS.has(tool)) {
    const rel = relPath(ctx.root, cwd, ti.file_path || ti.notebook_path);
    if (rel) touches.push(...ctx.rescan([rel]));
  } else if (tool === 'Bash') {
    const files = ctx.allFiles();
    const changed = ctx.rescan(files);
    touches.push(...changed);
    // the reads are decoration for the map: they must never cost us the changes above
    try { touches.push(...bashReads(ti.command, { root: ctx.root, cwd, files, skip: new Set(changed.map((t) => t.file)) })); } catch { /* unreadable shell */ }
  }
  // a failed edit that changed nothing is not a crossing; a file that changed is, whatever the tool said
  const crossings = touches.flatMap((t) => crossingsFor(ctx.fences, t.file, t.op));
  const elapsed = Math.max(0, ctx.now - ctx.startedMs);
  for (const c of crossings) { c.elapsed_ms = elapsed; c.prevented = false; }
  const ev = { kind: crossings.length ? 'crossing' : 'touch', tool, tool_use_id: p.tool_use_id ?? null, elapsed_ms: elapsed, touches, crossings };
  if (tool === 'Bash') ev.command = clip(ti.command || '');
  if (p.hook_event_name === 'PostToolUseFailure') ev.failed = true;
  return ev;
}

/**
 * What a Bash command looked at, for the trail (and for block-mode fences with reads: true): every word that names a
 * repo file is a read, a repo folder is a search, a glob (test/*.js) is a read of what it matches. Best-effort, like any
 * reading of shell; a word that is not a valid glob is skipped.
 */
export function bashReads(command, { root, cwd, files, skip = new Set() }) {
  const fileSet = new Set(files); const out = new Map();
  for (const w of words(String(command || '').replace(/[;&|()]/g, ' '))) {
    if (w.startsWith('-') || w === '>' || w === '>>' || w.length > 300) continue;
    const rel = relPath(root, cwd, w.replace(/\/$/, '')); if (!rel) continue;
    if (/[*?[{]/.test(rel)) {
      try { for (const f of files) if (matchGlob(rel, f) && /\//.test(rel) === /\//.test(f)) out.set(f, 'read'); } catch { /* not a glob after all: `{`, `[ -z` */ }
      continue;
    }
    if (fileSet.has(rel)) out.set(rel, 'read');
    else if (files.some((f) => f.startsWith(`${rel}/`))) out.set(rel, 'search');
  }
  return [...out].filter(([f]) => !skip.has(f)).map(([file, op]) => (op === 'search' ? { file, op, dir: true } : { file, op }));
}

/** A PreToolUse denial as a trail event: the boundary still flashes, marked as stopped. */
export function blockedEvent(p, decision, ctx) {
  const elapsed = Math.max(0, ctx.now - ctx.startedMs);
  return { kind: 'blocked', tool: p.tool_name, tool_use_id: p.tool_use_id ?? null, elapsed_ms: elapsed,
    touches: [], crossings: decision.crossings.map((c) => ({ ...c, elapsed_ms: elapsed, prevented: true })),
    ...(p.tool_name === 'Bash' ? { command: clip(p.tool_input?.command || '') } : {}) };
}

/** Does the final message mention this file? Its path, or its file name as a whole word. */
export function mentioned(message, file) {
  const m = String(message || '');
  if (m.includes(file)) return true;
  const base = file.split('/').pop();
  return base.length > 2 && new RegExp(`(^|[^\\w.-])${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w-])`).test(m);
}

/** What changed between two fence sets, in words: "added x", "removed y", "y: block -> warn", "y: paths changed". */
export function fenceChanges(before, after) {
  const out = []; const b = new Map(before.map((f) => [f.id, f])); const a = new Map(after.map((f) => [f.id, f]));
  for (const [id, f] of a) if (!b.has(id)) out.push(`added "${f.text}" (${f.mode})`);
  for (const [id, f] of b) {
    if (!a.has(id)) { out.push(`removed "${f.text}"`); continue; }
    const g = a.get(id);
    if (g.mode !== f.mode) out.push(`"${f.text}": ${f.mode} -> ${g.mode}`);
    if (JSON.stringify([g.kind, g.paths, g.except, g.reads]) !== JSON.stringify([f.kind, f.paths, f.except, f.reads])) out.push(`"${f.text}": globs changed`);
  }
  return out;
}

/**
 * The Stop summary. `events` is the whole session; the text covers what happened since the previous Stop (one per turn),
 * so a crossing is reported once: every crossing (first time each fence/file was crossed, prevented or not), changed
 * fences, and out-of-scope changes the final message never mentions. `quiet` is true when there is nothing to say.
 */
export function summarize(events, message, { startedMs, now, initialFences = [] }) {
  const lastStop = events.map((e) => e.kind).lastIndexOf('stop');
  const turn = events.slice(lastStop + 1);
  const prevFences = (() => { let f = initialFences; for (const e of events.slice(0, lastStop + 1)) if (e.kind === 'fences') f = e.fences; return f; })();
  const seen = new Map();
  for (const e of turn) for (const c of e.crossings || []) {
    const key = `${c.fence}\0${c.file}\0${c.prevented}`;
    if (!seen.has(key)) seen.set(key, { ...c, tool: e.tool, command: e.command ?? null, at: e.t ?? null });
  }
  const crossings = [...seen.values()].sort((a, b) => a.elapsed_ms - b.elapsed_ms);
  const landed = crossings.filter((c) => !c.prevented && c.op !== 'read');
  const unmentioned = [...new Set(landed.map((c) => c.file))].filter((f) => !mentioned(message, f));
  let lastFences = prevFences; for (const e of turn) if (e.kind === 'fences') lastFences = e.fences;
  const changes = fenceChanges(prevFences, lastFences);
  const lines = [];
  if (crossings.length) {
    lines.push(`Fenceline: ${landed.length} fence crossing${landed.length === 1 ? '' : 's'}${crossings.length > landed.length ? `, ${crossings.length - landed.length} blocked` : ''} this turn.`);
    for (const c of crossings) lines.push(`  ${c.prevented ? 'BLOCKED' : 'CROSSED'} "${c.text}": ${c.op} ${c.file} · ${since(c.elapsed_ms)} in · ${c.tool}${c.command ? ` \`${clip(c.command, 70)}\`` : ''}`);
    if (unmentioned.length) lines.push(`  Not mentioned in the agent's final message: ${unmentioned.join(', ')}`);
  }
  if (changes.length) lines.push(`${lines.length ? '  ' : 'Fenceline: '}Fences changed this turn: ${changes.join('; ')}`);
  return { crossings, unmentioned, fence_changes: changes, quiet: !lines.length, duration_ms: Math.max(0, now - startedMs), text: lines.join('\n') || 'Fenceline: no fence crossed this turn.' };
}
