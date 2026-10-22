// The trail: turn one Claude Code hook payload into what the map draws (touches: which file or folder, read / search /
// create / edit / delete) and which fences that crosses. Pure: all I/O comes in through ctx, so the golden tests can
// replay recorded sessions through exactly this code.
import path from 'node:path';
import { crossingsFor, bashWriteTargets, words } from './fences.mjs';
import { matchGlob } from './glob.mjs';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const clip = (s, n = 160) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

/** Repo-relative POSIX path of `f` (absolute or relative to cwd), or null if it is outside the repo. */
export function relPath(root, cwd, f) {
  if (!f || !root) return null;
  const rel = path.relative(root, path.resolve(cwd || root, String(f))).split(path.sep).join('/');
  return !rel || rel.startsWith('..') || path.isAbsolute(rel) ? null : rel;
}

/** "11 s", "4 min", "2h 14m": how far into the session. */
export function since(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60); if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/**
 * PreToolUse: should this call be denied? Only block-mode fences are enforced here, and only for writes that can be seen
 * before they happen: the target of an edit tool, or what bashWriteTargets can read off a command.
 * ctx: {root, cwd, fences, exists(rel), filesUnder(rel)}. Returns {deny: false} or {deny: true, reason, crossings}.
 */
export function preDecision(p, ctx) {
  const ti = p.tool_input || {}; const tool = p.tool_name;
  const block = ctx.fences.filter((f) => f.mode === 'block');
  let touches = [];
  if (EDIT_TOOLS.has(tool)) {
    const rel = relPath(ctx.root, p.cwd || ctx.cwd, ti.file_path || ti.notebook_path);
    if (rel) touches.push({ file: rel, op: ctx.exists(rel) ? 'edit' : 'create' });
  } else if (tool === 'Bash') {
    for (const t of bashWriteTargets(ti.command)) {
      const rel = relPath(ctx.root, p.cwd || ctx.cwd, t.file); if (!rel) continue;
      const under = ctx.filesUnder ? ctx.filesUnder(rel) : [];
      touches.push(...(under.length ? under.map((f) => ({ file: f, op: t.op })) : [{ file: rel, op: t.op }]));
    }
  }
  const crossings = touches.flatMap((t) => crossingsFor(block, t.file, t.op));
  if (!crossings.length) return { deny: false };
  const first = crossings[0];
  const reason = `Fenceline: this ${first.op === 'delete' ? 'deletes' : 'changes'} ${first.file}, which is fenced off by your user's rule "${first.text}". `
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
  if (tool === 'Read' || tool === 'NotebookRead') {
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
    touches.push(...changed, ...bashReads(ti.command, { root: ctx.root, cwd, files, skip: new Set(changed.map((t) => t.file)) }));
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
 * What a Bash command looked at, for the trail only (never a write, so never a deny-fence crossing unless the fence has
 * reads: true): every word that names a repo file is a read, a repo folder is a search, a glob (test/*.js) is a read of
 * what it matches. Best-effort, like any reading of shell.
 */
export function bashReads(command, { root, cwd, files, skip = new Set() }) {
  const fileSet = new Set(files); const out = new Map();
  for (const w of words(String(command || '').replace(/[;&|()]/g, ' '))) {
    if (w.startsWith('-') || w === '>' || w === '>>' || w.length > 300) continue;
    const rel = relPath(root, cwd, w.replace(/\/$/, '')); if (rel == null) continue;
    if (/[*?[{]/.test(rel)) { for (const f of files) if (matchGlob(rel, f) && /\//.test(rel) === /\//.test(f)) out.set(f, 'read'); continue; }
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

/**
 * The Stop summary: every crossing (first time each fence/file was crossed, prevented or not), and the out-of-scope
 * changes still in the tree that the final message never mentions.
 */
export function summarize(events, message, { startedMs, now }) {
  const seen = new Map();
  for (const e of events) for (const c of e.crossings || []) {
    const key = `${c.fence}\0${c.file}\0${c.prevented}`;
    if (!seen.has(key)) seen.set(key, { ...c, tool: e.tool, command: e.command ?? null, at: e.t ?? null });
  }
  const crossings = [...seen.values()].sort((a, b) => a.elapsed_ms - b.elapsed_ms);
  const landed = crossings.filter((c) => !c.prevented && c.op !== 'read');
  const unmentioned = [...new Set(landed.map((c) => c.file))].filter((f) => !mentioned(message, f));
  const lines = [];
  if (!crossings.length) lines.push('Fenceline: no fence crossed this session.');
  else {
    lines.push(`Fenceline: ${landed.length} fence crossing${landed.length === 1 ? '' : 's'}${crossings.length > landed.length ? `, ${crossings.length - landed.length} blocked` : ''} this session.`);
    for (const c of crossings) lines.push(`  ${c.prevented ? 'BLOCKED' : 'CROSSED'} "${c.text}": ${c.op} ${c.file} · ${since(c.elapsed_ms)} in · ${c.tool}${c.command ? ` \`${clip(c.command, 70)}\`` : ''}`);
    if (unmentioned.length) lines.push(`  Not mentioned in the agent's final message: ${unmentioned.join(', ')}`);
  }
  return { crossings, unmentioned, duration_ms: Math.max(0, now - startedMs), text: lines.join('\n') };
}
