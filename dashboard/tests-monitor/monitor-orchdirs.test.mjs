// Orchestrator state-dir discovery, now used only for guard verdicts (<root>/verdicts): with AOS_ORCH_DIR unset the monitor reads
// BOTH the default dir (~/.aos/orch or $XDG_STATE_HOME/aos/orch) and the legacy <plugin data>/orch; with AOS_ORCH_DIR only that dir.
// Never creates dirs. The goals view is gone (/api/goals is 404); an orchestrator worker's goal/task tags still show on its agent.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { ROOT, FIXTURES, tmpDir, hookEv } from './harness.mjs';

const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const get = (port, p) => new Promise((resolve, reject) => { http.get({ host: '127.0.0.1', port, path: p, agent: false }, (r) => { let b = ''; r.on('data', (d) => { b += d; }); r.on('end', () => resolve({ status: r.statusCode, json: JSON.parse(b) })); }).on('error', reject); });
async function monitor(env) {
  const port = await freePort();
  const clean = { ...process.env }; delete clean.AOS_ORCH_DIR; delete clean.XDG_STATE_HOME; delete clean.CLAUDE_PLUGIN_DATA;
  const p = spawn(process.execPath, [path.join(ROOT, 'monitor.mjs')], { env: { ...clean, PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((res, rej) => { p.stdout.on('data', (d) => { if (String(d).includes('live monitor on')) res(); }); p.on('exit', () => rej(new Error('exit'))); setTimeout(() => rej(new Error('timeout')), 8000); });
  return { port, stop: () => new Promise((r) => { p.on('exit', r); p.kill('SIGTERM'); setTimeout(() => p.kill('SIGKILL'), 1500).unref(); }) };
}
function putVerdict(root, id) {
  const d = path.join(root, 'verdicts'); fs.mkdirSync(d, { recursive: true });
  const v = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'verdicts', 'v-20261021-100000-aaaaaa.json'), 'utf8'));
  fs.writeFileSync(path.join(d, id + '.json'), JSON.stringify({ ...v, id }));
}
const ids = (j) => j.verdicts.map((v) => v.id).sort();

test('default: reads verdicts from the default dir (~/.aos/orch) and the legacy plugin-data dir', async () => {
  const T = tmpDir('aos-orchdirs-'), home = path.join(T, 'home'), data = path.join(T, 'data'), live = path.join(T, 'live');
  fs.mkdirSync(live, { recursive: true });
  putVerdict(path.join(home, '.aos', 'orch'), 'v-20261021-100000-000001');
  putVerdict(path.join(data, 'orch'), 'v-20261021-100000-000002');
  const m = await monitor({ HOME: home, CLAUDE_PLUGIN_DATA: data, AOS_LIVE_DIR: live });
  try {
    assert.deepEqual(ids((await get(m.port, '/api/verdicts')).json), ['v-20261021-100000-000001', 'v-20261021-100000-000002']);
    assert.equal((await get(m.port, '/api/goals')).status, 404);
    assert.equal((await get(m.port, '/api/state')).json.goals, undefined);
  } finally { await m.stop(); fs.rmSync(T, { recursive: true, force: true }); }
});

test('AOS_ORCH_DIR: only that dir; nothing is created', async () => {
  const T = tmpDir('aos-orchdirs-'), home = path.join(T, 'home'), only = path.join(T, 'only'), live = path.join(T, 'live');
  fs.mkdirSync(live, { recursive: true });
  putVerdict(path.join(home, '.aos', 'orch'), 'v-20261021-100000-000001');
  putVerdict(only, 'v-20261021-100000-000003');
  const m = await monitor({ HOME: home, AOS_ORCH_DIR: only, AOS_LIVE_DIR: live });
  try {
    assert.deepEqual(ids((await get(m.port, '/api/verdicts')).json), ['v-20261021-100000-000003']);
    assert.ok(!fs.existsSync(path.join(T, 'data')) && !fs.existsSync(path.join(only, 'goals')), 'no dir created');
  } finally { await m.stop(); fs.rmSync(T, { recursive: true, force: true }); }
});

test('an orchestrator worker keeps its goal/task tags; an untagged session has none', async () => {
  const T = tmpDir('aos-orchdirs-'), home = path.join(T, 'home'), live = path.join(T, 'live');
  fs.mkdirSync(live, { recursive: true });
  const at = (ms) => new Date(Date.now() + ms).toISOString();
  fs.writeFileSync(path.join(live, 'hook-events.ndjson'), [
    hookEv({ ts: at(-5000), ev: 'SessionStart', sid: 'wrk1aaaa', cwd: 'repo', cwdp: path.join(T, 'repo'), gid: 'g-test', tid: 't1' }),
    hookEv({ ts: at(-4000), ev: 'UserPromptSubmit', sid: 'wrk1aaaa', cwd: 'repo', cwdp: path.join(T, 'repo'), gid: 'g-test', tid: 't1' }),
    hookEv({ ts: at(-3000), ev: 'UserPromptSubmit', sid: 'user1aaa', cwd: 'repo', cwdp: path.join(T, 'repo') })].join(''));
  const m = await monitor({ HOME: home, AOS_LIVE_DIR: live });
  try {
    const s = (await get(m.port, '/api/state')).json;
    const w = s.agents.find((a) => a.goal_id === 'g-test'), u = s.agents.find((a) => a.id.includes('user'));
    assert.ok(w && w.task_id === 't1' && w.goal_title === undefined && w.out_of_scope === undefined);
    assert.ok(u && u.goal_id === undefined && u.task_id === undefined);
  } finally { await m.stop(); fs.rmSync(T, { recursive: true, force: true }); }
});
