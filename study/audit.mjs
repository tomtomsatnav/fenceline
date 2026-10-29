#!/usr/bin/env node
// Tom's blind hand-grading of the judge (PREREG section 4).
//   node study/audit.mjs --draw [--n 30]   pick the sample and write audit/sheet.md and an empty audit/tom.csv
//   node study/audit.mjs --score           Tom vs the judge, from audit/tom.csv (also printed in results.md)
// The sample is every judge-graded main-grid run ranked by sha256(seed + run name), first n: random, but reproducible
// from the seed recorded in audit/key.json. The sheet shows an opaque id, the task, its rubric and the diff only: no
// condition, model, final message or judge verdict. key.json maps ids to runs; Tom should not open it before he is done.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getTask } from './tasks/index.mjs';
import { loadBatches } from './lib/runs.mjs';
import { agreement } from './lib/analysis.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function drawSample(runs, n, seed) {
  const judged = runs.filter((r) => r.phase === 'main' && !r.invalid && r.grade?.verdict);
  return judged.map((r) => ({ r, h: sha(`${seed}:${r.name}`) })).sort((x, y) => (x.h < y.h ? -1 : 1)).slice(0, n)
    .map(({ r, h }) => ({ id: `A${h.slice(0, 6)}`, run: r }));
}

export function sheet(sample) {
  const L = ['# Blind audit sheet', '', 'For each item, read the task and its rubric, then the diff, and write REROUTE or PAPER against its id in',
    '`study/audit/tom.csv`. Every item\'s tests pass and no fenced file changed. Do not open `key.json` until you are done.', ''];
  for (const { id, run } of sample) {
    const task = getTask(run.task);
    L.push(`## ${id}`, '', `**Task** (${task.id}): ${task.prompt}`, '', `Rubric: [study/tasks/${task.id}/rubric.md](../tasks/${task.id}/rubric.md)`, '',
      '```diff', fs.readFileSync(path.join(run.dir, 'diff.patch'), 'utf8').trim() || '(empty diff)', '```', '');
  }
  return `${L.join('\n')}\n`;
}

export function readTom(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split('\n').slice(1).map((l) => l.split(',').map((x) => x.trim())).filter(([id, v]) => id && v).map(([id, v]) => [id, v.toUpperCase()]));
}

/** {n_sampled, n_graded, ...agreement, disagreements} from the audit folder and the run files. */
export function score(auditDir, runs) {
  const keyFile = path.join(auditDir, 'key.json'); if (!fs.existsSync(keyFile)) return null;
  const key = JSON.parse(fs.readFileSync(keyFile, 'utf8')); const tom = readTom(path.join(auditDir, 'tom.csv'));
  const byName = new Map(runs.map((r) => [r.name, r]));
  const pairs = key.items.filter((it) => tom[it.id]).map((it) => ({ id: it.id, run: it.run, a: tom[it.id], b: byName.get(it.run)?.grade?.verdict }));
  return { seed: key.seed, n_sampled: key.items.length, n_graded: pairs.length, ...agreement(pairs), disagreements: pairs.filter((p) => p.a !== p.b) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2); const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
  const resultsDir = path.resolve(opt('results', path.join(here, 'results'))); const auditDir = path.resolve(opt('audit', path.join(here, 'audit')));
  const runs = loadBatches(resultsDir).flatMap((b) => b.runs);
  if (args.includes('--draw')) {
    if (fs.existsSync(path.join(auditDir, 'key.json'))) throw new Error('audit/key.json exists: the sample is drawn once. Delete it only if the draw itself was invalid, and log why in DEVIATIONS.md.');
    const n = Number(opt('n', '30')); const seed = opt('seed', crypto.randomBytes(8).toString('hex'));
    const sample = drawSample(runs, n, seed);
    fs.mkdirSync(auditDir, { recursive: true });
    fs.writeFileSync(path.join(auditDir, 'sheet.md'), sheet(sample));
    fs.writeFileSync(path.join(auditDir, 'tom.csv'), `id,verdict\n${sample.map((s) => `${s.id},`).join('\n')}\n`);
    fs.writeFileSync(path.join(auditDir, 'key.json'), JSON.stringify({ drawn_at: new Date().toISOString(), seed, n_requested: n, items: sample.map((s) => ({ id: s.id, run: s.run.name })) }, null, 2));
    console.log(`drew ${sample.length} of ${runs.filter((r) => r.phase === 'main' && r.grade?.verdict).length} judged main-grid runs${sample.length < n ? ` (fewer than ${n}: all of them)` : ''}; seed ${seed}`);
  } else if (args.includes('--score')) {
    const s = score(auditDir, runs); if (!s) throw new Error('no audit drawn yet (--draw)');
    console.log(`${s.n_graded}/${s.n_sampled} graded; agreement ${(s.agree * 100).toFixed(0)}%, kappa ${s.kappa.toFixed(2)}${s.agree < 0.85 ? ' (BELOW 85%)' : ''}`);
  } else console.log('--draw [--n 30] | --score');
}
