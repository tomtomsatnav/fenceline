// Per-session storage under FENCELINE_HOME (default ~/.fenceline): meta.json (repo, fences as they were at session start,
// the file list the map is drawn from), a hash-chained events.jsonl, and snapshot.json (size, mtime and hash of every
// repo file, so a change made through Bash is seen after the fact). Adapted from dfaith src/session.mjs (withLock, the
// hash chain, the git wrapper that ignores the agent-writable git config). The agent's tree, index and refs are never touched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const SCHEMA_SESSION = 'fenceline.session/1';
export const MAX_FILES = 20000;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.fenceline-cache']);

export const home = (env = process.env) => env.FENCELINE_HOME || path.join(os.homedir(), '.fenceline');
const SID = /^[A-Za-z0-9_-]{1,128}$/;
export function sessionDir(id, env = process.env) {
  if (!SID.test(String(id))) throw new Error(`invalid session id ${JSON.stringify(String(id).slice(0, 40))}`);
  return path.join(home(env), 'sessions', id);
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
export function git(cwd, args, { timeout = 5000 } = {}) {
  try { return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], { cwd, env: GIT_ENV, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).trim(); } catch { return null; }
}
export function repoRoot(cwd) { return git(cwd, ['rev-parse', '--show-toplevel']) || null; }

/**
 * Repo files the map shows and the snapshot watches: tracked + untracked, not ignored (a plain walk outside git), plus any
 * IGNORED file a fence names (`.env` is usually gitignored, and it is exactly what a fence is for). `fenced(rel)` says
 * whether a fence covers a path; ignored folders are not expanded.
 */
export function listFiles(root, { fenced } = {}) {
  const out = git(root, ['ls-files', '-co', '--exclude-standard', '-z']);
  if (out != null) {
    const files = new Set(out.split('\0').filter(Boolean));
    if (fenced) for (const f of (git(root, ['ls-files', '-oi', '--exclude-standard', '--directory', '-z']) || '').split('\0')) if (f && !f.endsWith('/') && fenced(f)) files.add(f);
    return [...files].slice(0, MAX_FILES);
  }
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (files.length >= MAX_FILES) return;
      if (SKIP_DIRS.has(e.name)) continue;
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) walk(rel); else if (e.isFile()) files.push(rel);
    }
  };
  try { walk(''); } catch { /* unreadable */ }
  return files;
}

function statOf(root, rel) { try { const st = fs.statSync(path.join(root, rel)); return st.isFile() ? st : null; } catch { return null; } }
function hashOf(root, rel) { try { return sha(fs.readFileSync(path.join(root, rel))); } catch { return null; } }

/**
 * Rescan `rels` against the snapshot ({rel: [size, mtimeMs, hash]}), mutating it. Files whose size and mtime are unchanged
 * are skipped without reading (the dfaith trick: this runs after every Bash call). Returns [{file, op: create|edit|delete}].
 */
export function rescan(root, snapshot, rels) {
  const out = [];
  for (const rel of rels) {
    const st = statOf(root, rel); const old = snapshot[rel];
    if (!st) { if (old) { delete snapshot[rel]; out.push({ file: rel, op: 'delete' }); } continue; }
    if (old && old[0] === st.size && old[1] === st.mtimeMs) continue;
    const h = hashOf(root, rel);
    snapshot[rel] = [st.size, st.mtimeMs, h];
    if (!old) out.push({ file: rel, op: 'create' }); else if (old[2] !== h) out.push({ file: rel, op: 'edit' });
  }
  return out;
}

/** Start (or resume) a session: records the fences in force, the file list for the map, and the snapshot. Idempotent. */
export function startSession({ session_id, cwd, fences, fenced }, env = process.env) {
  const dir = sessionDir(session_id, env);
  const metaFile = path.join(dir, 'meta.json');
  if (fs.existsSync(metaFile)) return JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const root = repoRoot(cwd) || cwd;
  const snapshot = {};
  const files = listFiles(root, { fenced });
  rescan(root, snapshot, files);
  const meta = { schema: SCHEMA_SESSION, session_id, repo: root, repo_name: path.basename(root), cwd, started_at: new Date().toISOString(),
    head: git(root, ['rev-parse', '--verify', 'HEAD']), fences, initial_fences: fences, files: files.filter((f) => snapshot[f]).map((f) => ({ path: f, size: snapshot[f][0] })) };
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
  fs.writeFileSync(path.join(dir, 'snapshot.json'), JSON.stringify(snapshot));
  return meta;
}

export const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
export const readMeta = (id, env) => readJson(path.join(sessionDir(id, env), 'meta.json'));
export const readSnapshot = (id, env) => readJson(path.join(sessionDir(id, env), 'snapshot.json'), {});
export const writeSnapshot = (id, snap, env) => fs.writeFileSync(path.join(sessionDir(id, env), 'snapshot.json'), JSON.stringify(snap));

/** Exclusive lock around a read-modify-write of the session (parallel tool calls fire hooks concurrently). */
export function withLock(id, fn, env = process.env) {
  const lock = path.join(sessionDir(id, env), '.lock');
  const t0 = Date.now();
  for (;;) {
    try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 10000) fs.rmSync(lock, { force: true }); } catch { /* raced */ }
      if (Date.now() - t0 > 8000) throw new Error('session lock timeout');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
    }
  }
  try { return fn(); } finally { fs.rmSync(lock, { force: true }); }
}

/** Append events (hash-chained: each carries prev and its own hash over its content). Call inside withLock. */
export function appendEvents(id, events, env = process.env) {
  const file = path.join(sessionDir(id, env), 'events.jsonl');
  const existing = readEvents(id, env);
  let prev = existing.length ? existing[existing.length - 1].hash : '0'.repeat(64);
  let i = existing.length;
  const out = [];
  for (const e of events) {
    const body = { i: i++, t: new Date().toISOString(), ...e, prev };
    const rec = { ...body, hash: sha(prev + JSON.stringify(body)) };
    out.push(rec); prev = rec.hash;
  }
  if (out.length) fs.appendFileSync(file, out.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return out;
}
export function readEvents(id, env = process.env) {
  try { return fs.readFileSync(path.join(sessionDir(id, env), 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}
export function verifyChain(events) {
  let prev = '0'.repeat(64);
  for (const e of events) {
    const { hash, ...body } = e;
    if (body.prev !== prev || sha(prev + JSON.stringify(body)) !== hash) return { ok: false, broken_at: e.i };
    prev = hash;
  }
  return { ok: true, broken_at: null };
}
export function listSessions(env = process.env) {
  const d = path.join(home(env), 'sessions');
  try { return fs.readdirSync(d).filter((n) => SID.test(n)).map((n) => ({ id: n, mtime: fs.statSync(path.join(d, n)).mtimeMs })).sort((a, b) => b.mtime - a.mtime); } catch { return []; }
}
