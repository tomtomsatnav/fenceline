// The merged plugin end to end: every hook command in hooks/hooks.json is run as Claude Code would run it (shell command,
// ${CLAUDE_PLUGIN_ROOT} and ${CLAUDE_PLUGIN_DATA} expanded, the hook payload on stdin), against a scratch data folder and a
// free port. SessionStart must start the dashboard's monitor from dashboard/plugin; the monitor must then show the session;
// Fenceline's own hook must record the same session and still deny a block-fence edit.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const H = JSON.parse(fs.readFileSync(path.join(root, 'hooks', 'hooks.json'), 'utf8')).hooks;
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fenceline-plugin-')));
const data = path.join(tmp, 'data'); const repo = path.join(tmp, 'repo'); const flHome = path.join(tmp, 'fl');
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const get = (port, p) => new Promise((res, rej) => http.get({ host: '127.0.0.1', port, path: p, agent: false }, (r) => { let b = ''; r.on('data', (d) => { b += d; }); r.on('end', () => res({ status: r.statusCode, json: (() => { try { return JSON.parse(b); } catch { return null; } })() })); }).on('error', rej));
let port; const sid = 'abcdef12-3456-4789-8abc-def012345678';

function commandsFor(ev, tool) {
  return (H[ev] || []).filter((m) => !m.matcher || m.matcher === '*' || (tool && new RegExp(`^(${m.matcher})$`).test(tool))).flatMap((m) => m.hooks.map((h) => h.command));
}
function fire(ev, extra = {}) {
  const payload = JSON.stringify({ session_id: sid, cwd: repo, hook_event_name: ev, transcript_path: path.join(tmp, 't.jsonl'), ...extra });
  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: root, CLAUDE_PLUGIN_DATA: data, AOS_PORT: String(port), FENCELINE_HOME: flHome };
  delete env.AOS_LIVE_DIR; delete env.NODE_TEST_CONTEXT;
  // Claude Code expands ${CLAUDE_PLUGIN_ROOT} itself; here the shell does it from env
  return commandsFor(ev, extra.tool_name).map((cmd) => execSync(cmd, { input: payload, env, encoding: 'utf8', shell: '/bin/sh', timeout: 20000 }));
}

test.before(async () => {
  port = await freePort();
  fs.mkdirSync(path.join(repo, 'migrations'), { recursive: true }); fs.mkdirSync(path.join(repo, '.fenceline'));
  fs.writeFileSync(path.join(repo, 'migrations', '001.sql'), 'create table t();\n'); fs.writeFileSync(path.join(repo, 'app.js'), 'x\n');
  fs.writeFileSync(path.join(repo, '.fenceline', 'fences.json'), JSON.stringify({ fences: [{ id: 'migrations', text: 'migrations: off-limits', kind: 'deny', mode: 'block', paths: ['migrations/**'] }] }));
  execFileSync('git', ['init', '-q'], { cwd: repo });
});
test.after(() => {
  // stop the monitor this test started (it was spawned detached, with this test's data dir in its environment)
  for (const pid of execSync("ps -eo pid=,args= | grep '[d]ashboard/plugin/monitor.mjs' || true", { encoding: 'utf8' }).trim().split('\n').filter(Boolean).map((l) => Number(l.trim().split(/\s+/)[0]))) {
    let mine = false; try { mine = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').includes(`AOS_LIVE_DIR=${path.join(data, 'live')}`); } catch { mine = false; }
    if (mine) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('hooks.json: the dashboard hooks are async, Fenceline\'s are synchronous, and every script exists', () => {
  for (const [ev, ms] of Object.entries(H)) for (const m of ms) for (const h of m.hooks) {
    const file = h.command.match(/"\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)"/)[1];
    assert.ok(fs.existsSync(path.join(root, file)), `${ev}: ${file} exists`);
    if (file.startsWith('dashboard/')) assert.equal(h.async, true, `${ev}: ${file} is async`); else assert.ok(!h.async, `${ev}: ${file} is synchronous`);
  }
});

test('SessionStart starts the dashboard; the session shows up there and in Fenceline; a fenced edit is still denied', { skip: process.platform !== 'linux' && 'cleanup reads /proc' }, async () => {
  fire('SessionStart', { source: 'startup', model: 'claude-haiku-5-5' });
  let s = null;
  for (let i = 0; i < 40 && !s; i++) { try { s = (await get(port, '/api/state')).json; } catch { await new Promise((r) => setTimeout(r, 150)); } }
  assert.ok(s, 'the monitor answers on its port');
  fire('UserPromptSubmit', { prompt: 'hi' });
  const outs = fire('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: path.join(repo, 'migrations', '001.sql') } });
  assert.match(outs.join(''), /"permissionDecision":"deny"/);
  fire('PostToolUse', { tool_name: 'Read', tool_input: { file_path: path.join(repo, 'app.js') } });
  fs.rmSync(path.join(data, 'live', 'monitor-autostart.lock'), { force: true });
  await new Promise((r) => setTimeout(r, 1200));
  s = (await get(port, '/api/state')).json;
  assert.ok(s.agents.some((a) => a.id.includes('abcd')), 'the dashboard shows the session');
  assert.ok(fs.existsSync(path.join(data, 'live', 'hook-events.ndjson')), 'the dashboard log is in the plugin data dir');
  assert.ok(fs.existsSync(path.join(flHome, 'sessions', sid, 'events.jsonl')), 'Fenceline recorded the session');
  const ev = fs.readFileSync(path.join(flHome, 'sessions', sid, 'events.jsonl'), 'utf8');
  assert.match(ev, /"kind":"blocked"/);
});
