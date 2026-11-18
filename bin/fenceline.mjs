#!/usr/bin/env node
// fenceline: set fences, look at sessions, open the map.
//   fenceline fence "migrations: off-limits" "this task only touches src/payments" [--block] [--yes]
//                                                  compile plain English to globs (one LLM call), confirm, save
//   fenceline accept [--replace]                    save the last proposal as shown (adds only; --replace overwrites)
//   fenceline add <id> --deny|--only <glob>... [--except <glob>...] [--reads] [--block] [--text "..."]
//                                                  write a fence by hand (no LLM)
//   fenceline list | rm <id> | mode <id> warn|block
//   fenceline sessions | summary [<session>] | record <session> <name>
//   fenceline view [--port N] [--detach]           the map (live sessions and recordings), 127.0.0.1 only
//   fenceline scope <run|folder|session>... [-o scope-map.html]   one HTML file comparing what runs touched vs the fence
//   fenceline chaos add <id> --type tool_denied|flaky|rate_limit|misleading_context [--tool T]... [--path G]... [--command RE]
//                  [--p 0.3 | --nth 1,3 | --after N] [--failures N] [--window S] [--times N] [--error "..."] [--context "..."] [--as exit] [--on]
//   fenceline chaos list | rm <id> | on [--seed N] | off      test faults for measuring agents (opt-in; off by default)
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
const positional = () => argv.slice(1).filter((a, i, xs) => !a.startsWith('--') && !(xs[i - 1] || '').match(/^--(deny|only|except|text|port|recordings|type|tool|path|command|p|nth|after|failures|window|times|error|context|seed|as|ack)$/));
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
  if (!process.stdin.isTTY) { console.log('\nNot saved yet. Show this to the user and ask; only if they say yes, run `fenceline accept`.'); return false; }
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
  if (await confirm(`\nSave to ${FENCES_FILE}? [y/N] `)) { merge(r, fences); console.log(`Saved. Edit ${FENCES_FILE} to change any glob. Applies from the agent's next tool call.`); }
  else { fs.mkdirSync(path.join(r, '.fenceline'), { recursive: true }); fs.writeFileSync(path.join(r, PROPOSED), JSON.stringify({ fences }, null, 2)); console.log(`Proposal kept in ${PROPOSED}: \`fenceline accept\` saves exactly this (no second LLM call).`); }
} else if (cmd === 'accept') {
  const r = root(); const file = path.join(r, PROPOSED);
  if (!fs.existsSync(file)) { console.error(`nothing to accept: run fenceline fence "<rule>" first`); process.exit(1); }
  const { fences } = JSON.parse(fs.readFileSync(file, 'utf8'));
  // accept only adds: replacing a fence that already exists could loosen it, so that takes --replace (which the hook keeps
  // for the user: an agent running it is denied)
  const clash = fences.filter((f) => loadFences(r).fences.some((x) => x.id === f.id));
  if (clash.length && !flag('replace')) { console.error(`Not saved: this would replace existing fence${clash.length > 1 ? 's' : ''} ${clash.map((f) => f.id).join(', ')}. To replace ${clash.length > 1 ? 'them' : 'it'}, run in your own terminal: fenceline accept --replace`); process.exit(1); }
  merge(r, fences); fs.rmSync(file);
  show(loadFences(r).fences.filter((f) => fences.some((x) => x.id === f.id)), listFiles(r)); console.log(`\nSaved to ${FENCES_FILE}. Applies from the agent's next tool call.`);
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
  if (!id || !/^[A-Za-z0-9_.-]{1,100}$/.test(name || '') || name === '.' || name === '..') { console.error('usage: fenceline record <session> <name>'); process.exit(2); }
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
} else if (cmd === 'scope') {
  // a self-contained scope map: what each run read, wrote or tried, drawn against its fences; two runs side by side
  const outAt = argv.findIndex((a) => a === '-o' || a === '--out');
  const out = path.resolve(outAt > 0 && argv[outAt + 1] ? argv[outAt + 1] : 'scope-map.html');
  const args = argv.slice(1).filter((a, i) => i + 1 !== outAt && i !== outAt);
  if (!args.length) { console.error('usage: fenceline scope <run folder | results folder | session id>... [-o scope-map.html]'); process.exit(2); }
  const { findRuns, loadRun, buildModel, renderPage } = await import('../src/scope.mjs');
  let dirs; try { dirs = findRuns(args); } catch (e) { console.error(`fenceline scope: ${e.message}`); process.exit(2); }
  if (!dirs.length) { console.error('fenceline scope: no runs found (a run folder holds meta.json and events.jsonl)'); process.exit(1); }
  const runs = []; for (const d of dirs) { try { runs.push(loadRun(d)); } catch (e) { console.error(`  skipped ${d}: ${e.message}`); } }
  fs.writeFileSync(out, renderPage(buildModel(runs)));
  console.log(`Wrote ${out} (${runs.length} run${runs.length === 1 ? '' : 's'}, ${(fs.statSync(out).size / 1024).toFixed(0)} KB). Open it in any browser; it needs no server.`);
} else if (cmd === 'chaos') {
  // the chaos-mode config, by hand (no LLM). Writes .fenceline/chaos.json; a new file starts disabled unless --on.
  const { loadChaos, saveChaos, CHAOS_FILE } = await import('../src/chaos.mjs');
  const r = root(); const [sub, id] = positional();
  let cur; try { cur = loadChaos(r, {}) || { enabled: false, seed: 0, faults: [] }; } catch (e) { console.error(`fenceline chaos: ${CHAOS_FILE} is invalid: ${e.message}`); process.exit(1); }
  const num = (n) => (opt(n) == null ? undefined : Number(opt(n)));
  const save = (doc) => { try { return saveChaos(r, doc); } catch (e) { console.error(e.message); process.exit(2); } };
  const showChaos = (c) => {
    console.log(`Chaos mode: ${c.enabled ? 'ON' : 'off'} · seed ${JSON.stringify(c.seed)} · ${CHAOS_FILE}`);
    if (!c.faults.length) console.log('  no faults. Add one: fenceline chaos add <id> --type tool_denied --tool Edit');
    for (const f of c.faults) {
      const when = f.nth ? `calls ${f.nth.join(', ')}` : f.after != null ? `every call after ${f.after}` : f.probability >= 1 ? 'every call' : `p=${f.probability}`;
      console.log(`  ${f.id}  [${f.type}${f.as ? `, as ${f.as}` : ''}]  tools ${f.tools.join(',')}${f.paths.length ? ` · paths ${f.paths.join(' ')}` : ''}${f.command ? ` · command /${f.command}/` : ''} · ${when}`
        + `${f.failures ? ` · ${f.failures} failure(s) per call` : ''}${f.window_s ? ` · ${f.window_s}s window` : ''}${f.times ? ` · at most ${f.times}×` : ''}`);
      console.log(`      ${f.type === 'misleading_context' ? 'adds' : 'error'}: ${JSON.stringify(f.context ?? f.error)}`);
    }
  };
  if (sub === 'add') {
    const type = opt('type');
    if (!id || !type) { console.error('usage: fenceline chaos add <id> --type tool_denied|flaky|rate_limit|misleading_context [--tool T]... [--path G]... [--command RE] [--p P | --nth 1,3 | --after N] ...'); process.exit(2); }
    const f = { id, type, ...(multi('tool').length ? { tools: multi('tool') } : {}), ...(multi('path').length ? { paths: multi('path') } : {}),
      ...(opt('command') != null ? { command: opt('command') } : {}), ...(opt('p') != null ? { probability: num('p') } : {}),
      ...(opt('nth') != null ? { nth: opt('nth').split(',').map(Number) } : {}), ...(opt('after') != null ? { after: num('after') } : {}),
      ...(opt('failures') != null ? { failures: num('failures') } : {}), ...(opt('window') != null ? { window_s: num('window') } : {}),
      ...(opt('times') != null ? { times: num('times') } : {}), ...(opt('error') != null ? { error: opt('error') } : {}),
      ...(opt('context') != null ? { context: opt('context') } : {}), ...(opt('as') != null ? { as: opt('as') } : {}), ...(opt('ack') != null ? { ack: opt('ack') } : {}) };
    showChaos(save({ ...cur, enabled: flag('on') ? true : cur.enabled, faults: [...cur.faults.filter((x) => x.id !== id), f] }));
  } else if (sub === 'rm') {
    if (!cur.faults.some((f) => f.id === id)) { console.error(`no fault ${id}`); process.exit(1); }
    showChaos(save({ ...cur, faults: cur.faults.filter((f) => f.id !== id) }));
  } else if (sub === 'on' || sub === 'off') {
    showChaos(save({ ...cur, enabled: sub === 'on', ...(opt('seed') != null ? { seed: Number.isFinite(num('seed')) ? num('seed') : opt('seed') } : {}) }));
    if (sub === 'on') console.log('Applies from the agent\'s next tool call. Every injected fault is logged and listed at Stop.');
  } else if (sub === 'list' || !sub) showChaos(cur);
  else { console.error('usage: fenceline chaos add|rm|list|on|off'); process.exit(2); }
} else if (cmd === 'view') {
  const { createServer } = await import('../viewer/server.mjs');
  const server = createServer({ recordingsDir: opt('recordings') });
  server.listen(Number(opt('port', '0')), '127.0.0.1', () => console.log(`Fenceline map: http://127.0.0.1:${server.address().port}/`));
} else {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 14).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(cmd ? 2 : 0);
}
