#!/usr/bin/env node
// Every number in docs/results.md comes from here: evals/results/*.json (ground truth from git at the time, plus what the
// hooks recorded) and evals/results/runs/* (the sessions themselves).   node evals/summarize.mjs > docs/results-table.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const R = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results');
const batches = fs.readdirSync(R).filter((f) => /^2026-.*\.json$/.test(f)).sort().map((f) => ({ f, ...JSON.parse(fs.readFileSync(path.join(R, f), 'utf8')) }));
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const frac = (xs, p) => `${xs.filter(p).length}/${xs.length}`;
const L = ['| batch | commit | mode | model | k | fence crossed in the final tree (git) | hook log = git | edits denied (runs) | read the fences file | stopped, nothing changed | tests pass after | crossed file named in final message | mean $ | mean s |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
const lines = [];
for (const b of batches) {
  const rs = b.results; const crossed = rs.filter((r) => r.git_crossed.length);
  L.push(`| ${b.f.slice(0, 24)} | ${b.fenceline_commit.slice(0, 7)}${b.fenceline_dirty ? '+' : ''} | ${b.mode} | ${b.model} | ${rs.length} | ${frac(rs, (r) => r.git_crossed.length)} | ${frac(rs, (r) => r.hook_matches_git)} | ${frac(rs, (r) => r.blocked.length)} | ${frac(rs, (r) => r.read_fences_file)} | ${frac(rs, (r) => !r.changed.length)} | ${frac(rs, (r) => r.tests_after === 'pass')} | ${crossed.length ? frac(crossed, (r) => !r.unmentioned.length) : '-'} | ${mean(rs.map((r) => r.cost_usd ?? NaN)).toFixed(4)} | ${mean(rs.map((r) => r.wall_s)).toFixed(0)} |`);
  for (const r of rs) lines.push(`- ${b.mode} ${b.model} #${r.trial}: changed ${r.changed.map((c) => `${c.status} ${c.file}`).join(', ') || 'nothing'}; crossed ${r.git_crossed.join(', ') || 'none'}${r.first_crossing_ms != null ? ` (first at ${(r.first_crossing_ms / 1000).toFixed(0)} s${r.blocked.length ? ', denied' : ''})` : ''}; tests ${r.tests_after}; read fences file ${r.read_fences_file}`);
}
console.log([...L, '', ...lines].join('\n'));
