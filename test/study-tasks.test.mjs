// The six study tasks behave as designed, checked with reference solutions instead of agents: the seed fails its tests;
// the proper fix passes everything (and, for a conflict task, needs a fenced file); a legitimate in-scope route, where the
// rubric says there is one, passes without crossing; every known workaround passes the visible tests without crossing,
// so PAPER can occur at all, and is caught by the seed or hidden tests or left to the judge as the rubric says.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TASKS, CONFLICT, CONTROL } from '../study/tasks/index.mjs';
import { seedRepo, writeTree, testChecks, git } from '../study/lib/repo.mjs';
import { validateFences, crossingsFor } from '../src/fences.mjs';

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'study-task-')));
function attempt(task, solve) {
  const seed = task.files(); const dir = tmp(); seedRepo(dir, seed);
  const after = solve(seed);
  for (const rel of Object.keys(seed)) if (!(rel in after)) fs.rmSync(path.join(dir, rel));
  writeTree(dir, after);
  git(dir, ['add', '-A']);
  const fences = validateFences({ fences: task.fences('warn') }).fences;
  const crossed = git(dir, ['diff', '--cached', '--name-status', 'HEAD']).split('\n').filter(Boolean)
    .flatMap((l) => { const [s, f] = l.split('\t'); return crossingsFor(fences, f, s === 'A' ? 'create' : s === 'D' ? 'delete' : 'edit'); });
  const r = { ...testChecks(dir, seed, task.hidden), crossed: crossed.map((c) => c.file) };
  fs.rmSync(dir, { recursive: true, force: true });
  return r;
}

test('four conflict tasks and two controls', () => { assert.equal(CONFLICT.length, 4); assert.equal(CONTROL.length, 2); });
for (const task of Object.values(TASKS)) {
  test(`${task.id}: the seed fails its tests and has no fence crossed`, () => {
    const r = attempt(task, (f) => f);
    assert.equal(r.tests_pass, false); assert.equal(r.seed_tests_pass, false); assert.deepEqual(r.crossed, []);
  });
  test(`${task.id}: the proper fix passes the visible and hidden tests${task.kind === 'conflict' ? ' and crosses the fence' : ' inside scope'}`, () => {
    const r = attempt(task, task.solutions.proper);
    assert.equal(r.tests_pass, true); assert.equal(r.seed_tests_pass, true); assert.equal(r.hidden.pass, true);
    if (task.kind === 'conflict') assert.ok(r.crossed.length > 0, 'a conflict task\'s proper fix must sit behind the fence');
    else assert.deepEqual(r.crossed, []);
  });
  if (task.solutions.reroute) test(`${task.id}: the legitimate in-scope route passes everything without crossing`, () => {
    assert.equal(task.legitRoute, true);
    const r = attempt(task, task.solutions.reroute);
    assert.deepEqual([r.tests_pass, r.seed_tests_pass, r.hidden.pass, r.crossed], [true, true, true, []]);
  });
  for (const [name, solve] of Object.entries(task.solutions.workarounds)) test(`${task.id}: workaround ${name} passes the visible tests without crossing`, () => {
    const r = attempt(task, solve);
    assert.equal(r.tests_pass, true); assert.deepEqual(r.crossed, []);
    // editing the tests is always caught mechanically by the seed tests
    if (/test/.test(name)) assert.equal(r.seed_tests_pass, false);
  });
  test(`${task.id}: has a rubric listing every known workaround`, () => {
    const rubric = fs.readFileSync(new URL(`../study/tasks/${task.id}/rubric.md`, import.meta.url), 'utf8');
    for (const name of Object.keys(task.solutions.workarounds)) assert.match(rubric, new RegExp(`\`${name}\``), `rubric names ${name}`);
  });
}
