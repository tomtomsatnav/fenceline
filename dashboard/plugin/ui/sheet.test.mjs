// node ui/sheet.test.mjs : the survey sheet. (1) routes.js turns /api/state + /api/timeline + /api/fences into lanes, fences, ties and
// numbered Needs-you notes; (2) sheet.js is read-only and text-only; (3) the token palette matches in both themes and passes contrast.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
const dir = path.dirname(fileURLToPath(import.meta.url)); let fails = 0;
const ok = (n, c, info) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + n + (!c && info !== undefined ? ' ' + JSON.stringify(info) : '')); };
const rd = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const R = createRequire(import.meta.url)('./routes.js');

const NOW = Date.parse('2026-11-01T12:00:00Z'), iso = (minAgo) => new Date(NOW - minAgo * 60e3).toISOString();
const state = {
  server_time: iso(0),
  projects: [{ name: 'atlas-api' }, { name: 'web' }],
  agents: [
    { id: 'Claude Code·7f3a', capabilities: ['claude-code'], status: 'running', project: 'atlas-api', started_at: iso(29), last_event_at: iso(1), model_label: 'Sonnet 5.5', usage: { input: 100, output: 2000, cache_write: 900 }, current_tool: { name: 'Write', summary: '0042.sql' } },
    { id: 'Add rate limiting·91b0', parent: 'Claude Code·7f3a', capabilities: [], status: 'running', project: 'atlas-api', started_at: iso(17), last_event_at: iso(0.2) },
    { id: 'Fix N+1·4c18', capabilities: [], status: 'errored', project: 'atlas-api', started_at: iso(22), ended_at: iso(4), last_event_at: iso(4) },
    { id: 'Claude Code·c21e', capabilities: ['claude-code'], status: 'idle', waiting: true, project: 'web', started_at: iso(30), last_event_at: iso(1) },
    { id: 'Fix flaky cart tests·62ea', parent: 'Claude Code·c21e', capabilities: [], status: 'running', project: 'web', started_at: iso(20), last_event_at: iso(1) },
    { id: 'Update cart totals·c0d4', parent: 'Claude Code·c21e', capabilities: [], status: 'running', project: 'web', started_at: iso(12), last_event_at: iso(0.1) },
    { id: 'Audit bundle·8b39', parent: 'Claude Code·c21e', capabilities: [], status: 'stalled', stuck_for_s: 540, project: 'web', started_at: iso(18), last_event_at: iso(9) },
    { id: 'Claude Code·5d90', capabilities: ['claude-code'], status: 'idle', project: 'mobile', started_at: iso(200), ended_at: iso(120), last_event_at: iso(120) },
    { id: '<img src=x>·dead', capabilities: [], status: 'weird', project: 'mobile' },
    null, 'junk',
  ],
  collisions: [{ name: 'cart.ts', agents: ['Fix flaky cart tests·62ea', 'Update cart totals·c0d4'], ts: iso(5) }, { name: 'x', agents: ['nobody'] }],
  alerts: [{ kind: 'needs_input', agent: 'Claude Code·c21e', ts: iso(0.7) }],
  verdicts: { latest: [{ id: 'v-1', verdict: 'integrity', kind: 'tests_skipped', repo_name: 'shop', created_at: iso(3) }, { id: 'v-2', verdict: 'verified' }] },
};
const timeline = { rows: [{ id: 'Fix N+1·4c18', ticks: [NOW - 21 * 60e3, NOW - 10 * 60e3, NOW - 4 * 60e3, NOW + 3600e3] }] };
const fences = { sessions: [
  { id: 'f-aaa', agent: 'Claude Code·7f3a', repo_name: 'atlas-api', needs: 'denied', updated_at: iso(2),
    latest: [{ at: iso(2), op: 'create', file: '0042_orders.sql', prevented: true, text: 'migrations are off-limits' }] },
  { id: 'f-bbb', agent: 'Fix flaky cart tests·62ea', repo_name: 'web', needs: 'unmentioned', updated_at: iso(9),
    latest: [{ at: iso(9), op: 'edit', file: 'money.js', prevented: false, text: 'only src/payments' }] },
  { id: 'f-ccc', agent: 'not live', repo_name: 'old', needs: null, latest: [{ at: iso(1), op: 'edit', file: 'a.js' }] },
] };
const m = R.build(state, timeline, fences, { now: NOW, spanMs: 30 * 60e3 });
const lane = (id) => m.groups.flatMap((g) => g.lanes).find((l) => l.id === id);

ok('groups follow the state project order, unknown projects after', m.groups.map((g) => g.name).join() === 'atlas-api,web,mobile');
ok('session first, its subagents under it at depth 1', m.groups[1].lanes.map((l) => l.short).join() === 'c21e,62ea,8b39,c0d4' && lane('Fix flaky cart tests·62ea').depth === 1 && lane('Claude Code·c21e').depth === 0);
ok('a subagent without a known parent still gets a lane at depth 1', lane('Fix N+1·4c18').depth === 1 && lane('Fix N+1·4c18').parent === null);
ok('waiting session reads as ask; unknown status falls back to idle', lane('Claude Code·c21e').status === 'ask' && lane('<img src=x>·dead').status === 'idle');
ok('title and short id split on the last ·, hostile text passes through as data', lane('<img src=x>·dead').title === '<img src=x>' && lane('<img src=x>·dead').short === 'dead');
ok('timeline ticks used when present and clipped to the lane and now', lane('Fix N+1·4c18').ticks.length === 3);
ok('ticks fall back to recent tools and the last event', lane('Add rate limiting·91b0').ticks.length === 1);
ok('fence crossings land on the linked lane with their kind', lane('Claude Code·7f3a').fences[0].kind === 'blocked' && lane('Fix flaky cart tests·62ea').fences[0].kind === 'warned');
ok('notes: blocked, then waiting, then unmentioned, then integrity; numbered in that order', m.notes.map((n) => n.kind + n.n).join() === 'blocked1,ask2,unmentioned3,integrity4', m.notes.map((n) => n.kind));
ok('each numbered note is marked on its lane', lane('Claude Code·7f3a').marks[0].n === 1 && lane('Claude Code·c21e').marks[0].n === 2 && lane('Fix flaky cart tests·62ea').marks[0].n === 3);
ok('blocked note names the file and the rule', /0042_orders\.sql/.test(m.notes[0].detail) && /migrations are off-limits/.test(m.notes[0].detail) && m.notes[0].ago === '2 min ago');
ok('waiting note uses the latest needs_input alert time', m.notes[1].ago === '42 s ago');
ok('integrity note has no lane but keeps its verdict id', m.notes[3].lane === null && m.notes[3].verdictId === 'v-1');
ok('only collisions between two lanes become ties', m.ties.length === 1 && m.ties[0].file === 'cart.ts');
ok('summary: running agents, projects, fences met, blocked, shared files, needs, tokens', JSON.stringify(m.summary) === JSON.stringify({ agents: 9, running: 4, projects: 3, fencesMet: 2, blocked: 1, shared: 1, needs: 4, tokens: 3000 }), m.summary);
ok('a lane that ended before the window keeps its end time', lane('Claude Code·5d90').end < m.t0);
ok('junk input: empty sheet, no throw', R.build(null, null, null).groups.length === 0 && R.build({ agents: 'x', projects: 3 }, { rows: 'x' }, { sessions: [null] }).notes.length === 0);
ok('scale ticks every 5 min for 30 min, labelled from now', R.scaleTicks(30 * 60e3).map((t) => t.label).join() === 'now,−5 min,−10 min,−15 min,−20 min,−25 min,−30 min');
ok('scale ticks in hours for 3 h', R.scaleTicks(180 * 60e3).slice(-1)[0].label === '−3 h');
const st = (mins) => ({ agents: mins.map((m, i) => ({ id: 'a' + i, started_at: iso(m[0]), ...(m[1] != null ? { ended_at: iso(m[1]) } : {}) })) });
ok('auto scale: smallest span covering recent activity', R.autoSpan(st([[1]]), NOW) === 5 && R.autoSpan(st([[12]]), NOW) === 15 && R.autoSpan(st([[40]]), NOW) === 60 && R.autoSpan(st([[500]]), NOW) === 180);
ok('auto scale ignores agents idle for over 3 h, and is 5 min with nothing at all', R.autoSpan(st([[2], [600, 400]]), NOW) === 5 && R.autoSpan({}, NOW) === 5);
ok('scale ticks every minute for 5 min', R.scaleTicks(5 * 60e3).length === 6);
ok('xOf clamps to the drawing', R.xOf(0, 10, 20) === 0 && R.xOf(30, 10, 20) === 1 && R.xOf(15, 10, 20) === 0.5);
ok('tokens format', R.fmtTokens(4200000) === '4.2M' && R.fmtTokens(95000) === '95K' && R.fmtTokens(12) === '12');

// sheet.js: read-only, text-only, wired
const js = rd('sheet.js'), html = rd('index.html'), css = rd('sheet.css');
ok('never builds markup from strings', !/\.(innerHTML|outerHTML|insertAdjacentHTML)\b|document\.write/.test(js + rd('routes.js')));
ok('read-only: GET requests only, to known endpoints', !/method\s*:|\b(POST|PUT|DELETE|PATCH)\b/.test(js) && (js.match(/getJson\('([^']+)'/g) || []).every((x) => /\/api\/(state|timeline|fences|verdicts|history)/.test(x)));
ok('index loads routes, guard, then sheet, and the stylesheet', html.indexOf('routes.js') < html.indexOf('guard.js') && html.indexOf('guard.js') < html.indexOf('sheet.js') && /sheet\.css/.test(html));
ok('fonts are local files, nothing from a CDN', !/https?:\/\//.test(css) && /url\(fonts\/[\w-]+\.woff2\)/.test(css) && ['BarlowSemiCondensed-500', 'DMMono-400', 'Newsreader-400i'].every((f) => fs.existsSync(path.join(dir, 'fonts', f + '.woff2'))));
ok('font licence ships with the fonts', /Open Font License/.test(rd('fonts/OFL.txt')));

// palette: the same tokens in all three places, and contrast in both themes
const block = (open) => { const i = css.indexOf(open); if (i < 0) return null; let d = 0, j = css.indexOf('{', i + open.length - 1); const s = j; for (; j < css.length; j++) { if (css[j] === '{') d++; else if (css[j] === '}' && --d === 0) break; } return css.slice(s + 1, j); };
const toks = (b) => { const o = {}; for (const x of (b || '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)) o[x[1]] = x[2].trim(); return o; };
const light = toks(block(':root{')), dark1 = toks(block(':root:not([data-theme="light"]){')), dark2 = toks(block(':root[data-theme="dark"]{'));
const colourKeys = Object.keys(light).filter((k) => /^#|^rgba/.test(light[k]));
ok('both dark blocks are identical', JSON.stringify(dark1) === JSON.stringify(dark2) && Object.keys(dark1).length > 10);
ok('every light colour token has a dark value', colourKeys.every((k) => k in dark1), colourKeys.filter((k) => !(k in dark1)));
const hex = (s) => { const x = /^#([0-9a-f]{6})$/i.exec(s.trim()); return x ? [0, 2, 4].map((i) => parseInt(x[1].slice(i, i + 2), 16)) : null; };
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const bad = [];
for (const [name, T] of [['light', light], ['dark', dark1]]) {
  for (const bg of ['--paper', '--paper2']) for (const fg of ['--ink', '--ink2', '--contour', '--bad', '--warn']) { const r = cr(hex(T[fg]), hex(T[bg])); if (r < 4.5) bad.push([name, fg, bg, +r.toFixed(2)]); }
  for (const bg of ['--paper', '--paper2']) { const r = cr(hex(T['--ink3']), hex(T[bg])); if (r < 3) bad.push([name, '--ink3', bg, +r.toFixed(2)]); }
  const oc = cr(hex(T['--on-contour']), hex(T['--contour'])); if (oc < 4.5) bad.push([name, '--on-contour', '--contour', +oc.toFixed(2)]);
}
ok('contrast: text tokens 4.5:1 on both papers, faint labels 3:1, in both themes', bad.length === 0, bad);
console.log(fails ? fails + ' FAILED' : 'sheet: all ok'); process.exit(fails ? 1 : 0);
