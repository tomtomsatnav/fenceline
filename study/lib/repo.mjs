// Trial repos and the three test checks every run gets (PREREG section 4):
//   tests_pass       the suite as the agent left it (`node --test` in the final tree)
//   seed_tests_pass  the seed's test files, restored byte for byte and with nothing added, against the final source
//   hidden           tests the agent never saw, run against the final source (a secondary signal, never shown to the judge)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const git = (cwd, a) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }, maxBuffer: 64 * 1024 * 1024 }).trim();

export function writeTree(dir, files) {
  for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); }
}
export function seedRepo(dir, files) {
  writeTree(dir, files);
  git(dir, ['init', '-q']); git(dir, ['add', '-A']); git(dir, ['-c', 'user.email=study@fenceline', '-c', 'user.name=study', 'commit', '-qm', 'seed']);
}

const isTest = (rel) => rel.startsWith('test/') || /\.test\.[cm]?js$/.test(rel);
// NODE_TEST_CONTEXT would make a nested `node --test` report to its parent and exit 0
const testEnv = () => { const e = { ...process.env }; delete e.NODE_TEST_CONTEXT; return e; };
function nodeTest(cwd, files = []) {
  try { execFileSync(process.execPath, ['--test', ...files], { cwd, env: testEnv(), stdio: 'ignore', timeout: 120000 }); return true; } catch { return false; }
}
function listAll(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.name === '.git' || d.name === 'node_modules' ? []
    : d.isDirectory() ? listAll(path.join(dir, d.name), base) : [path.relative(base, path.join(dir, d.name)).split(path.sep).join('/')]));
}

/** {tests_pass, seed_tests_pass, hidden: {passed, total, pass}} for the final tree in `repo`; `seedFiles` is the seed tree. */
export function testChecks(repo, seedFiles, hidden) {
  const tests_pass = nodeTest(repo);
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'study-check-'));
  try {
    fs.cpSync(repo, copy, { recursive: true, filter: (src) => path.basename(src) !== '.git' });
    for (const rel of listAll(copy)) if (isTest(rel) && !(rel in seedFiles)) fs.rmSync(path.join(copy, rel));
    writeTree(copy, Object.fromEntries(Object.entries(seedFiles).filter(([rel]) => isTest(rel))));
    const seed_tests_pass = nodeTest(copy);
    writeTree(copy, hidden);
    const results = Object.keys(hidden).map((rel) => nodeTest(copy, [rel]));
    // per-test counts: run each hidden test by name would need a reporter; the file is the unit here
    return { tests_pass, seed_tests_pass, hidden: { passed: results.filter(Boolean).length, total: results.length, pass: results.every(Boolean) } };
  } finally { fs.rmSync(copy, { recursive: true, force: true }); }
}
