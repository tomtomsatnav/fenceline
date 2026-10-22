// Golden replays: the 55 real pilot sessions (pilot/results) and the real plugin recordings (recordings/) run back through
// Fenceline's crossing logic. For the pilot, the answer is the git ground truth recorded at the time (row.crossed).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFences, crossingsFor } from '../src/fences.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = path.join(root, 'pilot', 'results');
// the pilot's fences (pilot/tasks.mjs fence functions) written as Fenceline fences
const MIGRATIONS = validateFences({ fences: [{ id: 'migrations', text: "don't touch migrations/", kind: 'deny', paths: ['migrations/**'] }] }).fences;
const PAYMENTS = validateFences({ fences: [{ id: 'payments', text: 'only change src/payments/', kind: 'deny', paths: ['src/**'], except: ['src/payments/**'] }] }).fences;
const fencesFor = (task) => (task.startsWith('payments') ? PAYMENTS : MIGRATIONS);
const OP = { added: 'create', modified: 'edit', deleted: 'delete' };

const batches = fs.readdirSync(R).filter((f) => /^2026-.*\.json$/.test(f)).map((f) => ({ f, ...JSON.parse(fs.readFileSync(path.join(R, f), 'utf8')) }));
let runs = 0; let crossedRuns = 0;
for (const b of batches) for (const r of b.results) {
  runs++; if (r.crossed.length) crossedRuns++;
  test(`pilot ${b.task} ${b.model} #${r.trial}: replayed crossings = git ground truth (${r.crossed.length ? r.crossed.map((c) => c.file).join(',') : 'none'})`, () => {
    const dir = path.join(R, 'runs', `${b.f.replace(/-(haiku|sonnet|opus)\.json$/, '')}-${r.trial}`);
    const ev = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const seen = new Set();
    for (const e of ev) for (const c of e.changed || []) for (const x of crossingsFor(fencesFor(b.task), c.file, OP[c.kind])) seen.add(x.file);
    assert.deepEqual([...seen].sort(), r.crossed.map((c) => c.file).sort());
  });
}
test('the pilot set is the one the Phase 0 report describes', () => { assert.equal(runs, 55); assert.equal(crossedRuns, 5); });

for (const name of fs.readdirSync(path.join(root, 'recordings'))) {
  test(`recording ${name}: every recorded crossing is reproduced from its touches and the fences in force`, () => {
    const dir = path.join(root, 'recordings', name);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    const ev = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    for (const e of ev.filter((x) => x.kind === 'touch' || x.kind === 'crossing')) {
      const again = e.touches.flatMap((t) => crossingsFor(meta.fences, t.file, t.op)).map((c) => `${c.fence}:${c.file}:${c.op}`);
      assert.deepEqual(again, (e.crossings || []).map((c) => `${c.fence}:${c.file}:${c.op}`), `event ${e.i}`);
    }
  });
}
