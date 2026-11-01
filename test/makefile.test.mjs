// The root Makefile and `make doctor` (scripts/doctor.mjs). Nothing here installs anything: claude is faked.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env }; delete env.NODE_TEST_CONTEXT; delete env.MAKEFLAGS; delete env.MAKELEVEL;
const make = (args, extra = {}) => spawnSync('make', ['--no-print-directory', ...args], { cwd: REPO, encoding: 'utf8', env: { ...env, ...extra } });
const doctor = (extra) => spawnSync(process.execPath, [path.join(REPO, 'scripts', 'doctor.mjs')], { encoding: 'utf8', env: { ...env, ...extra } });
// async, for tests that serve a fake dashboard from this process (spawnSync would block its event loop)
const doctorAsync = (extra) => new Promise((resolve) => execFile(process.execPath, [path.join(REPO, 'scripts', 'doctor.mjs')], { encoding: 'utf8', env: { ...env, ...extra } }, (e, stdout) => resolve({ status: e ? e.code : 0, stdout })));
const hasMake = spawnSync('make', ['--version']).status === 0;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-make-'));
const fakeClaude = (out) => { const f = path.join(tmp, 'claude-' + Math.random().toString(36).slice(2)); fs.writeFileSync(f, '#!/bin/sh\necho "' + out + '"\n', { mode: 0o755 }); return f; };
const freePort = () => new Promise((r) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('make lists the targets', { skip: !hasMake }, () => {
  const r = make([]);
  assert.equal(r.status, 0);
  for (const t of ['install', 'uninstall', 'update', 'doctor', 'start', 'stop', 'open', 'map', 'test']) assert.match(r.stdout, new RegExp('make ' + t + '\\b'));
});

test('make install removes the old aos-dashboard plugin and stops the old monitor before installing Fenceline', { skip: !hasMake }, () => {
  const r = make(['-n', 'install']);
  assert.equal(r.status, 0);
  const at = (s) => r.stdout.indexOf(s);
  assert.ok(at('uninstall aos-dashboard@aos-local') >= 0 && at('aos.mjs stop') > at('uninstall aos-dashboard@aos-local'));
  assert.ok(at('marketplace add') > at('aos.mjs stop') && at('plugin install fenceline@fenceline') > at('marketplace add'));
});

test("the dashboard's own make install refuses inside Fenceline", { skip: !hasMake }, () => {
  const r = make(['-C', 'dashboard', 'install']);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /part of Fenceline: run +make install/);
});

test('doctor: no claude CLI and nothing on the port are both reported, exit 1', async () => {
  const r = doctor({ CLAUDE_BIN: path.join(tmp, 'no-such-claude'), PORT: String(await freePort()) });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /claude CLI was not found/);
  assert.match(r.stdout, /nothing answers on 127\.0\.0\.1:\d+/);
  assert.match(r.stdout, /ok +this checkout has the dashboard/);
});

test('doctor: flags the old aos-dashboard plugin next to Fenceline', async () => {
  const r = doctor({ CLAUDE_BIN: fakeClaude('fenceline@fenceline aos-dashboard@aos-local'), PORT: String(await freePort()) });
  assert.match(r.stdout, /ok +Fenceline plugin is installed/);
  assert.match(r.stdout, /old standalone aos-dashboard plugin is installed/);
});

test('doctor: tells the Fenceline sheet from an old AOS dashboard on the port', async () => {
  let page = '<script src="sheet.js?v=2"></script>';
  const srv = http.createServer((q, s) => { s.writeHead(200); s.end(q.url === '/api/state' ? '{"agents":[]}' : page); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const PORT = String(srv.address().port), CLAUDE_BIN = fakeClaude('fenceline@fenceline');
  try {
    const good = await doctorAsync({ CLAUDE_BIN, PORT });
    assert.equal(good.status, 0, good.stdout);
    assert.match(good.stdout, /Fenceline dashboard answers/);
    assert.match(good.stdout, /no sessions on the sheet yet/);
    page = '<title>AOS</title><script src="app.js?v=31"></script>';
    const old = await doctorAsync({ CLAUDE_BIN, PORT });
    assert.equal(old.status, 1);
    assert.match(old.stdout, /old AOS dashboard is answering/);
  } finally { srv.close(); }
});
