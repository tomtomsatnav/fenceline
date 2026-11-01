// What the survey sheet needs from the monitor: a subagent names its parent session (state and timeline), and a session that asked
// for permission or input, with nothing since, is `waiting`. The idle prompt Claude Code sends after every turn is not a question.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sleep, tmpDir, hookEv, startMonitor } from './harness.mjs';

const TMP = tmpDir('aos-monsheet-'); let M; const now = Date.now(), at = (m) => new Date(now + m * 60e3).toISOString();
before(async () => {
  const live = path.join(TMP, 'live'), orch = path.join(TMP, 'orch'); fs.mkdirSync(live, { recursive: true }); fs.mkdirSync(orch, { recursive: true });
  const w = { cwd: 'proj', cwdp: '/x/proj' }, L = [];
  // asks for permission and is still waiting
  L.push(hookEv({ ts: at(-10), ev: 'SessionStart', sid: 'shask111', ...w }));
  L.push(hookEv({ ts: at(-9), ev: 'UserPromptSubmit', sid: 'shask111', ...w }));
  L.push(hookEv({ ts: at(-8), ev: 'SubagentStart', sid: 'shask111', agent_id: 'kid1', agent_type: 'general-purpose', ...w }));
  L.push(hookEv({ ts: at(-7), ev: 'PreToolUse', sid: 'shask111', agent_id: 'kid1', tool: 'Read', ...w }));
  L.push(hookEv({ ts: at(-1), ev: 'PermissionRequest', sid: 'shask111', ...w }));
  // only the after-turn idle prompt
  L.push(hookEv({ ts: at(-6), ev: 'SessionStart', sid: 'shidl222', ...w }));
  L.push(hookEv({ ts: at(-5), ev: 'Notification', sid: 'shidl222', nt: 'idle_prompt', ...w }));
  // asked, then carried on
  L.push(hookEv({ ts: at(-6), ev: 'SessionStart', sid: 'shans333', ...w }));
  L.push(hookEv({ ts: at(-4), ev: 'Notification', sid: 'shans333', nt: 'permission_prompt', ...w }));
  L.push(hookEv({ ts: at(-3), ev: 'PreToolUse', sid: 'shans333', tool: 'Bash', ...w }));
  fs.writeFileSync(path.join(live, 'hook-events.ndjson'), L.join(''));
  M = await startMonitor({ orch, live }); await sleep(300);
});
after(async () => { await M.stop(); fs.rmSync(TMP, { recursive: true, force: true }); });

const bySid = (agents, sid) => agents.find((a) => a.capabilities && a.capabilities.includes('claude-code') && String(a.id).endsWith('·' + sid.slice(0, 4)));

test('a subagent names its parent session in /api/state and /api/timeline', async () => {
  const s = (await M.get('/api/state')).json, kid = s.agents.find((a) => String(a.id).endsWith('·kid1'));
  const parent = bySid(s.agents, 'shask111');
  assert.ok(kid && parent, 'both listed');
  assert.equal(kid.parent, parent.id);
  const row = (await M.get('/api/timeline')).json.rows.find((r) => r.id === kid.id);
  assert.equal(row.parent, parent.id);
  assert.equal(parent.parent, undefined, 'a session has no parent');
});

test('waiting: set by a permission request, not by the idle prompt, cleared by later activity', async () => {
  const s = (await M.get('/api/state')).json;
  assert.equal(bySid(s.agents, 'shask111').waiting, true);
  assert.equal(bySid(s.agents, 'shidl222').waiting, undefined);
  assert.equal(bySid(s.agents, 'shans333').waiting, undefined);
});
