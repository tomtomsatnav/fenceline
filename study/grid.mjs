#!/usr/bin/env node
// The pre-registered grids (PREREG section 7), one run.mjs batch per cell, in a fixed order. A cell that already has a
// batch for this phase is skipped, never rerun. Stops at the first batch that stops early (budget).
//   node study/grid.mjs --phase pilot|main [--dry] [--parallel 2]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TASKS } from './tasks/index.mjs';
import { PRESENTATIONS } from './lib/presentation.mjs';
import { loadBatches, MEAN_COST_LIMIT_USD } from './lib/runs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const GRIDS = {
  pilot: { tasks: ['yen-receipt'], presentations: Object.keys(PRESENTATIONS), models: ['haiku'], k: 5 },
  main: { tasks: Object.keys(TASKS), presentations: Object.keys(PRESENTATIONS), models: ['haiku', 'sonnet'], k: 10 },
};
export const cellsOf = (g) => g.models.flatMap((model) => g.tasks.flatMap((task) => g.presentations.map((presentation) => ({ task, presentation, model, k: g.k }))));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2); const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
  const phase = opt('phase'); const g = GRIDS[phase]; if (!g) throw new Error(`--phase ${Object.keys(GRIDS).join('|')} (phases 3 and 4 are run cell by cell after Tom approves them)`);
  const resultsDir = path.resolve(opt('out', path.join(here, 'results')));
  const done = new Set(loadBatches(resultsDir).filter((b) => b.phase === phase).map((b) => `${b.task}|${b.presentation}|${b.model_alias}`));
  for (const c of cellsOf(g)) {
    const cmd = ['study/run.mjs', '--phase', phase, '--task', c.task, '--presentation', c.presentation, '--model', c.model, '--k', String(c.k), '--parallel', opt('parallel', '2'), ...(opt('out') ? ['--out', resultsDir] : [])];
    if (done.has(`${c.task}|${c.presentation}|${c.model}`)) { console.log(`skip (already run): ${c.task} ${c.presentation} ${c.model}`); continue; }
    console.log(`node ${cmd.join(' ')}`);
    if (args.includes('--dry')) continue;
    const r = spawnSync(process.execPath, cmd, { cwd: path.join(here, '..'), stdio: 'inherit' });
    if (r.status === 3) { console.log('stopped: budget reached'); process.exit(3); }
    if (r.status !== 0) { console.log(`stopped: run.mjs exited ${r.status}`); process.exit(r.status ?? 1); }
    const limit = MEAN_COST_LIMIT_USD[c.model];
    const costs = loadBatches(resultsDir).filter((b) => b.phase === phase && b.model_alias === c.model).flatMap((b) => b.runs).map((x) => x.cost_usd).filter((x) => x != null);
    if (limit && costs.length && costs.reduce((a, b) => a + b, 0) / costs.length > limit) { console.log(`stopped: mean ${c.model} run costs $${(costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(3)}, over the $${limit} limit`); process.exit(4); }
  }
  if (fs.existsSync(resultsDir)) console.log('grid done; next: node study/judge.mjs && node study/build-results.mjs');
}
