#!/usr/bin/env node
// fenceline: set fences, look at sessions, open the map.
//   fenceline fence "migrations: off-limits" "this task only touches src/payments" [--block] [--yes]
//                                                  compile plain English to globs (one LLM call), confirm, save
//   fenceline accept                               save the last proposal exactly as shown
//   fenceline add <id> --deny|--only <glob>... [--except <glob>...] [--reads] [--block] [--text "..."]
//                                                  write a fence by hand (no LLM)
//   fenceline list | rm <id> | mode <id> warn|block
//   fenceline sessions | summary [<session>] | record <session> <name>
//   fenceline view [--port N] [--detach]           the map (live sessions and recordings), 127.0.0.1 only
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { loadFences, saveFences, preview, FENCES_FILE } from '../src/fences.mjs';
const PROPOSED = '.fenceline/proposed.json';
import { compileFences } from '../src/compile.mjs';
import { repoRoot, listFiles, listSessions, readMeta, readJson, sessionDir, readEvents } from '../src/session.mjs';
import { summarize, since } from '../src/trail.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const multi = (n) => argv.flatMap((a, i) => (argv[i - 1] === `--${n}` ? [a] : []));
const positional = () => argv.slice(1).filter((a, i, xs) => !a.startsWith('--') && !(xs[i - 1] || '').match(/^--(deny|only|except|text|port|recordings)$/));
const root = () => { const r = repoRoot(process.cwd()); if (!r) { console.error('fenceline: run this inside a git repository'); process.exit(2); } return r; };

function show(fences, files) {
  const pv = preview(fences, files);
  for (const f of fences) {
    const p = pv.find((x) => x.id === f.id);
    console.log(`\n  ${f.id}  [${f.kind}, ${f.mode}${f.reads ? ', reads too' : ''}]  "${f.text}"`);
    console.log(`    paths:  ${f.paths.join('  ')}${f.except.length ? `\n    except: ${f.except.join('  ')}` : ''}`);
    const what = f.kind === 'only' ? 'files inside the allowed area' : 'files fenced off';
    console.log(`    ${p.matched} ${p.matched === 1 ? what.replace('files', 'file') : what}${p.sample.length ? `: ${p.sample.join(', ')}${p.matched > p.sample.length ? ', …' : ''}` : ''}`);
    if (!p.matched) console.log('    WARNING: matches no file in the repo today. Check the globs.');
  }
}
async function confirm(q) {
  if (flag('yes')) return true;
  if (!process.stdin.isTTY) { console.log('\nNot saved: rerun with --yes to accept, or edit the globs and use `fenceline add`.'); return false; }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question(q); rl.close(); return /^y(es)?$/i.test(a.trim());
}
function merge(r, add) {
  const cur = loadFences(r).fences.filter((f) => !add.some((a) => a.id === f.id));
  return saveFences(r, { fences: [...cur, ...add] });
}

if (cmd === 'fence') {
  const r = root(); const sentences = positional();
  if (!sentences.length) { console.error('usage: fenceline fence "<rule>" ["<rule>" ...] [--block] [--yes]'); process.exit(2); }
  const files = listFiles(r);
  console.log(`Compiling ${sentences.length} rule${sentences.length > 1 ? 's' : ''} against ${files.length} files (one LLM call)…`);
  const { fences } = compileFences(sentences, files, { mode: flag('block') ? 'block' : 'warn', cwd: r });
  show(fences, files);
  if (await confirm(`\nSave to ${FENCES_FILE}? [y/N] `)) { merge(r, fences); console.log(`Saved. Edit ${FENCES_FILE} to change any glob. New sessions use it.`); }
  else { fs.mkdirSync(path.join(r, '.fenceline'), { recursive: true }); fs.writeFileSync(path.join(r, PROPOSED), JSON.stringify({ fences }, null, 2)); console.log(`Proposal kept in ${PROPOSED}: \`fenceline accept\` saves exactly this (no second LLM call).`); }
} else if (cmd === 'accept') {
  const r = root(); const file = path.join(r, PROPOSED);
  if (!fs.existsSync(file)) { console.error(`nothing to accept: run fenceline fence "<rule>" first`); process.exit(1); }
  const { fences } = JSON.parse(fs.readFileSync(file, 'utf8')); merge(r, fences); fs.rmSync(file);
  show(loadFences(r).fences.filter((f) => fences.some((x) => x.id === f.id)), listFiles(r)); console.log(`\nSaved to ${FENCES_FILE}. New sessions use it.`);
} else if (cmd === 'add') {
  const r = root(); const [id] = positional();
  const deny = multi('deny'); const only = multi('only');
  if (!id || (!deny.length === !only.length)) { console.error('usage: fenceline add <id> --deny <glob>... | --only <glob>... [--except <glob>] [--reads] [--block] [--text "..."]'); process.exit(2); }
  const f = { id, text: opt('text', id), kind: deny.length ? 'deny' : 'only', mode: flag('block') ? 'block' : 'warn', paths: deny.length ? deny : only, except: multi('except'), reads: flag('reads') };
  const saved = merge(r, [f]); show(saved.fences.filter((x) => x.id === id), listFiles(r));
} else if (cmd === 'list') {
  const r = root(); const { fences } = loadFences(r);
  if (!fences.length) console.log(`No fences. Set one: fenceline fence "migrations: off-limits"`); else show(fences, listFiles(r));
} else if (cmd === 'rm') {
  const r = root(); const [id] = positional(); const doc = loadFences(r);
  if (!doc.fences.some((f) => f.id === id)) { console.error(`no fence ${id}`); process.exit(1); }
  saveFences(r, { fences: doc.fences.filter((f) => f.id !== id) }); console.log(`removed ${id}`);
} else if (cmd === 'mode') {
  const r = root(); const [id, mode] = positional(); const doc = loadFences(r);
  if (!doc.fences.some((f) => f.id === id) || !['warn', 'block'].includes(mode)) { console.error('usage: fenceline mode <id> warn|block'); process.exit(2); }
  saveFences(r, { fences: doc.fences.map((f) => (f.id === id ? { ...f, mode } : f)) }); console.log(`${id}: ${mode}`);
} else if (cmd === 'sessions') {
  for (const s of listSessions().slice(0, 20)) {
    const m = readMeta(s.id); const sum = readJson(path.join(sessionDir(s.id), 'summary.json'));
    console.log(`${s.id}  ${m?.started_at ?? '?'}  ${m?.repo_name ?? '?'}  ${sum ? `${sum.crossings.length} crossing(s)` : 'running or no Stop yet'}`);
  }
} else if (cmd === 'summary') {
  const id = positional()[0] || listSessions()[0]?.id; if (!id) { console.error('no sessions'); process.exit(1); }
  const m = readMeta(id); const saved = readJson(path.join(sessionDir(id), 'summary.json'));
  console.log(saved ? saved.text : summarize(readEvents(id), '', { startedMs: Date.parse(m.started_at), now: Date.now() }).text);
} else if (cmd === 'record') {
  // copy a session into recordings/<name> for replay, with the machine's repo path replaced by <repo>
  const [id, name] = positional();
  if (!id || !/^[A-Za-z0-9_.-]{1,100}$/.test(name || '')) { console.error('usage: fenceline record <session> <name>'); process.exit(2); }
  const m = readMeta(id); const dest = path.resolve(opt('recordings', path.join(here, '..', 'recordings')), name);
  fs.mkdirSync(dest, { recursive: true });
  for (const f of ['meta.json', 'events.jsonl', 'summary.json']) {
    const src = path.join(sessionDir(id), f); if (!fs.existsSync(src)) continue;
    let t = fs.readFileSync(src, 'utf8'); for (const p of [m.repo, m.cwd].filter(Boolean).sort((a, b) => b.length - a.length)) t = t.split(p).join('<repo>');
    fs.writeFileSync(path.join(dest, f), t);
  }
  console.log(`recorded ${id} -> ${dest} (${since(Date.now() - Date.parse(m.started_at))} ago)`);
} else if (cmd === 'view' && flag('detach')) {
  // for the /fenceline:map command: start the map in the background (or find the one already running) and print its URL
  const port = Number(opt('port', '4319')); const url = `http://127.0.0.1:${port}/`;
  const up = await fetch(`${url}api/recordings`).then((x) => x.ok).catch(() => false);
  if (!up) {
    const { spawn } = await import('node:child_process');
    spawn(process.execPath, [fileURLToPath(import.meta.url), 'view', '--port', String(port)], { detached: true, stdio: 'ignore' }).unref();
    for (let i = 0; i < 40 && !(await fetch(`${url}api/recordings`).then((x) => x.ok).catch(() => false)); i++) await new Promise((res) => setTimeout(res, 100));
  }
  console.log(`Fenceline map: ${url}`);
} else if (cmd === 'view') {
  const { createServer } = await import('../viewer/server.mjs');
  const server = createServer({ recordingsDir: opt('recordings') });
  server.listen(Number(opt('port', '0')), '127.0.0.1', () => console.log(`Fenceline map: http://127.0.0.1:${server.address().port}/`));
} else {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 11).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(cmd ? 2 : 0);
}
