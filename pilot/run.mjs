#!/usr/bin/env node
// WARNING: each trial runs a real `claude -p` agent with permission to edit and run commands, unsandboxed, in a temp copy
// of the task repo. Adapted from dfaith evals/run.mjs: a fresh seed repo per trial, a real session with the pilot logger
// loaded as a plugin, then ground truth from the repo itself (git status against the seed commit), independent of hooks.
//   node pilot/run.mjs --task api-bug --k 5 [--model haiku] [--parallel 3]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TASKS } from './tasks.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const taskId = opt('task', 'api-bug'); const k = Number(opt('k', '5')); const model = opt('model', 'haiku');
const task = TASKS[taskId]; if (!task) throw new Error(`unknown task ${taskId}; have ${Object.keys(TASKS).join(', ')}`);
const outDir = path.resolve(opt('out', path.join(here, 'results')));

const git = (cwd, a) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } }).trim();

function claude(cwd, env, sessionId, prompt, resume) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const a = ['-p', prompt, '--model', model, '--plugin-dir', path.join(here, 'logger'), resume ? '--resume' : '--session-id', sessionId,
      '--setting-sources', 'project', '--permission-mode', 'acceptEdits', '--allowedTools', task.allowedTools || 'Bash Edit Write Read Glob Grep', '--output-format', 'json'];
    const p = spawn('claude', a, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => p.kill('SIGTERM'), Number(opt('timeout-min', '15')) * 60000);
    p.on('close', (code) => { clearTimeout(timer); let j = null; try { j = JSON.parse(out); } catch { /* not json */ } resolve({ code, json: j, stderr: err.slice(-2000), wall_s: (Date.now() - t0) / 1000 }); });
  });
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fenceline-pilot-')));
fs.mkdirSync(path.join(outDir, 'runs'), { recursive: true });
const results = [];

async function trial(t) {
  const repo = path.join(tmpRoot, `${taskId}-${t}`); fs.mkdirSync(repo);
  for (const [rel, text] of Object.entries(task.files)) { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), text); }
  git(repo, ['init', '-q']); git(repo, ['add', '-A']); git(repo, ['-c', 'user.email=pilot@fenceline', '-c', 'user.name=pilot', 'commit', '-qm', 'seed']);
  const sessionId = crypto.randomUUID(); const logDir = path.join(tmpRoot, `log-${t}`);
  const env = { ...process.env, FENCE_PILOT_LOG: logDir, FENCE_PILOT_ROOT: repo }; delete env.CLAUDE_CODE_SESSION_ID;
  const turns = [];
  for (const [i, prompt] of task.turns.entries()) {
    const r = await claude(repo, env, sessionId, prompt, i > 0);
    turns.push({ turn: i + 1, claude_exit: r.code, wall_s: r.wall_s, cost_usd: r.json?.total_cost_usd ?? null, num_turns: r.json?.num_turns ?? null, is_error: r.json?.is_error ?? null, result: r.json?.result ?? null, stderr: r.code ? r.stderr : undefined });
    if (r.code !== 0) break;
  }
  // ground truth from the repo, not the hooks
  git(repo, ['add', '-A']);
  const changed = git(repo, ['-c', 'core.quotepath=off', 'diff', '--cached', '--name-status', 'HEAD']).split('\n').filter(Boolean).map((l) => { const [s, ...f] = l.split('\t'); return { status: s, file: f.join('\t') }; });
  const crossed = changed.filter((c) => task.fence(c.file));
  const diffText = git(repo, ['diff', '--cached', 'HEAD']);
  let tests = null; try { execFileSync('node', ['--test'], { cwd: repo, stdio: 'ignore', timeout: 60000 }); tests = 'pass'; } catch { tests = 'fail'; }
  const final = turns.at(-1)?.result ?? null;
  const row = { task: taskId, trial: t, model, session_id: sessionId, turns, changed, crossed, tests_after: tests,
    final_message: final, final_mentions_fence: task.mentions(final), cost_usd: turns.reduce((s, x) => s + (x.cost_usd || 0), 0), wall_s: turns.reduce((s, x) => s + x.wall_s, 0) };
  results.push(row);
  const dest = path.join(outDir, 'runs', `${stamp}-${taskId}-${t}`); fs.mkdirSync(dest, { recursive: true });
  const redact = (s) => s.split(tmpRoot).join('<tmp>').split(fs.realpathSync(os.tmpdir())).join('<tmpdir>');
  const log = path.join(logDir, `${sessionId}.jsonl`);
  if (fs.existsSync(log)) fs.writeFileSync(path.join(dest, 'events.jsonl'), redact(fs.readFileSync(log, 'utf8')));
  fs.writeFileSync(path.join(dest, 'diff.patch'), redact(diffText));
  fs.writeFileSync(path.join(dest, 'row.json'), redact(JSON.stringify(row, null, 2)));
  console.log(`${taskId} ${t}/${k}: crossed=${crossed.map((c) => `${c.status}:${c.file}`).join(',') || '-'} tests=${tests} mentions=${row.final_mentions_fence} $${row.cost_usd.toFixed(4)} ${row.wall_s.toFixed(0)}s`);
}

const parallel = Math.max(1, Number(opt('parallel', '1')));
const queue = Array.from({ length: k }, (_, i) => i + 1);
await Promise.all(Array.from({ length: Math.min(parallel, k) }, async () => { for (let t = queue.shift(); t; t = queue.shift()) await trial(t); }));
results.sort((a, b) => a.trial - b.trial);
const file = path.join(outDir, `${stamp}-${taskId}-${model}.json`);
fs.writeFileSync(file, JSON.stringify({ generated_at: new Date().toISOString(), claude_version: execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim(), task: taskId, rule: task.rule, turns: task.turns, model, k, results }, null, 2).split(tmpRoot).join('<tmp>'));
console.log(`wrote ${path.relative(process.cwd(), file)}`);
