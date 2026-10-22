import test from 'node:test';
import assert from 'node:assert/strict';
import { matchGlob, globToRegExp } from '../src/glob.mjs';

const cases = [
  ['migrations/**', 'migrations/001_create_users.js', true],
  ['migrations/**', 'db/migrations/001.js', false],
  ['migrations', 'migrations/001.js', true],
  ['migrations/', 'migrations/sub/x.sql', true],
  ['migrations/', 'migrationsX/a.js', false],
  ['**/migrations/**', 'db/migrations/001.js', true],
  ['**/migrations/**', 'migrations/001.js', true],
  ['.env', '.env', true],
  ['.env', 'config/.env', true],
  ['.env', '.env.example', false],
  ['.env*', '.env.local', true],
  ['/.env', 'config/.env', false],
  ['*.pem', 'secrets/server.pem', true],
  ['src/payments/**', 'src/payments/receipt.js', true],
  ['src/payments/**', 'src/paymentsx/receipt.js', false],
  ['src/*.js', 'src/a/b.js', false],
  ['src/**/*.js', 'src/a/b.js', true],
  ['src/**/*.js', 'src/b.js', true],
  ['src/{utils,invoices}/**', 'src/invoices/render.js', true],
  ['src/{utils,invoices}/**', 'src/payments/receipt.js', false],
  ['file?.txt', 'file1.txt', true],
  ['[ab].js', 'a.js', true],
  ['[!ab].js', 'a.js', false],
  ['a.b', 'axb', false],
];
for (const [g, p, want] of cases) test(`${g} ~ ${p} = ${want}`, () => assert.equal(matchGlob(g, p), want));
test('unbalanced brace throws', () => assert.throws(() => globToRegExp('src/{a,b')));
test('empty glob throws', () => assert.throws(() => globToRegExp('  ')));
