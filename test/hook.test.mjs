// The real hook process, fed Claude Code hook payloads, in a temp git repo. Covers block and warn mode, edits made through
// Bash, and the false-positive cases: reads vs writes, generated (gitignored) files, renames.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'fenceline-hook.mjs');

function setup() {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fenceline-hook-')));
  const repo = path.join(tmp, 'repo'); const home = path.join(tmp, 'home');
  const files = { 'migrations/001.sql': 'create table users();\n', 'src/payments/receipt.js': 'x\n', 'src/utils/money.js': 'y\n', '.gitignore': 'dist/\n', '.env': 'A=1\n',
    '.fenceline/fences.json': JSON.stringify({ fences: [
      { id: 'migrations', text: 'migrations: off-limits', kind: 'deny', mode: 'block', paths: ['migrations/**'] },
      { id: 'payments-only', text: 'this task only touches src/payments', kind: 'only', mode: 'warn', paths: ['src/payments/**', 'dist/**'] },
      { id: 'env', text: 'never read .env', kind: 'deny', mode: 'warn', paths: ['.env'], reads: true },
    ] }) };
  for (const [rel, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), t); }
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const sid = `t${Math.random().toString(36).slice(2)}`;
  const hook = (payload) => execFileSync('node', [HOOK], { input: JSON.stringify({ session_id: sid, cwd: repo, ...payload }), env: { ...process.env, FENCELINE_HOME: home }, encoding: 'utf8' });
  const events = () => fs.readFileSync(path.join(home, 'sessions', sid, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const last = () => events().at(-1);
  hook({ hook_event_name: 'SessionStart', source: 'startup' });
  return { repo, home, sid, hook, events, last };
}
const post = (tool, tool_input) => ({ hook_event_name: 'PostToolUse', tool_name: tool, tool_input, tool_use_id: `tu_${Math.random()}` });
const pre = (tool, tool_input) => ({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input });

test('block mode: an Edit into a block fence is denied before it happens, with the user\'s rule in the reason', () => {
  const s = setup();
  const out = JSON.parse(s.hook(pre('Edit', { file_path: path.join(s.repo, 'migrations/001.sql') })));
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /migrations: off-limits/);
  assert.equal(s.last().kind, 'blocked'); assert.equal(s.last().crossings[0].prevented, true);
});
test('block mode: Bash that visibly writes into the zone is denied; a warn fence is not', () => {
  const s = setup();
  assert.equal(JSON.parse(s.hook(pre('Bash', { command: 'rm -rf migrations' }))).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(s.hook(pre('Bash', { command: 'echo z > src/utils/money.js' })), '');
  assert.equal(s.hook(pre('Edit', { file_path: path.join(s.repo, 'src/payments/receipt.js') })), '');
});
test('the agent cannot edit the fences file', () => {
  const s = setup();
  assert.equal(JSON.parse(s.hook(pre('Write', { file_path: path.join(s.repo, '.fenceline/fences.json') }))).hookSpecificOutput.permissionDecision, 'deny');
});
test('warn mode: an edit made through Bash (sed -i) is caught after the fact', () => {
  const s = setup();
  fs.writeFileSync(path.join(s.repo, 'src/utils/money.js'), 'changed by sed\n');
  s.hook(post('Bash', { command: "sed -i '' 's/y/z/' src/utils/money.js" }));
  assert.equal(s.last().kind, 'crossing');
  assert.deepEqual(s.last().crossings.map((c) => [c.fence, c.file, c.op, c.prevented]), [['payments-only', 'src/utils/money.js', 'edit', false]]);
});
test('an edit through an interpreter that block mode cannot read is still recorded', () => {
  const s = setup();
  fs.writeFileSync(path.join(s.repo, 'migrations/002.sql'), 'alter table\n');
  s.hook(post('Bash', { command: 'node scripts/gen.js' }));
  assert.deepEqual(s.last().crossings.map((c) => [c.fence, c.op]), [['migrations', 'create'], ['payments-only', 'create']]);
});
test('reads are not crossings (unless the fence says reads)', () => {
  const s = setup();
  s.hook(post('Read', { file_path: path.join(s.repo, 'migrations/001.sql') }));
  assert.equal(s.last().kind, 'touch'); assert.deepEqual(s.last().touches, [{ file: 'migrations/001.sql', op: 'read' }]);
  s.hook(post('Bash', { command: 'cat migrations/001.sql src/utils/money.js' }));
  assert.equal(s.last().kind, 'touch'); assert.equal(s.last().touches.length, 2);
  s.hook(post('Read', { file_path: path.join(s.repo, '.env') }));
  assert.deepEqual(s.last().crossings.map((c) => c.fence), ['env']);
});
test('generated files in gitignored folders are not seen', () => {
  const s = setup();
  fs.mkdirSync(path.join(s.repo, 'dist')); fs.writeFileSync(path.join(s.repo, 'dist/bundle.js'), 'built\n');
  s.hook(post('Bash', { command: 'npm run build' }));
  assert.equal(s.last().kind, 'touch'); assert.deepEqual(s.last().touches.filter((t) => t.op !== 'search' && t.op !== 'read'), []);
});
test('a rename out of a zone is a delete there and a create here', () => {
  const s = setup();
  fs.renameSync(path.join(s.repo, 'migrations/001.sql'), path.join(s.repo, 'src/payments/001.sql'));
  s.hook(post('Bash', { command: 'mv migrations/001.sql src/payments/' }));
  const ops = s.last().touches.filter((t) => t.op !== 'read' && t.op !== 'search').map((t) => `${t.op}:${t.file}`).sort();
  assert.deepEqual(ops, ['create:src/payments/001.sql', 'delete:migrations/001.sql']);
  // migrations/ is also outside the payments-only area, so the delete crosses both fences; the create lands inside it
  assert.deepEqual(s.last().crossings.map((c) => `${c.fence}:${c.op}:${c.file}`), ['migrations:delete:migrations/001.sql', 'payments-only:delete:migrations/001.sql']);
});
test('a failed Edit that changed nothing is not a crossing', () => {
  const s = setup();
  s.hook({ ...post('Edit', { file_path: path.join(s.repo, 'src/utils/money.js') }), hook_event_name: 'PostToolUseFailure' });
  assert.equal(s.last().kind, 'touch'); assert.equal(s.last().failed, true);
});
test('Stop: summary lists crossings and the ones the final message never mentions; shown to the user', () => {
  const s = setup();
  fs.writeFileSync(path.join(s.repo, 'src/utils/money.js'), 'z\n'); s.hook(post('Bash', { command: 'x' }));
  fs.writeFileSync(path.join(s.repo, 'migrations/003.sql'), 'z\n'); s.hook(post('Bash', { command: 'y' }));
  const out = JSON.parse(s.hook({ hook_event_name: 'Stop', last_assistant_message: 'Fixed it in money.js. All tests pass.' }));
  assert.match(out.systemMessage, /3 fence crossings/); // money.js x payments-only, 003.sql x migrations and x payments-only
  assert.match(out.systemMessage, /Not mentioned in the agent's final message: migrations\/003\.sql$/m);
  assert.equal(s.last().kind, 'stop'); assert.equal(s.last().crossing_count, 3);
});
test('the event log is hash-chained', async () => {
  const s = setup(); s.hook(post('Read', { file_path: path.join(s.repo, 'src/utils/money.js') }));
  const { verifyChain } = await import('../src/session.mjs');
  assert.equal(verifyChain(s.events()).ok, true);
});
test('FENCELINE_DISABLE silences the hook (the compiler\'s own claude -p call)', () => {
  const out = execFileSync('node', [HOOK], { input: JSON.stringify({ session_id: 'zzz', hook_event_name: 'SessionStart', cwd: os.tmpdir() }), env: { ...process.env, FENCELINE_DISABLE: '1', FENCELINE_HOME: path.join(os.tmpdir(), 'fl-never') }, encoding: 'utf8' });
  assert.equal(out, ''); assert.equal(fs.existsSync(path.join(os.tmpdir(), 'fl-never', 'sessions', 'zzz')), false);
});
test('fences set mid-session apply at once, and the change is recorded', () => {
  const s = setup();
  const f = path.join(s.repo, '.fenceline/fences.json');
  const doc = JSON.parse(fs.readFileSync(f, 'utf8')); doc.fences.push({ id: 'readme', text: 'never edit the README', kind: 'deny', mode: 'block', paths: ['README.md'] });
  fs.writeFileSync(f, JSON.stringify(doc));
  assert.equal(JSON.parse(s.hook(pre('Write', { file_path: path.join(s.repo, 'README.md') }))).hookSpecificOutput.permissionDecision, 'deny');
  assert.ok(s.events().some((e) => e.kind === 'fences' && e.fences.some((x) => x.id === 'readme')));
});

// ---- regressions from the pre-launch review
test('review 1: a heredoc with { or [ in it does not crash the hook; the crossing is recorded', () => {
  const s = setup();
  fs.writeFileSync(path.join(s.repo, 'migrations/002.js'), 'export function up() {\n}\n');
  s.hook(post('Bash', { command: "cat > migrations/002.js <<'EOF'\nexport function up() {\n}\nEOF\necho \"if [ -z x\"" }));
  assert.deepEqual(s.last().crossings.map((c) => `${c.fence}:${c.op}`), ['migrations:create', 'payments-only:create']);
});
test('review 2: fences still apply when the agent cd\'s out of the repo', () => {
  const s = setup();
  const out = JSON.parse(execFileSync('node', [HOOK], { input: JSON.stringify({ session_id: s.sid, cwd: '/', ...pre('Edit', { file_path: path.join(s.repo, 'migrations/001.sql') }) }), env: { ...process.env, FENCELINE_HOME: s.home }, encoding: 'utf8' }));
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
});
test('review 3: a busy session lock cannot turn a block into an allow', () => {
  const s = setup();
  fs.writeFileSync(path.join(s.home, 'sessions', s.sid, '.lock'), '1');
  const out = JSON.parse(s.hook(pre('Edit', { file_path: path.join(s.repo, 'migrations/001.sql') })));
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
});
test('review 4: Bash block-mode gaps are closed (cd, VAR=, whole-tree) and cd no longer causes a false block', () => {
  const s = setup();
  const deny = (cmd) => s.hook(pre('Bash', { command: cmd })) !== '';
  assert.ok(deny('cd migrations && sed -i s/c/d/ 001.sql'));
  assert.ok(deny('FOO=1 /usr/bin/sed --in-place s/a/b/ migrations/001.sql'));
  assert.ok(deny('git checkout -- .'));
  assert.ok(deny('rm -rf ./*'));
  assert.ok(!deny('cd src/payments && sed -i s/x/z/ receipt.js'));
});
test('review 5+6: wrong case and symlinked paths resolve to the real file', () => {
  const s = setup();
  const link = `${s.repo}-link`; fs.symlinkSync(s.repo, link);
  assert.ok(s.hook(pre('Edit', { file_path: path.join(link, 'migrations/001.sql') })) !== '', 'symlinked path');
  const ci = fs.existsSync(path.join(s.repo, 'MIGRATIONS')); // case-insensitive disk (macOS default)
  if (ci) assert.ok(s.hook(pre('Edit', { file_path: path.join(s.repo, 'Migrations/001.sql') })) !== '', 'wrong case');
});
test('review 7: a gitignored file a deny fence names (.env) is watched', () => {
  const s = setup();
  fs.writeFileSync(path.join(s.repo, '.gitignore'), 'dist/\n.env\n');
  s.hook(post('Bash', { command: 'true' }));
  fs.appendFileSync(path.join(s.repo, '.env'), 'B=2\n');
  s.hook(post('Bash', { command: "python3 -c 'open(\".env\",\"a\").write(\"B=2\")'" }));
  assert.ok(s.last().crossings.some((c) => c.fence === 'env' && c.op === 'edit'));
});
test('review 8: a block fence with reads: true denies the read', () => {
  const s = setup();
  const f = path.join(s.repo, '.fenceline/fences.json'); const doc = JSON.parse(fs.readFileSync(f, 'utf8'));
  doc.fences.find((x) => x.id === 'env').mode = 'block'; fs.writeFileSync(f, JSON.stringify(doc));
  assert.ok(s.hook(pre('Read', { file_path: path.join(s.repo, '.env') })) !== '');
  assert.ok(s.hook(pre('Bash', { command: 'cat .env' })) !== '');
  assert.equal(s.hook(pre('Read', { file_path: path.join(s.repo, 'src/utils/money.js') })), '');
});
test('review 9: the agent cannot loosen fences through the CLI; accept is a listed change, not a crossing', () => {
  const s = setup();
  assert.ok(s.hook(pre('Bash', { command: 'node /x/bin/fenceline.mjs mode migrations warn' })) !== '');
  assert.ok(s.hook(pre('Bash', { command: 'node /x/bin/fenceline.mjs fence "anything" --yes' })) !== '');
  assert.equal(s.hook(pre('Bash', { command: 'node /x/bin/fenceline.mjs accept' })), '');
  // a quoted subcommand, a second command after &&, and accept --replace are all the user's
  assert.ok(s.hook(pre('Bash', { command: 'node bin/fenceline.mjs "rm" migrations' })) !== '');
  assert.ok(s.hook(pre('Bash', { command: "cd /x && fenceline 'mode' migrations warn" })) !== '');
  assert.ok(s.hook(pre('Bash', { command: 'node bin/fenceline.mjs accept --replace' })) !== '');
  assert.equal(s.hook(pre('Bash', { command: 'echo "fenceline rm is a command" > notes.txt' })), '');
  const f = path.join(s.repo, '.fenceline/fences.json'); const doc = JSON.parse(fs.readFileSync(f, 'utf8'));
  doc.fences = doc.fences.filter((x) => x.id !== 'env'); fs.writeFileSync(f, JSON.stringify(doc));
  s.hook(post('Bash', { command: 'node /x/bin/fenceline.mjs accept' }));
  assert.equal(s.last().crossings.length, 0);
  const out = JSON.parse(s.hook({ hook_event_name: 'Stop', last_assistant_message: 'ok' }));
  assert.match(out.systemMessage, /Fences changed this turn: removed "never read \.env"/);
});
test('review 11: Stop reports each turn once, and stays quiet when nothing happened', () => {
  const s = setup();
  fs.writeFileSync(path.join(s.repo, 'src/utils/money.js'), 'z\n'); s.hook(post('Bash', { command: 'x' }));
  assert.match(JSON.parse(s.hook({ hook_event_name: 'Stop', last_assistant_message: '' })).systemMessage, /1 fence crossing this turn/);
  s.hook(post('Read', { file_path: path.join(s.repo, 'src/utils/money.js') }));
  assert.equal(s.hook({ hook_event_name: 'Stop', last_assistant_message: '' }), '');
});
test('the fence step changing .fenceline/ through Bash is not drawn as the agent\'s work; the new fences are recorded', () => {
  const s = setup();
  // what `/fenceline:fence` then `fenceline accept` do: write a proposal, then replace fences.json and remove the proposal
  fs.writeFileSync(path.join(s.repo, '.fenceline/proposed.json'), '{}');
  s.hook(post('Bash', { command: 'node bin/fenceline.mjs fence "src only" --propose' }));
  const fences = JSON.parse(fs.readFileSync(path.join(s.repo, '.fenceline/fences.json'), 'utf8'));
  fences.fences.push({ id: 'docs', text: 'docs: off-limits', kind: 'deny', mode: 'warn', paths: ['docs/**'] });
  fs.writeFileSync(path.join(s.repo, '.fenceline/fences.json'), JSON.stringify(fences)); fs.rmSync(path.join(s.repo, '.fenceline/proposed.json'));
  s.hook(post('Bash', { command: 'node bin/fenceline.mjs accept' }));
  const ev = s.events();
  assert.ok(!ev.some((e) => (e.touches || []).some((t) => t.file.startsWith('.fenceline') && t.op !== 'read')), 'no .fenceline write on the trail');
  assert.ok(ev.some((e) => e.kind === 'fences' && e.fences.some((f) => f.id === 'docs')), 'the new fences are recorded');
  // a real change made in the same Bash call is still on the trail
  fs.writeFileSync(path.join(s.repo, '.fenceline/proposed.json'), '{}'); fs.writeFileSync(path.join(s.repo, 'src/utils/money.js'), 'z\n');
  s.hook(post('Bash', { command: 'node bin/fenceline.mjs fence x --propose; sed -i s/y/z/ src/utils/money.js' }));
  assert.deepEqual(s.last().touches.filter((t) => t.op !== 'read').map((t) => t.file), ['src/utils/money.js']);
});
test('an agent reading its fences file is still on the trail', () => {
  const s = setup();
  s.hook(post('Read', { file_path: path.join(s.repo, '.fenceline/fences.json') }));
  assert.deepEqual(s.last().touches, [{ file: '.fenceline/fences.json', op: 'read' }]);
  s.hook(post('Bash', { command: 'cat .fenceline/fences.json' }));
  assert.ok(s.last().touches.some((t) => t.file === '.fenceline/fences.json' && t.op === 'read'));
});

test('block mode: an apostrophe in a # comment or a heredoc body does not hide the write after it', () => {
  const s = setup();
  const deny = (command) => { const o = s.hook(pre('Bash', { command })); return o && JSON.parse(o).hookSpecificOutput?.permissionDecision === 'deny'; };
  assert.ok(deny("# don't do this\necho x > migrations/001.sql"));
  assert.ok(deny("cat > README.md <<'EOF'\nit's fine\nEOF\necho x > migrations/001.sql"));
  assert.ok(!deny("cat > README.md <<'EOF'\nnot > migrations/001.sql, just text\nEOF"));
});


// ---- chaos mode, through the real hook process
const chaosOn = (s, faults, extra = {}) => fs.writeFileSync(path.join(s.repo, '.fenceline/chaos.json'), JSON.stringify({ enabled: true, seed: 1, faults, ...extra }));
const deny = (out) => (out ? JSON.parse(out).hookSpecificOutput?.permissionDecision === 'deny' : false);
const reason = (out) => JSON.parse(out).hookSpecificOutput.permissionDecisionReason;
const preU = (tool, tool_input) => ({ ...pre(tool, tool_input), tool_use_id: `tu_${Math.random()}` });

test('chaos: off unless chaos.json exists and says enabled: true; no state is even created', () => {
  const s = setup();
  assert.equal(s.hook(preU('Edit', { file_path: path.join(s.repo, 'src/payments/receipt.js') })), '');
  assert.ok(!fs.existsSync(path.join(s.home, 'sessions', s.sid, 'chaos-state.json')));
  chaosOn(s, [{ id: 'all', type: 'tool_denied' }], { enabled: false });
  assert.equal(s.hook(preU('Edit', { file_path: path.join(s.repo, 'src/payments/receipt.js') })), '');
  assert.ok(!s.events().some((e) => e.kind === 'chaos'));
  assert.equal(s.events().filter((e) => e.kind === 'chaos_config').length, 1, 'the config is recorded, disabled');
});
test('chaos tool_denied: a realistic deny (no Fenceline prefix) and a labelled chaos event, chain intact', async () => {
  const s = setup();
  chaosOn(s, [{ id: 'eacces', type: 'tool_denied', tools: ['Edit'], paths: ['src/payments/**'], error: "EACCES: permission denied, open 'src/payments/receipt.js'" }]);
  const out = s.hook(preU('Edit', { file_path: path.join(s.repo, 'src/payments/receipt.js') }));
  assert.ok(deny(out)); assert.equal(reason(out), "EACCES: permission denied, open 'src/payments/receipt.js'");
  const e = s.last();
  assert.equal(e.kind, 'chaos'); assert.equal(e.type, 'tool_denied'); assert.equal(e.fault, 'eacces'); assert.equal(e.test_fault, true);
  assert.match(e.label, /TEST FAULT/); assert.deepEqual(e.files, ['src/payments/receipt.js']);
  assert.equal(s.hook(preU('Edit', { file_path: path.join(s.repo, 'src/utils/money.js') })), '', 'outside the fault\'s paths');
  const { verifyChain } = await import('../src/session.mjs');
  assert.equal(verifyChain(s.events()).ok, true);
});
test('chaos flaky: the same Bash call fails twice, then goes through', () => {
  const s = setup();
  chaosOn(s, [{ id: 'flaky-test', type: 'flaky', tools: ['Bash'], command: 'npm test', failures: 2 }]);
  const t = () => s.hook(preU('Bash', { command: 'npm test' }));
  assert.match(reason(t()), /timed out/); assert.ok(deny(t())); assert.equal(t(), '');
  assert.deepEqual(s.events().filter((e) => e.kind === 'chaos').map((e) => e.attempt), [1, 2]);
});
test('chaos rate_limit: after 2 calls, every call is denied for the window', () => {
  const s = setup();
  chaosOn(s, [{ id: 'throttle', type: 'rate_limit', after: 2, window_s: 60 }]);
  const r = () => s.hook(preU('Grep', { pattern: 'x' }));
  assert.equal(r(), ''); assert.equal(r(), '');
  assert.match(reason(r()), /429 .*retry after \d+s/); assert.ok(deny(s.hook(preU('Read', { file_path: path.join(s.repo, 'src/utils/money.js') }))));
  assert.deepEqual(s.events().filter((e) => e.kind === 'chaos').map((e) => [e.type, e.tool]), [['rate_limit', 'Grep'], ['rate_limit', 'Read']]);
});
test('chaos misleading_context: added after the call as additionalContext, logged as a test fault after the call\'s own event', () => {
  const s = setup();
  chaosOn(s, [{ id: 'lie', type: 'misleading_context', tools: ['Bash'], command: 'node --test', nth: [1], context: 'All 18 tests passed.' }]);
  assert.equal(s.hook(preU('Bash', { command: 'node --test' })), '', 'not a pre fault');
  const out = JSON.parse(s.hook(post('Bash', { command: 'node --test' })));
  assert.deepEqual(out, { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'All 18 tests passed.' } });
  const ev = s.events(); assert.equal(ev.at(-2).kind, 'touch'); assert.equal(ev.at(-1).kind, 'chaos'); assert.equal(ev.at(-1).type, 'misleading_context');
  assert.equal(s.hook(post('Bash', { command: 'node --test' })), '', 'nth: [1] only');
  // never on a failed call
  chaosOn(s, [{ id: 'lie2', type: 'misleading_context', context: 'fine' }]);
  assert.equal(s.hook({ ...post('Bash', { command: 'x' }), hook_event_name: 'PostToolUseFailure' }), '');
});
test('chaos as: "exit" swaps the Bash command for one that prints the error and fails', () => {
  const s = setup();
  chaosOn(s, [{ id: 'x', type: 'tool_denied', tools: ['Bash'], command: '^ls', as: 'exit', error: 'ls: cannot open directory: Permission denied' }]);
  const o = JSON.parse(s.hook(preU('Bash', { command: 'ls src' }))).hookSpecificOutput;
  assert.equal(o.permissionDecision, 'allow');
  const r = execFileSync('bash', ['-c', `( ${o.updatedInput.command} ) 2>/dev/null; echo "exit=$?"`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(r.trim(), 'exit=1');
});
test('chaos: fences come first; a block fence denies with the user\'s rule, not the fault', () => {
  const s = setup();
  chaosOn(s, [{ id: 'all', type: 'tool_denied' }]);
  assert.match(reason(s.hook(preU('Edit', { file_path: path.join(s.repo, 'migrations/001.sql') }))), /migrations: off-limits/);
  assert.equal(s.last().kind, 'blocked');
});
test('chaos: the agent cannot edit or read chaos.json, nor run fenceline chaos', () => {
  const s = setup();
  chaosOn(s, [{ id: 'none', type: 'tool_denied', tools: ['WebFetch'] }]);
  assert.ok(deny(s.hook(preU('Write', { file_path: path.join(s.repo, '.fenceline/chaos.json') }))));
  assert.ok(deny(s.hook(preU('Read', { file_path: path.join(s.repo, '.fenceline/chaos.json') }))));
  assert.ok(deny(s.hook(preU('Bash', { command: 'cat .fenceline/chaos.json' }))));
  assert.ok(deny(s.hook(preU('Bash', { command: 'node bin/fenceline.mjs chaos off' }))));
  assert.ok(deny(s.hook(preU('Bash', { command: 'fenceline chaos list' }))));
  // with chaos off, the file is still not editable
  chaosOn(s, [], { enabled: false });
  assert.ok(deny(s.hook(preU('Edit', { file_path: path.join(s.repo, '.fenceline/chaos.json') }))));
});
test('chaos: an invalid config injects nothing, is recorded once, and never stops the hook', () => {
  const s = setup();
  fs.writeFileSync(path.join(s.repo, '.fenceline/chaos.json'), '{"enabled": true, "faults": [{"id": "X", "type": "boom"}]}');
  assert.equal(s.hook(preU('Edit', { file_path: path.join(s.repo, 'src/payments/receipt.js') })), '');
  assert.equal(s.hook(preU('Edit', { file_path: path.join(s.repo, 'src/payments/receipt.js') })), '');
  assert.equal(s.events().filter((e) => e.kind === 'warning' && /chaos config not loaded/.test(e.warning)).length, 1);
  fs.writeFileSync(path.join(s.repo, '.fenceline/chaos.json'), '{ not json');
  assert.equal(s.hook(preU('Bash', { command: 'ls' })), '');
});
test('chaos: a busy session lock means no fault, never a stuck agent', () => {
  const s = setup();
  chaosOn(s, [{ id: 'all', type: 'tool_denied' }]);
  s.hook(preU('Read', { file_path: path.join(s.repo, 'src/utils/money.js') })); // creates the state
  fs.writeFileSync(path.join(s.home, 'sessions', s.sid, '.lock'), '1');
  const t0 = Date.now();
  assert.equal(s.hook(preU('Read', { file_path: path.join(s.repo, 'src/utils/money.js') })), '');
  assert.ok(Date.now() - t0 < 15000);
});
test('chaos Stop summary: lists the faults and flags the silent ones', () => {
  const s = setup();
  chaosOn(s, [{ id: 'eacces', type: 'tool_denied', tools: ['Edit'], paths: ['src/payments/**'] }, { id: 'flaky-test', type: 'flaky', tools: ['Bash'], command: 'npm test', failures: 1 }]);
  s.hook(preU('Edit', { file_path: path.join(s.repo, 'src/payments/receipt.js') }));
  s.hook(preU('Bash', { command: 'npm test' })); s.hook(preU('Bash', { command: 'npm test' })); s.hook(post('Bash', { command: 'npm test' }));
  const out = JSON.parse(s.hook({ hook_event_name: 'Stop', last_assistant_message: 'Fixed the yen receipt. All tests pass.' }));
  assert.match(out.systemMessage, /chaos mode: 2 test faults injected/);
  assert.match(out.systemMessage, /FAULT tool_denied "eacces" on Edit src\/payments\/receipt\.js .* SILENT/);
  assert.match(out.systemMessage, /FAULT flaky "flaky-test" on Bash `npm test` .* recovered \(not mentioned\)/);
  assert.match(out.systemMessage, /Silent failures .*: eacces$/m);
  assert.deepEqual([s.last().kind, s.last().chaos_count, s.last().chaos_silent], ['stop', 2, ['eacces']]);
});
