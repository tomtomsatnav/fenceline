/* Fenceline dashboard: draws the survey sheet from the monitor's read-only API (same origin).
 *   GET /api/state     agents, projects, collisions, alerts, events, verdicts summary   (every 2 s; ?at= in replay)
 *   GET /api/timeline  per-agent start/end and activity ticks                           (every 5 s; ?at= in replay)
 *   GET /api/fences    Fenceline sessions: rules and crossings                          (every 5 s)
 *   GET /api/verdicts  guard verdicts                                                   (Fences view only)
 *   GET /api/history   first/last event time                                            (replay range)
 * Views: Routes (the drawing), Fences (the register of rules and crossings), Activity (the event table). Needs you and the
 * selected route's details stay in the margin on every view. Read-only: nothing here writes to the monitor.
 * Every string from the API is untrusted: text goes in with textContent / setAttribute only, never innerHTML.
 */
(function () {
  'use strict';
  var R = window.FLRoutes, G = window.AOSGuard;
  var NS = 'http://www.w3.org/2000/svg';
  var S = { view: 'routes', state: null, timeline: null, fences: null, verdicts: null, model: null, sel: null, span: 30, at: null,
    history: null, err: 0, lastOk: 0, evType: '', evQuery: '', focusFence: null, open: {} };
  try { var sp = Number(localStorage.getItem('fl.scale')); if ([15, 30, 60, 180].indexOf(sp) >= 0) S.span = sp; } catch (e) { /* storage blocked */ }

  function $(id) { return document.getElementById(id); }
  function h(tag, cls, text, parent) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; }
  function s(tag, at, parent, text) { var e = document.createElementNS(NS, tag); for (var k in at) if (at[k] != null) e.setAttribute(k, at[k]); if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hm(t, sec) { var d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + (sec ? ':' + pad(d.getSeconds()) : ''); }
  function getJson(url) { return fetch(url, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }); }
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  var measure = document.createElement('canvas').getContext('2d');
  function fit(text, font, w) { measure.font = font; if (measure.measureText(text).width <= w) return text; var t = text; while (t.length > 1 && measure.measureText(t + '…').width > w) t = t.slice(0, -1); return t + '…'; }

  /* ---------- data ---------- */
  function atQ() { return S.at ? '?at=' + encodeURIComponent(new Date(S.at).toISOString()) : ''; }
  function pollState() {
    return getJson('/api/state' + atQ()).then(function (st) { S.state = st; S.err = 0; S.lastOk = Date.now(); rebuild(); })
      .catch(function () { S.err++; paintState(); });
  }
  function pollSlow() {
    return Promise.all([
      getJson('/api/timeline' + atQ()).then(function (t) { S.timeline = t; }).catch(function () {}),
      getJson('/api/fences').then(function (f) { S.fences = f; }).catch(function () {}),
      S.view === 'fences' ? getJson('/api/verdicts').then(function (v) { S.verdicts = v; }).catch(function () {}) : null,
    ]).then(rebuild);
  }
  function fencesAt() {
    if (!S.fences || !S.at) return S.fences;
    return { sessions: (S.fences.sessions || []).map(function (f) { var c = Object.assign({}, f); c.latest = (f.latest || []).filter(function (x) { return Date.parse(x.at) <= S.at; }); if (S.at) c.needs = null; return c; }) };
  }
  function rebuild() {
    if (!S.state) return;
    S.model = R.build(S.state, S.timeline, fencesAt(), { now: S.at || Date.parse(S.state.server_time) || Date.now(), spanMs: S.span * 60e3 });
    var lanes = allLanes();
    if (!S.sel || !lanes.some(function (l) { return l.id === S.sel; })) {
      var n = S.model.notes.filter(function (x) { return x.lane; })[0], run = lanes.filter(function (l) { return l.status === 'running'; })[0];
      S.sel = n ? n.lane : run ? run.id : lanes[0] ? lanes[0].id : null;
    }
    paint();
  }
  function allLanes() { var out = []; (S.model ? S.model.groups : []).forEach(function (g) { out = out.concat(g.lanes); }); return out; }

  /* ---------- header, margin, title block ---------- */
  function paintState() {
    var st = $('state'), label = st.querySelector('span');
    st.className = 'state' + (S.at ? ' replay' : S.err > 1 ? ' off' : '');
    label.textContent = S.at ? 'replay · ' + hm(S.at) : S.err > 1 ? 'monitor not answering' : 'live · read-only';
  }
  function paintHead() {
    var m = S.model.summary, w = clear($('where'));
    if (!m.agents) { w.textContent = 'No sessions yet'; return; }
    var b = function (t) { h('b', null, t, w); }, t = function (x) { w.appendChild(document.createTextNode(x)); };
    b(m.running + ' running'); t(' of ' + m.agents + (m.agents === 1 ? ' agent' : ' agents') + ' in ' + m.projects + (m.projects === 1 ? ' project' : ' projects'));
    if (m.fencesMet) { t(' · '); b(m.fencesMet + (m.fencesMet === 1 ? ' fence met' : ' fences met')); }
    if (m.shared) t(' · ' + m.shared + (m.shared === 1 ? ' file shared' : ' files shared'));
  }
  function paintNotes() {
    var notes = S.model.notes, box = clear($('notes')), c = $('needs-count');
    c.textContent = notes.length; c.className = notes.length ? '' : 'zero';
    document.title = (notes.length ? '(' + notes.length + ') ' : '') + 'Fenceline';
    if (!notes.length) { h('p', 'none', S.at ? 'Nothing was waiting on you at this time.' : 'Nothing is waiting on you.', box); return; }
    notes.forEach(function (n) {
      var b = h('button', 'note ' + n.kind, null, box); b.type = 'button'; b.setAttribute('aria-pressed', String(!!n.lane && n.lane === S.sel));
      h('span', 'n', String(n.n), b); h('span', 'what', n.what, b); h('span', 'who', n.who + ', ' + n.ago, b); h('span', 'detail', n.detail, b);
      b.addEventListener('click', function () {
        if (n.fenceId && S.view === 'fences') { S.focusFence = n.fenceId; paint(); return; }
        if (n.lane) select(n.lane); else if (n.fenceId || n.verdictId) { S.focusFence = n.fenceId || n.verdictId; setView('fences'); }
      });
    });
  }
  function paintSurvey() {
    var box = clear($('survey')), l = allLanes().filter(function (x) { return x.id === S.sel; })[0];
    if (!l) { h('p', 'hint', 'Select a route to see what that agent is doing.', box); return; }
    h('h3', null, l.title, box);
    h('div', 'sub', [l.project, l.short, l.parent ? 'spawned by ' + R.splitId(l.parent).title + ' ' + R.splitId(l.parent).short : l.session ? 'Claude Code session' : ''].filter(Boolean).join(' · '), box);
    var dl = h('dl', null, null, box), row = function (k, v) { if (!v) return; h('dt', null, k, dl); h('dd', null, v, dl); };
    row('Status', l.statusText + (l.status === 'stalled' && l.stuckFor ? ' for ' + Math.round(l.stuckFor / 60) + ' min' : '') + (l.error ? ' (' + l.error + ')' : ''));
    row('Now', l.status === 'done' || l.status === 'idle' ? '' : l.tool);
    row('Model', l.model); row('Tokens', l.tokens ? R.fmtTokens(l.tokens) + ' new' : '');
    row('Started', hm(l.start) + (l.end ? ', ended ' + hm(l.end) : '')); row('Machine', l.machine);
    if (l.fences.length) {
      h('h4', null, 'Fences met', box);
      l.fences.slice().reverse().slice(0, 6).forEach(function (f) { h('p', 'met ' + f.kind, hm(f.at) + '  ' + (f.kind === 'blocked' ? 'blocked: ' : '') + f.op + ' ' + f.file + (f.rule ? ' · ' + f.rule : ''), box); });
    }
    if (l.recent.length) {
      h('h4', null, 'Recent tools', box);
      var tb = h('table', null, null, box);
      l.recent.forEach(function (r) { var tr = h('tr', null, null, tb); h('td', 'w', r.at ? hm(r.at, true) : '', tr); h('td', null, r.name + (r.summary ? ' ' + r.summary : ''), tr); h('td', 'r', r.ms == null ? '' : r.ms < 1000 ? r.ms + 'ms' : (r.ms / 1000).toFixed(1) + 's', tr); });
    }
  }
  function paintFoot() {
    var name = { routes: 'Routes', fences: 'Fences', activity: 'Activity' }[S.view];
    $('tb-sheet').textContent = name + (S.at ? ' · replay' : ' · live');
    $('tb-drawn').textContent = hm(S.model.t1) + (S.at ? '' : ' local');
    $('tb-tokens').textContent = R.fmtTokens(S.model.summary.tokens) + ' new';
  }

  /* ---------- routes view ---------- */
  var LABEL = 262, RIGHT = 46, LANE = 40, PROJ = 34, TOP = 34;
  /* narrow screens: a slimmer label column so the routes still fit across */
  function layoutFor(w) { LABEL = w < 640 ? 150 : 262; RIGHT = w < 640 ? 34 : 46; }
  function drawRoutes(host) {
    var groups = S.model.groups;
    if (!groups.length) {
      var e = h('div', 'empty', null, host);
      e.appendChild(document.createTextNode(S.at ? 'No sessions were running at this time.' : 'No sessions on this sheet yet. Start Claude Code in any project with the Fenceline plugin installed and its route is drawn here. '));
      return;
    }
    var W = Math.max(340, host.clientWidth || 1000), t0 = S.model.t0, t1 = S.model.t1; layoutFor(W);
    var x = function (t) { return LABEL + (W - LABEL - RIGHT) * R.xOf(t, t0, t1); };
    var rows = [], y = TOP;
    groups.forEach(function (g) {
      rows.push({ g: g, y: y }); y += PROJ;
      // subagents that finished before this window fold into one row per project, unless opened
      var early = g.lanes.filter(function (l) { return !l.session && l.end != null && l.end < t0 && l.id !== S.sel; }), open = S.open[g.name];
      g.lanes.forEach(function (l) { if (open || early.indexOf(l) < 0) { rows.push({ l: l, y: y }); y += LANE; } });
      if (early.length) { rows.push({ fold: g.name, n: early.length, last: Math.max.apply(null, early.map(function (l) { return l.last; })), open: !!open, y: y }); y += 30; }
      y += 8;
    });
    var H = y + 6, svg = s('svg', { 'class': 'lanes', viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'group', 'aria-label': 'Agent routes, ' + R.scaleTicks(S.span * 60e3).slice(-1)[0].label.replace('−', '') + ' to now' }, host);
    var C = { ink: cssVar('--ink'), ink2: cssVar('--ink2'), ink3: cssVar('--ink3'), rule: cssVar('--rule'), cont: cssVar('--contour'), soft: cssVar('--contour-soft'), bad: cssVar('--bad'), warn: cssVar('--warn'), paper: cssVar('--paper') };
    var narrow = W < 640;
    R.scaleTicks(S.span * 60e3).forEach(function (k, i, all) {
      if (narrow && k.minutes && i % 2 && i !== all.length - 1) return; // every other label when narrow
      var X = x(t1 - k.minutes * 60e3);
      s('line', { x1: X, x2: X, y1: TOP - 8, y2: H, stroke: C.rule, 'stroke-width': 1, 'stroke-dasharray': k.minutes ? '1 4' : null }, svg);
      s('text', { x: X, y: TOP - 14, 'text-anchor': k.minutes ? 'middle' : 'end', 'class': k.minutes ? 't-axis' : 't-now' }, svg, S.at && !k.minutes ? hm(t1) : k.label);
    });
    var yOf = {}; rows.forEach(function (r) { if (r.l) yOf[r.l.id] = r.y + LANE / 2; });
    rows.forEach(function (r) {
      if (r.g) { s('rect', { x: 0, y: r.y + 4, width: W, height: PROJ - 8, fill: C.soft }, svg); s('text', { x: 14, y: r.y + PROJ / 2 + 5, 'class': 't-proj' }, svg, r.g.name); return; }
      if (r.fold) {
        var fg = s('g', { 'class': 'lane fold', tabindex: 0, role: 'button', 'aria-expanded': String(r.open) }, svg), toggle = function () { S.open[r.fold] = !S.open[r.fold]; paint(); };
        fg.addEventListener('click', toggle); fg.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { toggle(); e.preventDefault(); } });
        s('rect', { 'class': 'hit', x: 0, y: r.y, width: '100%', height: 26, fill: 'transparent' }, fg);
        s('text', { x: 30, y: r.y + 17, 'class': 't-fold' }, fg, r.open ? 'Hide the ' + r.n + ' earlier ' + (r.n === 1 ? 'agent' : 'agents') : '+ ' + r.n + ' earlier ' + (r.n === 1 ? 'agent' : 'agents') + (W < 640 ? '' : ', finished before this sheet · last ' + R.ago(r.last, t1)));
        return;
      }
      drawLane(svg, r.l, r.y, x, yOf, C, t0, t1);
    });
    S.model.ties.forEach(function (t) {
      if (yOf[t.a] == null || yOf[t.b] == null) return;
      var X = x(t.at), ya = yOf[t.a], yb = yOf[t.b];
      s('line', { x1: X, x2: X, y1: ya, y2: yb, stroke: C.warn, 'stroke-width': 1.3, 'stroke-dasharray': '3 3' }, svg);
      s('circle', { cx: X, cy: ya, r: 2.6, fill: C.warn }, svg); s('circle', { cx: X, cy: yb, r: 2.6, fill: C.warn }, svg);
      var tw = (measure.font = '11px "DM Mono"', measure.measureText(t.file).width), left = X + 6 + tw > W - 2;
      s('text', { x: left ? X - 6 : X + 6, y: (ya + yb) / 2 + 4, 'text-anchor': left ? 'end' : 'start', 'class': 't-tie' }, svg, t.file);
    });
  }
  function drawLane(svg, l, top, x, yOf, C, t0, t1) {
    var cy = top + LANE / 2, g = s('g', { 'class': 'lane' + (l.id === S.sel ? ' sel' : ''), tabindex: 0, role: 'button', 'data-id': l.id,
      'aria-label': l.title + ', ' + l.statusText + (l.fences.length ? ', ' + l.fences.length + ' fences met' : ''), 'aria-pressed': String(l.id === S.sel) }, svg);
    g.addEventListener('click', function () { select(l.id); });
    g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { select(l.id); e.preventDefault(); } });
    s('rect', { 'class': 'hit', x: 0, y: top, width: '100%', height: LANE, fill: 'transparent' }, g);
    var ind = l.depth ? 30 : 14;
    s('text', { x: ind, y: cy + 1, 'class': 't-agent' }, g, fit(l.title, '500 14px "Barlow Semi Condensed"', LABEL - ind - 10));
    s('text', { x: ind, y: cy + 15, 'class': 't-id' }, g, [l.short, l.model].filter(Boolean).join(' · '));
    var live = l.status === 'running' || l.status === 'ask', w = live ? 2.6 : l.status === 'idle' || l.status === 'done' ? 1.2 : 1.8;
    var col = l.status === 'errored' ? C.bad : live ? C.ink : C.ink2;
    var start = Math.max(l.start, t0), end = l.end != null ? l.end : t1;
    if (end < t0) { // ended before this sheet's window: say when, at the left edge
      s('circle', { cx: x(t0) + 4, cy: cy, r: 3.2, fill: C.paper, stroke: C.ink3, 'stroke-width': 1.2 }, g);
      s('text', { x: x(t0) + 13, y: cy + 4, 'class': 't-id' }, g, 'last active ' + R.ago(l.last, t1));
      return;
    }
    var x0 = x(start), xe = x(end);
    if (l.parent && yOf[l.parent] != null && l.start >= t0) s('path', { d: 'M' + x0 + ' ' + yOf[l.parent] + 'V' + cy, stroke: C.ink3, 'stroke-width': 1, fill: 'none' }, g);
    if (l.status === 'stalled') {
      var xl = x(Math.max(t0, l.last));
      s('line', { x1: x0, x2: xl, y1: cy, y2: cy, stroke: C.ink2, 'stroke-width': 1.8 }, g);
      s('line', { x1: xl, x2: x(t1), y1: cy, y2: cy, stroke: C.warn, 'stroke-width': 1.8, 'stroke-dasharray': '2 5', 'stroke-linecap': 'round' }, g);
    } else s('line', { x1: x0, x2: xe, y1: cy, y2: cy, stroke: col, 'stroke-width': w }, g);
    var lastX = -9;
    l.ticks.forEach(function (t) { if (t < t0) return; var X = Math.round(x(t)); if (X - lastX < 3) return; lastX = X; s('line', { x1: X, x2: X, y1: cy - 4, y2: cy + 4, stroke: col, 'stroke-width': 1 }, g); });
    if (l.status === 'errored') s('path', { d: 'M' + (xe - 5) + ' ' + (cy - 5) + 'L' + (xe + 5) + ' ' + (cy + 5) + 'M' + (xe + 5) + ' ' + (cy - 5) + 'L' + (xe - 5) + ' ' + (cy + 5), stroke: C.bad, 'stroke-width': 2 }, g);
    else if (l.status === 'done') s('path', { d: 'M' + xe + ' ' + (cy - 6) + 'V' + (cy + 6) + 'M' + (xe + 4) + ' ' + (cy - 6) + 'V' + (cy + 6), stroke: C.ink2, 'stroke-width': 1.4 }, g);
    else if (l.status === 'idle') s('circle', { cx: xe, cy: cy, r: 3.5, fill: C.paper, stroke: C.ink2, 'stroke-width': 1.3 }, g);
    else if (live) s('circle', { cx: xe, cy: cy, r: 4.5, fill: C.ink }, g);
    l.fences.forEach(function (f) {
      if (f.at < t0) return; var X = x(f.at);
      if (f.kind === 'blocked') s('rect', { x: X - 2.5, y: cy - 11, width: 5, height: 22, fill: C.bad }, g);
      else s('line', { x1: X, x2: X, y1: cy - 11, y2: cy + 11, stroke: C.warn, 'stroke-width': 3, 'stroke-dasharray': '3.5 2.5' }, g);
    });
    l.marks.forEach(function (m) {
      var X = x(Math.max(t0, m.at)), c = m.kind === 'blocked' || m.kind === 'integrity' ? C.bad : m.kind === 'unmentioned' ? C.warn : C.cont;
      if (m.kind === 'ask') { s('circle', { cx: X, cy: cy, r: 8, fill: 'none', stroke: c, 'stroke-width': 1.6 }, g); s('circle', { 'class': 'ping', cx: X, cy: cy, r: 6, fill: 'none', stroke: c, 'stroke-width': 1.5 }, g); }
      var bx = Math.min(X + 13, x(t1) + 30);
      s('circle', { cx: bx, cy: cy - 12, r: 8, fill: C.paper, stroke: c, 'stroke-width': 1.4 }, g);
      s('text', { x: bx, y: cy - 8.5, 'text-anchor': 'middle', 'class': 't-num', fill: c }, g, String(m.n));
    });
  }

  /* ---------- fences view ---------- */
  function drawFences(host) {
    var reg = h('div', 'register', null, host);
    h('h2', null, 'Fences', reg);
    h('p', 'lede', 'The rules each session works inside, and every time an agent met one: blocked before it happened, or warned and kept. Below them, the guard\'s verdicts on finished work.', reg);
    var list = (fencesAt() || {}).sessions || [];
    h('h3', null, 'Sessions with fences', reg);
    if (!list.length) h('p', 'lede', 'No session has fences yet. Add one in Claude Code with /fenceline:fence.', reg);
    list.forEach(function (f) {
      var m = G.fenceRowModel(f), p = h('section', 'parcel' + (S.focusFence === m.id ? ' focus' : ''), null, reg); p.id = 'parcel-' + m.id;
      var t = h('div', 'ttl', null, p); h('b', null, m.repo, t);
      h('span', 'tag ' + (m.state === 'stopped' ? 'bad' : m.state === 'crossed' ? 'warn' : 'ok'), m.state === 'stopped' ? 'stopped' : m.state === 'crossed' ? 'crossed' : 'clean', t);
      h('span', null, m.meta, t);
      var ru = h('ul', 'rules', null, p); m.fences.forEach(function (x) { var li = h('li', null, null, ru); h('b', null, x.mode === 'block' ? 'Block' : 'Warn', li); li.appendChild(document.createTextNode(x.text)); });
      if (m.crossings.length) { var cu = h('ul', 'cross', null, p); m.crossings.forEach(function (c) { h('li', c.bad ? 'warn' : 'bad', c.when + '  ' + c.text + (c.fence ? ' · ' + c.fence : ''), cu); }); }
    });
    var vs = (S.verdicts && S.verdicts.verdicts) || [];
    h('h3', null, 'Guard verdicts', reg);
    if (!vs.length) h('p', 'lede', 'No verdicts. The guard re-runs a session\'s original tests in a sandbox when you ask it to verify finished work.', reg);
    vs.forEach(function (v) {
      var m = G.rowModel(v), p = h('section', 'parcel' + (S.focusFence === m.id ? ' focus' : ''), null, reg);
      var t = h('div', 'ttl', null, p); h('b', null, m.repo, t); h('span', 'tag ' + (m.state === 'verified' ? 'ok' : 'bad'), m.label, t).title = m.title; h('span', null, m.meta, t);
      var u = h('ul', 'cross', null, p);
      m.reasons.forEach(function (r) { h('li', 'bad', r.kind + (r.detail ? ': ' + r.detail : ''), u); });
      m.failing.forEach(function (x) { h('li', 'bad', 'failing: ' + x, u); });
      m.warnings.forEach(function (x) { h('li', 'warn', x, u); });
    });
    if (S.focusFence && S.scrolledTo !== S.focusFence) { var el = document.getElementById('parcel-' + S.focusFence); if (el && el.scrollIntoView) { el.scrollIntoView({ block: 'nearest' }); S.scrolledTo = S.focusFence; } }
  }

  /* ---------- activity view ---------- */
  /* one event -> a plain sentence; unknown shapes fall back to key: value pairs */
  function nm(id) { var p = R.splitId(id); return p.title + (p.short ? ' ' + p.short : ''); }
  function describe(e) {
    var d = e && e.data && typeof e.data === 'object' ? e.data : {};
    switch (e.type) {
      case 'agent.spawned': return d.parent ? 'started ' + nm(d.agent) + (d.role ? ' (' + d.role + ')' : '') : 'session started' + (d.cwd ? ' in ' + d.cwd : '');
      case 'task.started': return 'began work' + (d.title && d.title !== 'general-purpose' ? ': ' + d.title : '');
      case 'task.completed': return 'finished';
      case 'task.failed': return 'stopped with an error';
      case 'human.note': return (d.text || 'note') + (d.session ? ' to ' + nm(d.session) : '');
      case 'alert': return d.text || d.kind || 'alert';
      default: return Object.keys(d).slice(0, 6).map(function (k) { var v = d[k]; return k + ': ' + (v && typeof v === 'object' ? JSON.stringify(v) : String(v)); }).join(' · ');
    }
  }
  function drawActivity(host) {
    var reg = h('div', 'register', null, host), evs = ((S.state && S.state.events) || []).slice().reverse();
    h('h2', null, 'Activity', reg);
    h('p', 'lede', 'What the monitor has seen, newest first. Prompts and file contents are never recorded.', reg);
    var types = {}; evs.forEach(function (e) { if (e && e.type) types[e.type] = 1; });
    var f = h('div', 'filters', null, reg), sel = h('select', null, null, f); sel.id = 'ev-type'; sel.setAttribute('aria-label', 'Event type');
    h('option', null, 'All types', sel).value = '';
    Object.keys(types).sort().forEach(function (t) { var o = h('option', null, t, sel); o.value = t; if (t === S.evType) o.selected = true; });
    var q = h('input', null, null, f); q.id = 'ev-q'; q.type = 'search'; q.placeholder = 'Search agents, files, tools'; q.value = S.evQuery; q.setAttribute('aria-label', 'Search events');
    var cnt = h('span', 'count', null, f), wrap = h('div', 'events-wrap', null, reg), tb = h('table', 'events', null, wrap), hr = h('tr', null, null, h('thead', null, null, tb));
    ['Time', 'Type', 'Agent', 'Detail'].forEach(function (x) { h('th', null, x, hr); });
    var body = h('tbody', null, null, tb);
    function fill() {
      clear(body); var qq = S.evQuery.toLowerCase(), shown = 0;
      evs.forEach(function (e) {
        if (!e || (S.evType && e.type !== S.evType)) return;
        var d = describe(e), who = e.actor === 'human' ? 'you' : R.splitId(e.actor || '').title;
        if (qq && (who + ' ' + e.type + ' ' + d + ' ' + (e.actor || '')).toLowerCase().indexOf(qq) < 0) return;
        if (++shown > 400) return;
        var tr = h('tr', null, null, body), t = Date.parse(e.ts);
        h('td', 'w', isFinite(t) ? hm(t, true) : '', tr); h('td', 'k' + (/alert|error|stuck/.test(e.type) ? ' alert' : ''), e.type, tr); h('td', null, who, tr);
        h('td', 'p', d.length > 240 ? d.slice(0, 239) + '…' : d, tr);
      });
      cnt.textContent = Math.min(shown, 400) + ' of ' + evs.length + ' events';
    }
    sel.addEventListener('change', function () { S.evType = sel.value; fill(); });
    q.addEventListener('input', function () { S.evQuery = q.value; fill(); });
    fill();
  }

  /* ---------- key ---------- */
  function paintKey() {
    var k = clear($('key'));
    function item(label, draw) { var sp = h('span', null, null, k), svg = s('svg', { width: 34, height: 16, viewBox: '0 0 34 16', 'aria-hidden': 'true' }, sp); draw(svg); sp.appendChild(document.createTextNode(label)); }
    var ink = 'var(--ink)', ink2 = 'var(--ink2)';
    item('Running', function (g) { s('line', { x1: 2, x2: 30, y1: 8, y2: 8, stroke: ink, 'stroke-width': 2.6 }, g); s('circle', { cx: 30, cy: 8, r: 4, fill: ink }, g); });
    item('Idle', function (g) { s('line', { x1: 2, x2: 27, y1: 8, y2: 8, stroke: ink2, 'stroke-width': 1.2 }, g); s('circle', { cx: 29, cy: 8, r: 3.2, fill: 'var(--paper)', stroke: ink2, 'stroke-width': 1.3 }, g); });
    item('No activity', function (g) { s('line', { x1: 2, x2: 32, y1: 8, y2: 8, stroke: 'var(--warn)', 'stroke-width': 1.8, 'stroke-dasharray': '2 5', 'stroke-linecap': 'round' }, g); });
    item('Error', function (g) { s('line', { x1: 2, x2: 26, y1: 8, y2: 8, stroke: 'var(--bad)', 'stroke-width': 1.8 }, g); s('path', { d: 'M22 3L32 13M32 3L22 13', stroke: 'var(--bad)', 'stroke-width': 2 }, g); });
    item('Finished', function (g) { s('line', { x1: 2, x2: 26, y1: 8, y2: 8, stroke: ink2, 'stroke-width': 1.2 }, g); s('path', { d: 'M26 2V14M30 2V14', stroke: ink2, 'stroke-width': 1.4 }, g); });
    item('Fence, blocked', function (g) { s('line', { x1: 2, x2: 32, y1: 8, y2: 8, stroke: ink, 'stroke-width': 1.6 }, g); s('rect', { x: 14.5, y: 0, width: 5, height: 16, fill: 'var(--bad)' }, g); });
    item('Fence, warned', function (g) { s('line', { x1: 2, x2: 32, y1: 8, y2: 8, stroke: ink, 'stroke-width': 1.6 }, g); s('line', { x1: 17, x2: 17, y1: 0, y2: 16, stroke: 'var(--warn)', 'stroke-width': 3, 'stroke-dasharray': '3.5 2.5' }, g); });
    item('Same file', function (g) { s('line', { x1: 17, x2: 17, y1: 1, y2: 15, stroke: 'var(--warn)', 'stroke-width': 1.3, 'stroke-dasharray': '3 3' }, g); });
    item('Waiting for you', function (g) { s('circle', { cx: 17, cy: 8, r: 6, fill: 'none', stroke: 'var(--contour)', 'stroke-width': 1.5 }, g); });
  }

  /* ---------- paint ---------- */
  function paint() {
    if (!S.model) return;
    var host = $('drawing'), focused = document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-id');
    var keepInput = S.view === 'activity' && document.activeElement && (document.activeElement.id === 'ev-q' || document.activeElement.id === 'ev-type');
    paintState(); paintHead(); paintNotes(); paintSurvey(); paintFoot();
    if (keepInput) return; // do not rebuild the table under the cursor while someone types
    var sx = host.scrollLeft; clear(host);
    if (S.view === 'routes') drawRoutes(host); else if (S.view === 'fences') drawFences(host); else drawActivity(host);
    host.scrollLeft = sx;
    if (focused) { var f = host.querySelector('[data-id="' + (window.CSS && CSS.escape ? CSS.escape(focused) : focused) + '"]'); if (f) f.focus(); }
    $('key').hidden = S.view !== 'routes';
  }
  function select(id) { S.sel = id; if (S.view !== 'routes') setView('routes'); else paint(); }
  function setView(v) {
    S.view = v; document.querySelectorAll('.views [data-view]').forEach(function (b) { if (b.getAttribute('data-view') === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    try { history.replaceState(null, '', v === 'routes' ? location.pathname : '#' + v); } catch (e) { /* ignore */ }
    if (v === 'fences') pollSlow(); else paint();
  }

  /* ---------- controls ---------- */
  document.querySelectorAll('.views [data-view]').forEach(function (b) { b.addEventListener('click', function () { setView(b.getAttribute('data-view')); }); });
  $('maplink').href = location.protocol + '//' + location.hostname + ':4319/';
  $('tb-scale').value = String(S.span);
  $('tb-scale').addEventListener('change', function () { S.span = Number($('tb-scale').value) || 30; try { localStorage.setItem('fl.scale', String(S.span)); } catch (e) { /* ignore */ } rebuild(); });
  var THEMES = ['auto', 'light', 'dark'];
  function theme() { var t = document.documentElement.getAttribute('data-theme') || 'auto'; $('theme-btn').textContent = 'Theme: ' + t; return t; }
  function cycleTheme() {
    var t = THEMES[(THEMES.indexOf(theme()) + 1) % 3];
    if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
    try { if (t === 'auto') localStorage.removeItem('aos.theme'); else localStorage.setItem('aos.theme', t); } catch (e) { /* ignore */ }
    theme(); paint();
  }
  $('theme-btn').addEventListener('click', cycleTheme); theme();
  if (window.matchMedia) { var mq = matchMedia('(prefers-color-scheme: dark)'); if (mq.addEventListener) mq.addEventListener('change', paint); }

  /* replay: the range maps 0..1000 onto first event .. now */
  function replayRange() { var first = S.history && Date.parse(S.history.first_ts); return { a: isFinite(first) ? first : Date.now() - 3 * 3600e3, b: Date.now() }; }
  function openReplay(on) {
    $('replaybar').hidden = !on; $('replay-btn').setAttribute('aria-pressed', String(on));
    if (on) getJson('/api/history?limit=1').then(function (hh) { S.history = hh; }).catch(function () {});
    else goLive();
  }
  function goLive() { S.at = null; $('replay-range').value = 1000; $('replay-t').textContent = 'now'; pollState(); pollSlow(); }
  var rt = 0;
  $('replay-range').addEventListener('input', function () {
    var r = replayRange(), v = Number($('replay-range').value);
    if (v >= 1000) { goLive(); return; }
    S.at = Math.round(r.a + (r.b - r.a) * v / 1000); $('replay-t').textContent = hm(S.at, true); paintState();
    clearTimeout(rt); rt = setTimeout(function () { pollState(); pollSlow(); }, 150);
  });
  $('replay-btn').addEventListener('click', function () { openReplay($('replaybar').hidden); });
  $('replay-live').addEventListener('click', function () { openReplay(false); });

  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey || (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName))) return;
    var lanes = allLanes(), i = lanes.map(function (l) { return l.id; }).indexOf(S.sel);
    if (e.key === 'j' || e.key === 'k') { var n = lanes[e.key === 'j' ? Math.min(lanes.length - 1, i + 1) : Math.max(0, i - 1)]; if (n) { select(n.id); var f = document.querySelector('[data-id="' + (window.CSS && CSS.escape ? CSS.escape(n.id) : n.id) + '"]'); if (f) f.focus(); } e.preventDefault(); }
    else if (e.key === '1') setView('routes'); else if (e.key === '2') setView('fences'); else if (e.key === '3') setView('activity');
    else if (e.key === 't' || e.key === 'T') cycleTheme();
    else if (e.key === 'Escape' && !$('replaybar').hidden) openReplay(false);
  });
  var rz = 0; window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(paint, 100); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(paint);

  paintKey();
  var hash = (location.hash || '').slice(1); if (hash === 'fences' || hash === 'activity') S.view = hash;
  setView(S.view);
  pollState(); pollSlow();
  setInterval(function () { if (!S.at) pollState(); }, 2000);
  setInterval(function () { if (!S.at) pollSlow(); }, 5000);
  window.FLSheet = { select: select, setView: setView, getState: function () { return S.state; }, getModel: function () { return S.model; } };
})();
