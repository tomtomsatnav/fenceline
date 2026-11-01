/* Fenceline sheet model: turns /api/state, /api/timeline and /api/fences into what the sheet draws.
 * Pure and read-only. Loaded as a plain script (window.FLRoutes) and by node (module.exports) for tests.
 *   build(state, timeline, fences, opts) -> { t0, t1, groups: [{ name, lanes }], notes, ties, summary }
 * A lane is one agent: a route from its start to its end (or now), tool-call ticks, fences it met, and its numbered marks.
 * Notes are what needs the human, blocked fences first; each note's number is drawn on the lane it belongs to.
 * Every string is passed through as data; the renderer uses textContent only.
 */
(function (root) {
  'use strict';
  var NOTE_ORDER = { blocked: 0, ask: 1, unmentioned: 2, integrity: 3 };
  var OPS = { create: 'created', edit: 'edited', delete: 'deleted', read: 'read' };

  function list(x) { return Array.isArray(x) ? x : []; }
  function str(x, n) { x = x == null ? '' : String(x); return n && x.length > n ? x.slice(0, n - 1) + '…' : x; }
  function ms(iso) { var t = Date.parse(iso); return isFinite(t) ? t : null; }
  /* "Fix flaky cart tests·62ea" -> { title, short } */
  function splitId(id) { id = str(id); var i = id.lastIndexOf('·'); return i > 0 ? { title: id.slice(0, i), short: id.slice(i + 1) } : { title: id, short: '' }; }
  function isSession(a) { return list(a && a.capabilities).indexOf('claude-code') >= 0; }

  /* one of: running, ask, idle, stalled, errored, done */
  function laneStatus(a) {
    if (a.waiting) return 'ask';
    var s = a.status;
    return s === 'running' || s === 'idle' || s === 'stalled' || s === 'errored' || s === 'done' ? s : 'idle';
  }
  var STATUS_TEXT = { running: 'Running', ask: 'Waiting for you', idle: 'Idle', stalled: 'No activity', errored: 'Stopped with an error', done: 'Finished' };

  function ago(t, now) {
    var s = Math.max(0, Math.round((now - t) / 1000));
    if (s < 60) return s + ' s ago';
    var m = Math.round(s / 60); if (m < 60) return m + ' min ago';
    var h = Math.floor(m / 60); return h + ' h ' + (m % 60) + ' min ago';
  }

  function build(state, timeline, fences, opts) {
    opts = opts || {};
    state = state && typeof state === 'object' ? state : {};
    var now = opts.now || ms(state.server_time) || Date.now(), span = opts.spanMs || 30 * 60e3, t0 = now - span;
    var agents = list(state.agents), byId = {}, ticks = {}, parentOf = {};
    list(timeline && timeline.rows).forEach(function (r) { if (r && r.id) { ticks[r.id] = list(r.ticks).filter(function (t) { return typeof t === 'number'; }); if (r.parent) parentOf[r.id] = r.parent; } });
    agents.forEach(function (a) { if (a && a.id) byId[a.id] = a; });

    /* lanes */
    var lanes = {};
    agents.forEach(function (a) {
      if (!a || !a.id) return;
      var sp = splitId(a.id), st = laneStatus(a), start = ms(a.started_at), last = ms(a.last_event_at);
      var end = a.ended_at ? ms(a.ended_at) : null;
      if (start == null) start = last != null ? last : now;
      if (end != null && end < start) end = start;
      var tk = ticks[a.id];
      if (!tk) { tk = list(a.recent_tools).map(function (x) { return ms(x && x.ts); }).filter(function (t) { return t != null; }); if (last != null) tk.push(last); }
      var parent = a.parent || parentOf[a.id] || null;
      lanes[a.id] = { id: str(a.id), title: str(sp.title, 120), short: sp.short, session: isSession(a), parent: parent && byId[parent] ? parent : null,
        project: str(a.project || 'other', 60), model: str(a.model_label || a.model || '', 40), status: st, statusText: STATUS_TEXT[st],
        start: start, end: end, last: last != null ? last : start, ticks: tk.filter(function (t) { return t >= start - 1000 && t <= now + 1000; }).sort(function (x, y) { return x - y; }),
        tool: a.current_tool ? str(a.current_tool.name, 30) + (a.current_tool.summary ? ' ' + str(a.current_tool.summary, 80) : '') : '',
        recent: list(a.recent_tools).slice(-5).reverse().map(function (x) { x = x || {}; return { at: ms(x.ts), name: str(x.name, 30), summary: str(x.summary, 80), ms: Number(x.ms) || null }; }),
        tokens: a.usage ? (Number(a.usage.output) || 0) + (Number(a.usage.input) || 0) + (Number(a.usage.cache_write) || 0) : 0,
        stuckFor: a.stuck_for_s || null, error: a.error_kind ? str(a.error_kind, 60) : '', machine: a.machine ? str(a.machine, 40) : '',
        fences: [], marks: [] };
    });

    /* fences met, from the Fenceline sessions linked to a live session agent */
    var notes = [];
    list(fences && fences.sessions).forEach(function (f) {
      if (!f || typeof f !== 'object') return;
      var lane = f.agent && lanes[f.agent] ? lanes[f.agent] : null;
      list(f.latest).forEach(function (c) {
        c = c || {}; var at = ms(c.at); if (!lane || at == null) return;
        lane.fences.push({ at: at, kind: c.prevented ? 'blocked' : 'warned', file: str(c.file, 80), op: OPS[c.op] || 'edited', rule: str(c.text || c.fence, 160) });
      });
      if (f.needs === 'denied' || f.needs === 'unmentioned') {
        var cs = list(f.latest).filter(function (c) { return c && (f.needs === 'denied' ? c.prevented : !c.prevented); }), c0 = cs[0] || list(f.latest)[0] || {};
        notes.push({ kind: f.needs === 'denied' ? 'blocked' : 'unmentioned', lane: lane ? lane.id : null, at: ms(c0.at) || ms(f.updated_at) || now, fenceId: str(f.id, 40),
          what: f.needs === 'denied' ? 'Blocked at a fence' : 'Crossed a fence without saying so',
          who: (lane ? lane.title : str(f.agent || 'A session', 60)) + ' in ' + str(f.repo_name || 'repo', 60),
          detail: (c0.prevented ? 'denied: ' : '') + (OPS[c0.op] || 'edited') + ' ' + (str(c0.file, 80) || 'a file') + (c0.text || c0.fence ? ' · rule: ' + str(c0.text || c0.fence, 140) : '') });
      }
    });
    Object.keys(lanes).forEach(function (k) { if (lanes[k].status === 'ask') { var l = lanes[k], a = byId[k], askAt = null;
      list(state.alerts).forEach(function (x) { if (x && x.kind === 'needs_input' && x.agent === k) { var t = ms(x.ts); if (t != null && (askAt == null || t > askAt)) askAt = t; } });
      notes.push({ kind: 'ask', lane: k, at: askAt || l.last, what: 'Waiting for your answer', who: l.title + ' in ' + l.project,
        detail: a && a.current_tool ? 'asked before ' + str(a.current_tool.name, 30) + (a.current_tool.summary ? ' ' + str(a.current_tool.summary, 60) : '') : 'answer it in that Claude Code session' }); } });
    list(state.verdicts && state.verdicts.latest).forEach(function (v) {
      if (!v || v.verdict !== 'integrity') return;
      notes.push({ kind: 'integrity', lane: v.agent && lanes[v.agent] ? v.agent : null, at: ms(v.created_at) || now, verdictId: str(v.id, 40), what: 'Tests were weakened',
        who: str(v.repo_name || 'repo', 60), detail: 'the guard rejected this work: ' + str(v.kind || 'integrity', 60).replace(/[_.-]+/g, ' ') });
    });
    notes.sort(function (a, b) { return NOTE_ORDER[a.kind] - NOTE_ORDER[b.kind] || b.at - a.at; });
    notes.forEach(function (n, i) { n.n = i + 1; n.ago = ago(n.at, now); if (n.lane && lanes[n.lane]) lanes[n.lane].marks.push({ n: n.n, kind: n.kind, at: Math.min(now, Math.max(lanes[n.lane].start, n.at)) }); });

    /* shared files: tie the two lanes at the time the conflict began */
    var ties = [];
    list(state.collisions).forEach(function (c) {
      if (!c) return; var ag = list(c.agents).filter(function (id) { return lanes[id]; });
      if (ag.length >= 2) ties.push({ a: ag[0], b: ag[1], at: Math.max(t0, ms(c.ts) || now), file: str(c.name || c.file, 80) });
    });

    /* groups: projects in the state's order, each session followed by its subagents (depth 1), then orphans */
    var order = list(state.projects).map(function (p) { return p && p.name; }).filter(Boolean), groups = {}, gl = [];
    Object.keys(lanes).forEach(function (k) { var p = lanes[k].project; if (!groups[p]) { groups[p] = []; if (order.indexOf(p) < 0) order.push(p); } groups[p].push(lanes[k]); });
    order.forEach(function (p) {
      var ls = groups[p]; if (!ls) return;
      var byStart = function (x, y) { return x.start - y.start || (x.id < y.id ? -1 : 1); }, out = [], seen = {};
      var heads = ls.filter(function (l) { return !l.parent || !lanes[l.parent] || lanes[l.parent].project !== p; }).sort(function (x, y) { return (x.session === y.session ? 0 : x.session ? -1 : 1) || byStart(x, y); });
      heads.forEach(function (h) {
        out.push(h); seen[h.id] = 1; h.depth = h.session ? 0 : 1;
        ls.filter(function (l) { return l.parent === h.id; }).sort(byStart).forEach(function (c) { c.depth = 1; out.push(c); seen[c.id] = 1; });
      });
      ls.forEach(function (l) { if (!seen[l.id]) { l.depth = 1; out.push(l); } });
      gl.push({ name: p, lanes: out });
    });

    var all = Object.keys(lanes).map(function (k) { return lanes[k]; });
    var crossed = 0, blocked = 0; all.forEach(function (l) { l.fences.forEach(function (f) { if (f.kind === 'blocked') blocked++; else crossed++; }); });
    var tokens = 0; all.forEach(function (l) { tokens += l.tokens; });
    return { t0: t0, t1: now, span: span, groups: gl, notes: notes, ties: ties,
      summary: { agents: all.length, running: all.filter(function (l) { return l.status === 'running'; }).length, projects: gl.length,
        fencesMet: crossed + blocked, blocked: blocked, shared: ties.length, needs: notes.length, tokens: tokens } };
  }

  /* Auto scale: the smallest of 5/15/30/60/180 minutes that covers every agent active in the last 3 hours, with a little room */
  var SPANS = [5, 15, 30, 60, 180];
  function autoSpan(state, now) {
    var earliest = now;
    list(state && state.agents).forEach(function (a) {
      if (!a) return; var st = ms(a.started_at), end = a.ended_at ? ms(a.ended_at) : now;
      if (st == null || end < now - 180 * 60e3) return; earliest = Math.min(earliest, Math.max(st, now - 180 * 60e3));
    });
    var need = (now - earliest) / 60e3 * 1.08;
    for (var i = 0; i < SPANS.length; i++) if (SPANS[i] >= need) return SPANS[i];
    return 180;
  }
  /* x position (0..1 across the drawing) of a time, clamped */
  function xOf(t, t0, t1) { return t1 > t0 ? Math.max(0, Math.min(1, (t - t0) / (t1 - t0))) : 1; }
  /* tick marks for the scale: every step minutes, from now backwards */
  function scaleTicks(span) {
    var m = span / 60e3, step = m <= 5 ? 1 : m <= 15 ? 3 : m <= 30 ? 5 : m <= 60 ? 10 : m <= 180 ? 30 : 60, out = [];
    for (var k = 0; k <= m + 0.001; k += step) out.push({ minutes: k, label: k === 0 ? 'now' : k >= 60 && k % 60 === 0 ? '−' + (k / 60) + ' h' : '−' + k + ' min' });
    return out;
  }
  function fmtTokens(n) { n = Number(n) || 0; return n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n); }

  var api = { build: build, autoSpan: autoSpan, splitId: splitId, laneStatus: laneStatus, xOf: xOf, scaleTicks: scaleTicks, fmtTokens: fmtTokens, ago: ago, STATUS_TEXT: STATUS_TEXT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FLRoutes = api;
})(typeof window !== 'undefined' ? window : globalThis);
