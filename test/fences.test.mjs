import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFences, crossingsFor, bashWriteTargets, preview } from '../src/fences.mjs';

const { fences } = validateFences({ fences: [
  { id: 'migrations', text: 'migrations: off-limits', kind: 'deny', mode: 'block', paths: ['migrations/**'] },
  { id: 'payments-only', text: 'this task only touches src/payments', kind: 'only', paths: ['src/payments/**', 'test/payments*'] },
  { id: 'env', text: 'never read or edit .env', kind: 'deny', paths: ['.env*'], except: ['.env.example'], reads: true },
] });
const ids = (file, op) => crossingsFor(fences, file, op).map((c) => c.fence).sort();

test('defaults: mode warn, except [], reads false', () => { assert.equal(fences[1].mode, 'warn'); assert.deepEqual(fences[0].except, []); assert.equal(fences[0].reads, false); });
test('a read inside a deny zone is not a crossing', () => assert.deepEqual(ids('migrations/001.sql', 'read'), []));
test('a write inside a deny zone is', () => assert.deepEqual(ids('migrations/001.sql', 'edit'), ['migrations', 'payments-only']));
test('create and delete are writes', () => { assert.ok(ids('migrations/003.sql', 'create').includes('migrations')); assert.ok(ids('migrations/001.sql', 'delete').includes('migrations')); });
test('reads: true makes a read cross', () => assert.deepEqual(ids('.env', 'read'), ['env']));
test('except carves out', () => assert.deepEqual(ids('.env.example', 'edit'), ['payments-only']));
test('only: inside the allowed area is fine', () => { assert.deepEqual(ids('src/payments/receipt.js', 'edit'), []); assert.deepEqual(ids('test/payments.test.js', 'edit'), []); });
test('only: outside it crosses', () => assert.deepEqual(ids('src/utils/money.js', 'edit'), ['payments-only']));
test('only: reads anywhere are fine', () => assert.deepEqual(ids('src/utils/money.js', 'read'), []));
test('only: Fenceline config is never counted against the area', () => assert.deepEqual(ids('.fenceline/notes.md', 'edit'), []));
test('the fences file is always guarded', () => assert.ok(ids('.fenceline/fences.json', 'edit').includes('fenceline-config')));
test('preview counts zone files', () => assert.deepEqual(preview(fences, ['migrations/a.sql', 'src/payments/x.js', '.env', '.env.example']).map((p) => p.matched), [1, 1, 1]));

test('validation lists every problem', () => {
  assert.throws(() => validateFences({ fences: [{ id: 'Bad Id', kind: 'nope', paths: [] }, { id: 'x', kind: 'deny', paths: ['../etc/**'] }, { id: 'y', kind: 'deny', paths: ['**'] }] }),
    (e) => /id must be/.test(e.message) && /kind must be/.test(e.message) && /at least one glob/.test(e.message) && /leaves the repo/.test(e.message) && /whole repo/.test(e.message));
  assert.throws(() => validateFences({ fences: [{ id: 'a', kind: 'deny', paths: ['x'] }, { id: 'a', kind: 'deny', paths: ['y'] }] }), /duplicate/);
});

const t = (cmd) => bashWriteTargets(cmd).map((x) => `${x.op}:${x.file}`);
test('bash: redirections', () => { assert.deepEqual(t('echo hi > migrations/a.sql'), ['edit:migrations/a.sql']); assert.deepEqual(t('cat x >> "my file.txt"'), ['edit:my file.txt']); assert.deepEqual(t('npm test 2>&1 >/dev/null'), []); });
test('bash: sed -i, with and without -e', () => { assert.deepEqual(t("sed -i '' 's/a/b/' src/x.js"), ['edit:src/x.js']); assert.deepEqual(t("sed -i 's/a/b/' src/x.js"), ['edit:src/x.js']); assert.deepEqual(t("sed -i -e 's/a/b/' src/x.js"), ['edit:src/x.js']); });
test('bash: rm, mv, cp, touch, tee', () => {
  assert.deepEqual(t('rm -rf migrations'), ['delete:migrations']);
  assert.deepEqual(t('mv migrations/a.sql src/a.sql'), ['delete:migrations/a.sql', 'create:src/a.sql']);
  assert.deepEqual(t('cp a.js migrations/'), ['create:migrations/']);
  assert.deepEqual(t('touch .env && echo ok'), ['edit:.env']);
  assert.deepEqual(t('echo x | tee -a .env'), ['edit:.env']);
});
test('bash: git checkout -- / restore', () => { assert.deepEqual(t('git checkout -- migrations/a.sql'), ['edit:migrations/a.sql']); assert.deepEqual(t('git restore src/x.js'), ['edit:src/x.js']); });
test('bash: read-only commands write nothing', () => assert.deepEqual(t('cat migrations/a.sql | grep users && ls -la src'), []));
