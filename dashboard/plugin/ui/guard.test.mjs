// node ui/guard.test.mjs : guard and fence display models (pure). The sheet's Fences view renders them; its DOM is covered by sheet.test.mjs.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
const dir = path.dirname(fileURLToPath(import.meta.url)); let fails = 0;
const ok = (n, c) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + n); };
const req = createRequire(import.meta.url), G = req('./guard.js');
const rd = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

// badge states
const b = (g) => G.badge(g);
ok('verified', b({ verdict: 'verified' }).state === 'verified' && b({ verdict: 'verified' }).text === 'verified');
ok('integrity rejection names the kind', b({ verdict: 'integrity', kind: 'tests_edited' }).state === 'integrity' && b({ verdict: 'integrity', kind: 'tests_edited' }).text === 'rejected: tests edited');
ok('integrity without kind', b({ verdict: 'integrity', kind: null }).text === 'rejected: integrity');
ok('capability rejection = checks failed', b({ verdict: 'capability', kind: 'checks_failed' }).state === 'capability' && b({ verdict: 'capability' }).text === 'rejected: checks failed');
ok('none for missing / junk', b(null).state === 'none' && b({ verdict: '<img>' }).state === 'none' && b('x').state === 'none');
const V = { id: 'v-20261021-110000-bbbbbb', created_at: '2026-10-21T11:00:00.000Z', repo_name: 'shop', verdict: 'integrity', kind: 'tests_edited', source: 'hook', agent: 'Claude Code·sess', tree: 'working', base: '0123456789ab', base_ref: null,
  rejections: [{ kind: 'tests_edited', detail: '<img src=x onerror=alert(1)>' }], warnings: ['literal_copy src/expand.js: copied'], failing_tests: ['test/vat.test.js: adds 20% VAT'], checks: [{ cmd: 'npm test', ok: false, exit_code: 1, duration_ms: 1534 }], duration_ms: 4100 };
const m = G.rowModel(V);
ok('row model: repo, reasons, failing tests, checks', m.repo === 'shop' && m.reasons[0].kind === 'tests edited' && m.failing[0] === 'test/vat.test.js: adds 20% VAT' && m.checks[0].text === 'failed (exit 1) · 1.5s' && /via hook/.test(m.meta) && /working tree/.test(m.meta));
ok('row model tolerates junk', G.rowModel({ rejections: 'x', checks: [null] }).checks[0].cmd === '(command)');
const fb = (f) => G.fenceBadge(f);
ok('fence badge: stopped after a denial, crossed with a count, denied-only, clean, none', fb({ needs: 'denied', crossed: 0, blocked: 1 }).state === 'stopped' && fb({ crossed: 2 }).text === 'fence: 2 crossed' && fb({ crossed: 0, blocked: 3 }).text === 'fence: 3 denied' && fb({ crossed: 0, blocked: 0 }).text === 'fences: clean' && fb(null) === null);
const fr = G.fenceRowModel({ id: 'f-0123456789ab', repo_name: 'shop', agent: 'Claude Code·sess', updated_at: '2026-11-01T10:00:00Z', needs: 'denied', crossed: 1, blocked: 1,
  fences: [{ text: 'migrations are off-limits', mode: 'block' }, { text: 'only src/payments', mode: 'warn' }],
  latest: [{ at: '2026-11-01T10:00:00Z', op: 'create', file: '0042.sql', prevented: true, text: 'migrations are off-limits' }, { at: '2026-11-01T09:00:00Z', op: 'edit', file: 'money.js', prevented: false, text: 'only src/payments' }] });
ok('fence row model: stopped, both rules with their mode, denied and landed crossings', fr.state === 'stopped' && fr.fences.length === 2 && fr.fences[0].mode === 'block' && /^denied: created 0042\.sql/.test(fr.crossings[0].text) && fr.crossings[0].bad === false && fr.crossings[1].bad === true);
const g = rd('guard.js');
ok('guard.js is pure: no DOM, no fetch, no innerHTML', !/document\.|fetch\(|innerHTML/.test(g));
console.log(fails ? fails + ' FAILED' : 'guard: all ok'); process.exit(fails ? 1 : 0);
