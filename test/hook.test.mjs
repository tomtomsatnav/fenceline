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
test('FENCELINE_FENCES_FILE: fences read from outside the repo still block', () => {
  const s = setup();
  const outside = path.join(path.dirname(s.repo), 'hidden-fences.json');
  fs.writeFileSync(outside, JSON.stringify({ fences: [{ id: 'cfg', text: 'config off-limits', kind: 'deny', mode: 'block', paths: ['src/utils/**'] }] }));
  fs.rmSync(path.join(s.repo, '.fenceline'), { recursive: true });
  const out = execFileSync('node', [HOOK], { input: JSON.stringify({ session_id: `h${s.sid}`, cwd: s.repo, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(s.repo, 'src/utils/money.js') } }), env: { ...process.env, FENCELINE_HOME: s.home, FENCELINE_FENCES_FILE: outside }, encoding: 'utf8' });
  assert.match(JSON.parse(out).hookSpecificOutput.permissionDecisionReason, /config off-limits/);
});
