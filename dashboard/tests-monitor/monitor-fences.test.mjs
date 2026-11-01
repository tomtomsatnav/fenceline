// Fenceline fences (Fenceline's sessions under FENCELINE_HOME/sessions/<id>/): GET /api/fences, the /api/state `fences` summary,
// the agent `fence` badge, Needs-you after a denial, and what is never exposed (paths, command text, the full session id).
// The session folders are hand-written in the shape Fenceline's hook writes (src/session.mjs, src/trail.mjs).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, startMonitor, sleep, hookEv } from './harness.mjs';

const TMP = tmpDir('aos-monfence-'), FL = path.join(TMP, 'fl'), S = path.join(FL, 'sessions'), LIVE = path.join(TMP, 'live'), ORCH = path.join(TMP, 'orch');
const SID = 'sessAAAA-1111-2222-3333-444455556666', SID2 = 'otherBBB-1111-2222-3333-444455556666';
const REPO = '/Users/someone/secret-work/shop';
const t = (s) => new Date(Date.now() - s * 1000).toISOString();
function session(sid, events, meta = {}) {
  const d = path.join(S, sid); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'meta.json'), JSON.stringify({ schema: 'fenceline.session/1', session_id: sid, repo: REPO, cwd: REPO, started_at: t(60),
    fences: [{ id: 'migrations', text: 'migrations: off-limits', kind: 'deny', mode: 'block', paths: ['migrations/**'] }, { id: 'payments-only', text: 'this task only touches src/payments', kind: 'only', mode: 'warn', paths: ['src/payments/**'] }], ...meta }));
  fs.writeFileSync(path.join(d, 'events.jsonl'), events.map((e, i) => JSON.stringify({ i, ...e })).join('\n') + '\n');
}
let M;
before(async () => {
  fs.mkdirSync(LIVE, { recursive: true }); fs.mkdirSync(ORCH);
  session(SID, [
    { t: t(50), kind: 'session', source: 'startup' },
    { t: t(40), kind: 'crossing', tool: 'Bash', command: "sed -i 's/a/b/' /Users/someone/secret-work/shop/src/utils/money.js && echo TOKEN=sk-live-123", touches: [], crossings: [{ fence: 'payments-only', text: 'this task only touches src/payments', file: 'src/utils/money.js', op: 'edit', prevented: false }] },
    { t: t(30), kind: 'stop', unmentioned: [] },
    { t: t(20), kind: 'blocked', tool: 'Edit', touches: [], crossings: [{ fence: 'migrations', text: 'migrations: off-limits', file: 'migrations/003_add.js', op: 'create', prevented: true }] },
    { t: t(10), kind: 'stop', unmentioned: [] },
  ]);
  session(SID2, [{ t: t(15), kind: 'session' }, { t: t(12), kind: 'touch', tool: 'Read', touches: [{ file: 'src/a.js', op: 'read' }], crossings: [] }]);
  fs.writeFileSync(path.join(LIVE, 'hook-events.ndjson'), hookEv({ ts: t(5), ev: 'SessionStart', sid: 'sessAAAA', cwd: 'shop' }) + hookEv({ ts: t(4), ev: 'UserPromptSubmit', sid: 'sessAAAA', cwd: 'shop' }) + hookEv({ ts: t(4), ev: 'UserPromptSubmit', sid: 'otherBBB', cwd: 'misc' }));
  M = await startMonitor({ orch: ORCH, live: LIVE, env: { FENCELINE_HOME: FL } });
});
after(async () => { await M.stop(); fs.rmSync(TMP, { recursive: true, force: true }); });
const noLeaks = (txt, what) => {
  assert.ok(!txt.includes('/Users/') && !txt.includes(TMP), what + ': an absolute path leaked');
  assert.ok(!txt.includes('sed -i') && !txt.includes('sk-live') && !txt.includes('TOKEN'), what + ': command text leaked');
  assert.ok(!txt.includes('sessAAAA-1111') && !txt.includes('src/utils/money.js'), what + ': full session id or repo-relative path leaked');
};

test('GET /api/fences: sessions newest first, fences, counts, crossings by basename, needs after a denial', async () => {
  const r = await M.get('/api/fences'); assert.equal(r.status, 200);
  const [a, b] = r.json.sessions;
  assert.equal(r.json.sessions.length, 2);
  assert.equal(a.repo_name, 'shop'); assert.match(a.id, /^f-[0-9a-f]{12}$/); assert.equal(a.agent, 'Claude Code·sess');
  assert.deepEqual(a.fences.map((f) => [f.id, f.kind, f.mode]), [['migrations', 'deny', 'block'], ['payments-only', 'only', 'warn']]);
  assert.equal(a.fences[0].paths, undefined);
  assert.deepEqual([a.crossed, a.blocked, a.needs], [1, 1, 'denied']);
  assert.deepEqual(a.latest.map((c) => [c.fence, c.file, c.op, c.prevented, c.tool]), [['migrations', '003_add.js', 'create', true, 'Edit'], ['payments-only', 'money.js', 'edit', false, 'Bash']]);
  assert.deepEqual([b.crossed, b.blocked, b.needs], [0, 0, null]);
  noLeaks(r.text, 'api');
});

test('/api/state: fences summary, a Needs-you item, and the fence badge on the linked session', async () => {
  const s = (await M.get('/api/state')).json;
  assert.deepEqual([s.fences.sessions, s.fences.crossed, s.fences.blocked], [2, 1, 1]);
  assert.deepEqual(s.fences.needs.map((n) => [n.repo_name, n.needs, n.agent]), [['shop', 'denied', 'Claude Code·sess']]);
  const a = s.agents.find((x) => x.id === 'Claude Code·sess');
  assert.deepEqual({ ...a.fence, id: undefined }, { id: undefined, crossed: 1, blocked: 1, needs: 'denied', fences: 2 });
  noLeaks(JSON.stringify(s), 'state');
});

test('a new turn after the denial clears Needs-you; an unmentioned crossing at Stop raises it', async () => {
  const f = path.join(S, SID, 'events.jsonl');
  fs.appendFileSync(f, JSON.stringify({ i: 9, t: t(2), kind: 'touch', tool: 'Read', touches: [], crossings: [] }) + '\n');
  await sleep(1150);
  assert.equal((await M.get('/api/state')).json.fences.needs.length, 0);
  fs.appendFileSync(f, JSON.stringify({ i: 10, t: t(1), kind: 'crossing', tool: 'Write', touches: [], crossings: [{ fence: 'payments-only', text: 'x', file: 'src/cart/total.js', op: 'edit', prevented: false }] }) + '\n'
    + JSON.stringify({ i: 11, t: t(0), kind: 'stop', unmentioned: ['src/cart/total.js'] }) + '\n');
  await sleep(1150);
  const s = (await M.get('/api/state')).json;
  assert.deepEqual(s.fences.needs.map((n) => n.needs), ['unmentioned']); assert.equal(s.fences.crossed, 2);
});

test('replay (?at=) omits fences and fence badges', async () => {
  const s = (await M.get('/api/state?at=' + encodeURIComponent(new Date().toISOString()))).json;
  assert.equal(s.fences, undefined); assert.ok(s.agents.every((a) => a.fence === undefined));
});

test('bad folders, bad JSON, oversized meta and symlinks are ignored, never fatal', async () => {
  fs.mkdirSync(path.join(S, 'bad id!'), { recursive: true }); fs.writeFileSync(path.join(S, 'bad id!', 'events.jsonl'), '{}\n');
  session('brokenMeta1', [{ t: t(1), kind: 'session' }]); fs.writeFileSync(path.join(S, 'brokenMeta1', 'meta.json'), '{"repo":');
  session('junkEvents1', []); fs.writeFileSync(path.join(S, 'junkEvents1', 'events.jsonl'), 'not json\n[1,2]\n{"kind":"crossing","crossings":"x"}\n{"kind":"blocked","crossings":[null,{"file":7,"op":"nuke"}]}\n');
  fs.mkdirSync(path.join(TMP, 'outside'), { recursive: true }); fs.symlinkSync(path.join(TMP, 'outside'), path.join(S, 'linkedOut1'));
  await sleep(1150);
  const r = await M.get('/api/fences'); assert.equal(r.status, 200);
  const ids = r.json.sessions.map((x) => x.repo_name);
  assert.equal(r.json.sessions.length, 3); // the two real sessions + junkEvents1 (valid meta, junk events skipped)
  const j = r.json.sessions.find((x) => x.blocked === 1 && x.crossed === 0 && x.repo_name === 'shop' && x.latest.length === 1);
  assert.ok(j, 'junk crossings are cleaned, not fatal: ' + JSON.stringify(r.json.sessions.map((x) => [x.repo_name, x.crossed, x.blocked, x.latest.length])));
  assert.deepEqual([j.latest[0].file, j.latest[0].op], ['', 'edit']);
  assert.equal((await M.get('/api/state')).status, 200);
});
