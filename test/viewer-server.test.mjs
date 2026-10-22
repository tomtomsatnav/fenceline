import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../viewer/server.mjs';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-home-'));
const sdir = path.join(home, 'sessions', 'sess-1');
fs.mkdirSync(sdir, { recursive: true });
fs.writeFileSync(path.join(sdir, 'meta.json'), JSON.stringify({ session_id: 'sess-1', repo_name: 'demo', started_at: '2026-01-01T00:00:00Z', fences: [], files: [] }));
fs.writeFileSync(path.join(sdir, 'events.jsonl'), JSON.stringify({ i: 0, kind: 'session' }) + '\n');

const srv = createServer({ home });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
test.after(() => { srv.closeAllConnections?.(); srv.close(); });

test('static pages and modules', async () => {
  for (const p of ['/', '/glob.mjs', '/layout.mjs']) { const r = await fetch(base + p); assert.equal(r.status, 200, p); }
  assert.match((await fetch(base + '/layout.mjs')).headers.get('content-type'), /javascript/);
});
test('recordings list and fetch', async () => {
  const list = await (await fetch(base + '/api/recordings')).json();
  assert.ok(list.some((r) => r.name === 'e2e-payments-haiku'));
  const rec = await (await fetch(base + '/api/recording/e2e-payments-haiku')).json();
  assert.ok(rec.events.length >= 7 && rec.meta.files.length && rec.summary);
});
test('bad names and unknown ids', async () => {
  assert.equal((await fetch(base + '/api/recording/a%20b')).status, 400);
  assert.equal((await fetch(base + '/api/recording/nope')).status, 404);
  assert.equal((await fetch(base + '/api/session/bad.id')).status, 400);
  assert.equal((await fetch(base + '/api/session/missing')).status, 404);
  assert.equal((await fetch(base + '/nothing')).status, 404);
});
test('sessions list and session payload', async () => {
  const list = await (await fetch(base + '/api/sessions')).json();
  assert.equal(list[0].repo_name, 'demo');
  const s = await (await fetch(base + '/api/session/sess-1')).json();
  assert.equal(s.events.length, 1);
});
test('SSE delivers appended events and the summary', async () => {
  const ac = new AbortController();
  const r = await fetch(base + '/api/stream/sess-1', { signal: ac.signal });
  assert.equal(r.status, 200);
  const rd = r.body.getReader(); const dec = new TextDecoder(); let got = '';
  setTimeout(() => {
    fs.appendFileSync(path.join(sdir, 'events.jsonl'), JSON.stringify({ i: 1, kind: 'touch', touches: [] }) + '\n');
    fs.writeFileSync(path.join(sdir, 'summary.json'), JSON.stringify({ crossings: [] }));
  }, 100);
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && !(got.includes('event: ev') && got.includes('event: summary'))) {
    const { value, done } = await rd.read(); if (done) break; got += dec.decode(value);
  }
  ac.abort();
  assert.match(got, /event: ev\ndata: \{"i":1,/);
  assert.ok(!got.includes('"i":0'), 'pre-existing events are not re-sent');
  assert.match(got, /event: summary/);
});
