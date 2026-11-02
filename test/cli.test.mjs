// The fenceline CLI's guards: accept only adds fences unless --replace, and record refuses . and .. as a name.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'fenceline.mjs');
const env = { ...process.env, FENCELINE_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'fl-cli-home-')) }; delete env.NODE_TEST_CONTEXT;
function repo() {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-cli-'));
  spawnSync('git', ['init', '-q'], { cwd: r }); fs.mkdirSync(path.join(r, 'migrations')); fs.writeFileSync(path.join(r, 'migrations', '001.sql'), 'x\n');
  fs.mkdirSync(path.join(r, '.fenceline'));
  fs.writeFileSync(path.join(r, '.fenceline', 'fences.json'), JSON.stringify({ schema: 'fenceline.fences/1', fences: [{ id: 'migrations', text: 'migrations: off-limits', kind: 'deny', mode: 'block', paths: ['migrations/**'] }] }));
  return r;
}
const run = (r, ...args) => spawnSync(process.execPath, [BIN, ...args], { cwd: r, encoding: 'utf8', env });
const propose = (r, fences) => fs.writeFileSync(path.join(r, '.fenceline', 'proposed.json'), JSON.stringify({ fences }));
const saved = (r) => JSON.parse(fs.readFileSync(path.join(r, '.fenceline', 'fences.json'), 'utf8')).fences;

test('accept refuses to replace an existing fence (it could loosen it) unless --replace', () => {
  const r = repo();
  propose(r, [{ id: 'migrations', text: 'migrations: warn only', kind: 'deny', mode: 'warn', paths: ['migrations/old/**'] }]);
  const no = run(r, 'accept');
  assert.equal(no.status, 1);
  assert.match(no.stderr, /would replace existing fence migrations.*fenceline accept --replace/);
  assert.equal(saved(r)[0].mode, 'block');
  assert.ok(fs.existsSync(path.join(r, '.fenceline', 'proposed.json')), 'the proposal is kept');
  const yes = run(r, 'accept', '--replace');
  assert.equal(yes.status, 0, yes.stderr);
  assert.equal(saved(r)[0].mode, 'warn');
});

test('accept adds a new fence without --replace', () => {
  const r = repo();
  propose(r, [{ id: 'env', text: 'never edit .env', kind: 'deny', mode: 'warn', paths: ['.env*'] }]);
  const out = run(r, 'accept');
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(saved(r).map((f) => f.id).sort(), ['env', 'migrations']);
});

test('record refuses . and .. as the recording name', () => {
  for (const name of ['.', '..']) assert.equal(run(os.tmpdir(), 'record', 'some-session', name).status, 2);
});
