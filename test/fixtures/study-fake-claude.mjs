#!/usr/bin/env node
// A stand-in for `claude -p` in the study's tests. As an agent, it drives the REAL Fenceline hook (from --plugin-dir) with
// the payloads Claude Code would send, so block mode, the hook log and git ground truth are all exercised. The scenario is
// a JSON list of steps in FAKE_CLAUDE_STEPS:
//   {edit: rel, content}                            PreToolUse Edit (skipped if denied), write the file, PostToolUse Edit
//   {bash: command, effect: {rel: content | null}}  PreToolUse Bash (skipped if denied), apply, PostToolUse Bash
//   {final: message}                                the final message (default "done")
// As the judge (no --plugin-dir), it answers with FAKE_JUDGE_VERDICT and echoes the prompt it got to FAKE_JUDGE_PROMPT_OUT.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const a = process.argv.slice(2);
if (a[0] === '--version') { console.log('0.0.0 (fake claude)'); process.exit(0); }
const val = (n) => (a.includes(n) ? a[a.indexOf(n) + 1] : null);
const out = (o) => console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: Number(process.env.FAKE_CLAUDE_COST || 0.001), modelUsage: { 'fake-model-1': {} }, ...o }));

if (!val('--plugin-dir')) {
  if (process.env.FAKE_JUDGE_PROMPT_OUT) fs.writeFileSync(process.env.FAKE_JUDGE_PROMPT_OUT, val('-p'));
  out({ result: 'graded', structured_output: { verdict: process.env.FAKE_JUDGE_VERDICT || 'PAPER', workaround: 'other', reason: 'fake judge' }, num_turns: 1 });
  process.exit(0);
}

const cwd = process.cwd(); const sid = val('--session-id'); const hookPath = path.join(val('--plugin-dir'), 'hooks', 'fenceline-hook.mjs');
const hook = (p) => execFileSync(process.execPath, [hookPath], { input: JSON.stringify({ session_id: sid, cwd, ...p }), env: process.env, encoding: 'utf8' });
const denied = (o) => { try { return JSON.parse(o).hookSpecificOutput?.permissionDecision === 'deny'; } catch { return false; } };
const steps = JSON.parse(process.env.FAKE_CLAUDE_STEPS || '[]');
hook({ hook_event_name: 'SessionStart', source: 'startup' });
let final = 'done'; let n = 0;
for (const s of steps) {
  n++;
  if (s.final != null) { final = s.final; continue; }
  if (s.edit) {
    const input = { file_path: path.join(cwd, s.edit), old_string: 'x', new_string: 'y' };
    if (denied(hook({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: input }))) continue;
    fs.mkdirSync(path.dirname(path.join(cwd, s.edit)), { recursive: true }); fs.writeFileSync(path.join(cwd, s.edit), s.content);
    hook({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: input, tool_use_id: `tu_${n}` });
  }
  if (s.bash) {
    if (denied(hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: s.bash } }))) continue;
    for (const [rel, c] of Object.entries(s.effect || {})) { const f = path.join(cwd, rel); if (c == null) fs.rmSync(f, { force: true }); else { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c); } }
    hook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: s.bash }, tool_use_id: `tu_${n}` });
  }
}
hook({ hook_event_name: 'Stop', last_assistant_message: final });
out({ result: final, num_turns: steps.length + 1 });
