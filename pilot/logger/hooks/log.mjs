#!/usr/bin/env node
// Pilot logger: one JSON line per hook event in $FENCE_PILOT_LOG/<session>.jsonl. After every tool call it diffs the repo
// against the last snapshot (content hashes, skipping files whose size+mtime are unchanged, the dfaith approach), so a
// file changed through Bash (sed -i, cat >, mv) is recorded the same as one changed with Edit/Write. Always exits 0.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SKIP = new Set(['.git', 'node_modules']);
function walk(root, dir = '', out = []) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) walk(root, rel, out); else if (e.isFile()) out.push(rel);
  }
  return out;
}
function scan(root, prev) {
  const next = {};
  for (const rel of walk(root)) {
    const st = fs.statSync(path.join(root, rel)); const key = `${st.size}:${st.mtimeMs}`;
    const old = prev[rel];
    next[rel] = old && old.key === key ? old : { key, h: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex') };
  }
  return next;
}
function diff(a, b) {
  const out = [];
  for (const rel of Object.keys(b)) if (!a[rel]) out.push({ file: rel, kind: 'added' }); else if (a[rel].h !== b[rel].h) out.push({ file: rel, kind: 'modified' });
  for (const rel of Object.keys(a)) if (!b[rel]) out.push({ file: rel, kind: 'deleted' });
  return out;
}

async function main() {
  let raw = ''; for await (const c of process.stdin) raw += c;
  const p = JSON.parse(raw || '{}'); const dir = process.env.FENCE_PILOT_LOG; const root = process.env.FENCE_PILOT_ROOT;
  if (!dir || !root || !/^[A-Za-z0-9_-]+$/.test(p.session_id || '')) return;
  fs.mkdirSync(dir, { recursive: true });
  const snapFile = path.join(dir, `${p.session_id}.snap.json`);
  let snap = null; try { snap = JSON.parse(fs.readFileSync(snapFile, 'utf8')); } catch { /* first event */ }
  const rec = { t: new Date().toISOString(), hook: p.hook_event_name };
  if (!snap) { snap = scan(root, {}); fs.writeFileSync(snapFile, JSON.stringify(snap)); }
  if (p.hook_event_name === 'SessionStart') rec.source = p.source ?? null;
  if (p.tool_name) {
    const ti = p.tool_input || {};
    rec.tool = p.tool_name; rec.tool_use_id = p.tool_use_id ?? null;
    rec.input = Object.fromEntries(['file_path', 'notebook_path', 'path', 'pattern', 'command', 'glob'].filter((k) => ti[k] != null).map((k) => [k, String(ti[k]).slice(0, 400)]));
    const next = scan(root, snap); rec.changed = diff(snap, next);
    if (rec.changed.length) fs.writeFileSync(snapFile, JSON.stringify(next));
  }
  if (p.hook_event_name === 'Stop') rec.message = p.last_assistant_message ?? null;
  fs.appendFileSync(path.join(dir, `${p.session_id}.jsonl`), `${JSON.stringify(rec)}\n`);
}
main().catch((e) => { try { fs.appendFileSync(path.join(process.env.FENCE_PILOT_LOG || '/tmp', 'errors.log'), `${e?.stack || e}\n`); } catch { /* nothing */ } }).finally(() => process.exit(0));
