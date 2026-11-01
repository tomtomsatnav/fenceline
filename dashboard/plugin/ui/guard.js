/* Guard and fence display models: Fenceline's fences (what each session crossed or was stopped at) and the verdicts of
 * `aos-orch verify` (re-runs the original tests in a sandbox + anti-cheat diff analysis). The sheet's Fences view renders them.
 * Read-only: GET /api/fences and /api/verdicts on the monitor (same origin), and the `fences` / `verdicts` summaries and the agent
 * `fence` / `guard` fields in /api/state.
 * Pure helpers only (badge, kindText, rowModel, fenceBadge, fenceRowModel); they load in node for tests (module.exports).
 * Vanilla ES5, no deps. Every string is hostile: the renderer puts these strings in as text only.
 */
(function (root) {
  'use strict';
  var STATES = { verified: 1, integrity: 1, capability: 1 };
  function str(x, n) { x = x == null ? '' : String(x); return n && x.length > n ? x.slice(0, n) + '…' : x; }
  function kindText(k) { return str(k).replace(/[_.-]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  /* agent.guard (or a verdict) -> { state: verified|integrity|capability|none, text, title } */
  function badge(g) {
    var v = g && typeof g === 'object' ? g.verdict : null;
    if (!STATES[v]) return { state: 'none', text: 'guard: none', title: 'No guard verdict for this session' };
    if (v === 'verified') return { state: v, text: 'verified', title: 'aos-orch verify accepted this work: the original tests pass in a sandbox and no integrity issue was found' };
    if (v === 'integrity') return { state: v, text: 'rejected: ' + (g.kind ? kindText(g.kind) : 'integrity'), title: 'Integrity rejection: the work changed, skipped or weakened the tests (or passed vacuously). Do not merge without a look.' };
    return { state: v, text: 'rejected: checks failed', title: 'Capability rejection: the original tests or checks failed in the sandbox' };
  }
  function fmtMs(ms) { ms = Number(ms); if (!isFinite(ms) || ms < 0) return ''; return ms < 1000 ? Math.round(ms) + 'ms' : ms < 60000 ? (ms / 1000).toFixed(1).replace(/\.0$/, '') + 's' : Math.round(ms / 60000) + 'm'; }
  function when(iso) { var t = Date.parse(iso); if (!isFinite(t)) return ''; var d = new Date(t), p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  function list(x) { return Array.isArray(x) ? x : []; }
  /* one verdict -> plain display model (strings only) */
  function rowModel(v) {
    var b = badge(v), meta = [when(v.created_at), v.source && v.source !== 'unknown' ? 'via ' + str(v.source, 10) : '', v.agent ? str(v.agent, 60) : '', v.tree === 'working' ? 'working tree' : v.tree ? 'commit ' + str(v.tree, 12) : '', v.base ? 'base ' + (v.base_ref ? str(v.base_ref, 40) + ' ' : '') + str(v.base, 12) : '', fmtMs(v.duration_ms)].filter(Boolean);
    return { id: str(v.id, 40), state: b.state, label: b.text, title: b.title, repo: str(v.repo_name || 'repo', 60), meta: meta.join(' · '),
      reasons: list(v.rejections).map(function (r) { return { kind: kindText(r && r.kind), detail: str(r && r.detail, 200) }; }),
      warnings: list(v.warnings).map(function (w) { return str(w, 200); }), failing: list(v.failing_tests).map(function (t) { return str(t, 200); }),
      checks: list(v.checks).map(function (c) { c = c || {}; return { cmd: str(c.cmd, 200) || '(command)', ok: c.ok === true, text: (c.ok === true ? 'ok' : 'failed' + (c.exit_code != null ? ' (exit ' + str(c.exit_code, 6) + ')' : '')) + (fmtMs(c.duration_ms) ? ' · ' + fmtMs(c.duration_ms) : '') }; }) };
  }
  /* agent.fence (or a fence session) -> { state: stopped|crossed|clean, text, title } */
  function fenceBadge(f) {
    if (!f || typeof f !== 'object') return null;
    var c = Number(f.crossed) || 0, b = Number(f.blocked) || 0;
    if (f.needs === 'denied') return { state: 'stopped', text: 'fence: stopped', title: 'A fence denied an edit in the last turn: the agent stopped there and may be waiting on you' };
    if (c) return { state: 'crossed', text: 'fence: ' + c + ' crossed', title: c + (c === 1 ? ' fence crossing' : ' fence crossings') + ' landed in this session' + (f.needs === 'unmentioned' ? ', one not mentioned in the agent\'s final message' : '') };
    if (b) return { state: 'clean', text: 'fence: ' + b + ' denied', title: b + (b === 1 ? ' edit' : ' edits') + ' denied by a fence; nothing fenced changed' };
    return { state: 'clean', text: 'fences: clean', title: 'No fence crossed in this session' };
  }
  var OPS = { create: 'created', edit: 'edited', delete: 'deleted', read: 'read' };
  /* one Fenceline session -> plain display model (strings only) */
  function fenceRowModel(f) {
    var b = fenceBadge(f) || fenceBadge({}), meta = [when(f.updated_at), f.agent ? str(f.agent, 60) : '', list(f.fences).length + (list(f.fences).length === 1 ? ' fence' : ' fences')].filter(Boolean);
    return { id: str(f.id, 40), state: b.state, label: b.text, title: b.title, repo: str(f.repo_name || 'repo', 60), meta: meta.join(' · '),
      fences: list(f.fences).map(function (x) { x = x || {}; return { text: str(x.text, 160), mode: x.mode === 'block' ? 'block' : 'warn' }; }),
      crossings: list(f.latest).map(function (c) { c = c || {}; return { text: (c.prevented ? 'denied: ' : '') + (OPS[c.op] || 'edited') + ' ' + (str(c.file, 80) || 'a file'), fence: str(c.text || c.fence, 160), when: when(c.at), bad: !c.prevented }; }) };
  }
  var api = { badge: badge, kindText: kindText, rowModel: rowModel, fenceBadge: fenceBadge, fenceRowModel: fenceRowModel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AOSGuard = api;
})(typeof window !== 'undefined' ? window : globalThis);
