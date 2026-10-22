#!/usr/bin/env node
// Hook latency: the real hook process, 10 calls per event type, on this repo, any repos given, and a
// synthetic 5,000-file repo. Writes docs/bench.json (the README's latency figures come from it).
//   node scripts/bench-hook.mjs [extra repo paths...]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = path.join(root, 'hooks', 'fenceline-hook.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fenceline-bench-'));
const big = path.join(tmp, 'synthetic-5000');
for (let d = 0; d < 100; d++) { fs.mkdirSync(path.join(big, `pkg${d}/src`), { recursive: true }); for (let f = 0; f < 50; f++) fs.writeFileSync(path.join(big, `pkg${d}/src/f${f}.js`), `${'x'.repeat(2000)}${d}${f}`); }
execFileSync('git', ['init', '-q'], { cwd: big });
const repos = [root, big, ...process.argv.slice(2)];
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const out = { measured_at: new Date().toISOString(), node: process.version, platform: `${os.platform()} ${os.arch()}`, repos: [] };
for (const repo of repos) {
  const home = fs.mkdtempSync(path.join(tmp, 'home-'));
  const run = (p) => { const t = process.hrtime.bigint(); execFileSync('node', [HOOK], { input: JSON.stringify({ session_id: 'bench', cwd: repo, ...p }), env: { ...process.env, FENCELINE_HOME: home } }); return Number(process.hrtime.bigint() - t) / 1e6; };
  const start = run({ hook_event_name: 'SessionStart' });
  const times = (p) => Array.from({ length: 10 }, () => run(p));
  const files = Number(JSON.parse(fs.readFileSync(path.join(home, 'sessions', 'bench', 'meta.json'), 'utf8')).files.length);
  out.repos.push({ repo: repo === root ? 'fenceline (this repo)' : repo === big ? 'synthetic-5000' : path.basename(repo), files, session_start_ms: Math.round(start),
    post_bash_median_ms: Math.round(med(times({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } }))),
    post_read_median_ms: Math.round(med(times({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: path.join(repo, 'README.md') } }))),
    pre_edit_median_ms: Math.round(med(times({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(repo, 'x.js') } }))) });
}
fs.writeFileSync(path.join(root, 'docs', 'bench.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out.repos));
