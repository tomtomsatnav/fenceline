import test from 'node:test';
import assert from 'node:assert/strict';
import { compileFences, buildPrompt, parseCompiled, outline } from '../src/compile.mjs';

const files = ['migrations/001.sql', 'src/payments/receipt.js', 'src/utils/money.js', 'test/payments.test.js', '.env'];
test('the prompt carries the rules verbatim and the real folder names', () => {
  const p = buildPrompt(['migrations: off-limits'], files);
  assert.match(p, /1\. migrations: off-limits/); assert.match(p, /src\/payments\/ \(1 files\)/); assert.match(p, /migrations\/001\.sql/);
});
test('outline truncates long file lists and says so', () => assert.match(outline(Array.from({ length: 500 }, (_, i) => `f${i}.js`), { maxFiles: 10 }), /first 10 of 500/));
test('one LLM call, mode applied, ids normalised', () => {
  let calls = 0;
  const llm = () => { calls++; return { structured_output: { fences: [{ id: 'Migrations Zone', text: 'migrations: off-limits', kind: 'deny', paths: ['migrations/**'] }] } }; };
  const { fences } = compileFences(['migrations: off-limits'], files, { llm, mode: 'block' });
  assert.equal(calls, 1); assert.equal(fences[0].id, 'migrations-zone'); assert.equal(fences[0].mode, 'block');
});
test('accepts a plain result string with JSON in it', () => assert.equal(parseCompiled({ result: 'Here: {"fences":[{"id":"env","text":"never edit .env","kind":"deny","paths":[".env*"]}]}' }).fences[0].id, 'env'));
test('bad compiler output is rejected, not saved', () => {
  assert.throws(() => parseCompiled({ structured_output: { fences: [{ id: 'x', text: 'x', kind: 'deny', paths: ['../../etc/passwd'] }] } }), /leaves the repo/);
  assert.throws(() => parseCompiled('no json here'), /no JSON/);
});
