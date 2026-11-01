// node ui/needs-you.test.mjs : the Needs-you aggregation (fence stops, unmentioned crossings, integrity rejections) and the
// static wiring of the header badge / popover (ui/needs.js).
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
const dir = path.dirname(fileURLToPath(import.meta.url)); let fails = 0;
const ok = (n, c) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + n); };
const { compute } = createRequire(import.meta.url)('./needs-you.js');
const rd = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
ok('empty / junk input -> 0', compute().total === 0 && compute(null, null).total === 0 && compute({ latest: 'x' }, { needs: [null, 3, {}] }).total === 0);
const F = { needs: [{ id: 'f-1', repo_name: 'shop', needs: 'denied', agent: 'Claude Code·sess' }, { id: 'f-2', repo_name: 'api', needs: 'unmentioned' }, { id: 'f-3', needs: 'bogus' }] };
const V = { latest: [{ id: 'v-1', repo_name: 'web', verdict: 'integrity', kind: 'tests_skipped' }, { id: 'v-2', verdict: 'capability' }, { id: 'v-3', verdict: 'verified' }] };
const r = compute(V, F);
ok('fence stop + unmentioned crossing + integrity rejection = 3; capability, verified and unknown kinds are not counted', r.total === 3 && r.items.map((i) => i.id + ':' + i.kind).join() === 'f-1:fence,f-2:fence,v-1:integrity');
ok('texts', /waiting on you/.test(r.items[0].text) && r.items[0].title === 'shop · Claude Code·sess' && /without saying so/.test(r.items[1].text) && r.items[2].text === 'guard rejected: tests skipped');
const ui = rd('needs.js'), css = rd('panel.css'), html = rd('index.html');
ok('badge hidden at 0, shows the count, every item opens the guard panel', /R\.btn\.hidden = nd\.total <= 0/.test(ui) && /Needs you /.test(ui) && /AOSGuard\.open\(it\.id\)/.test(ui));
ok('read-only: no fetch or POST', !/fetch|POST/.test(ui));
ok('scripts: needs-you.js and guard.js before needs.js', html.indexOf('needs-you.js') > 0 && html.indexOf('needs-you.js') < html.indexOf('needs.js?') && html.indexOf('guard.js') < html.indexOf('needs.js?'));
ok('mobile: popover fits viewport, 36px targets', /@media \(max-width:720px\)\{\.orch-needs\{[^}]*min-height:36px\}\.orch-needs-pop\{[^}]*left:12px;right:12px/.test(css) && /\.orch-needs-it\{[^}]*min-height:36px/.test(css));
console.log(fails ? fails + ' FAILED' : 'needs-you: all ok'); process.exit(fails ? 1 : 0);
