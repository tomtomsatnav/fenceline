// Reading the run files back: batches (study/results/<batch>.json), each run's row.json, and the judge's grade.json.
// Everything results.md and the budget check say comes through here.
import fs from 'node:fs';
import path from 'node:path';

export const PHASES = { pilot: 1, main: 2, opus: 3, long: 4 };
// phases 1 and 2 share Tom's approved budget (brief section 6); 3 and 4 each need their own approval
export const SHARED_CAP_PHASES = ['pilot', 'main'];
export const SHARED_CAP_USD = 35;

export function loadBatches(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /^\d{4}-.*\.json$/.test(f)).sort().map((f) => {
    const b = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const runs = b.runs.map((name) => {
      const rd = path.join(dir, 'runs', name);
      const row = JSON.parse(fs.readFileSync(path.join(rd, 'row.json'), 'utf8'));
      const grade = fs.existsSync(path.join(rd, 'grade.json')) ? JSON.parse(fs.readFileSync(path.join(rd, 'grade.json'), 'utf8')) : null;
      return { ...row, dir: rd, name, grade };
    });
    return { file: f, ...b, runs };
  });
}

// a run whose cost is unknown (killed at the timeout) is counted at its per-trial cap, so the budget never under-counts
export const runCost = (r) => (r.cost_usd ?? r.max_budget_usd ?? 0) + (r.grade?.cost_usd ?? 0);
export function spend(batches, phases) {
  return batches.filter((b) => phases.includes(b.phase)).flatMap((b) => b.runs).reduce((s, r) => s + runCost(r), 0);
}
