/* Fenceline scope map: renders window.SCOPE (built by src/scope.mjs) into two side-by-side panels and a shared timeline.
 * Every string from the data is untrusted: text goes in with textContent / setAttribute only, never innerHTML. */
(function () {
  'use strict';
  var D = window.SCOPE, NS = 'http://www.w3.org/2000/svg';
  if (!D || !D.runs || !D.runs.length) { document.getElementById('panels').textContent = 'No runs in this file.'; return; }
  function $(id) { return document.getElementById(id); }
  function h(tag, cls, text, parent) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; }
  function s(tag, at, parent, text) { var e = document.createElementNS(NS, tag); for (var k in at) if (at[k] != null) e.setAttribute(k, at[k]); if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; }
  function clock(ms) { var x = Math.max(0, Math.round(ms / 1000)); return Math.floor(x / 60) + ':' + (x % 60 < 10 ? '0' : '') + (x % 60); }
  var OPS = { read: 'read', search: 'search', edit: 'edit', create: 'create', delete: 'delete' };
  var VERB = { allowed: 'allowed', blocked: 'blocked', crossed: 'crossed' };

  /* state: two panels, each showing a run; one shared clock */
  var cols = D.runs.length > 1 ? 2 : 1;
  var P = []; var T = 0, playing = false, raf = 0, last = 0;
  var pair = D.pair && D.pair.length ? D.pair : [0];

  /* header */
  $('task').textContent = D.runs[pair[0]].task ? 'Task: ' + D.runs[pair[0]].task : (D.runs.length + (D.runs.length === 1 ? ' run' : ' runs'));
  (function key() {
    var k = $('key');
    function item(label, draw) { var sp = h('span', null, null, k), g = s('svg', { width: 22, height: 14, viewBox: '0 0 22 14', 'aria-hidden': 'true' }, sp); draw(g); sp.appendChild(document.createTextNode(label)); }
    item('Allowed', function (g) { s('circle', { cx: 11, cy: 7, r: 5, fill: 'var(--ok)' }, g); });
    item('Blocked', function (g) { s('circle', { cx: 11, cy: 7, r: 5, fill: 'var(--bad)' }, g); });
    item('Crossed (warn)', function (g) { s('circle', { cx: 11, cy: 7, r: 5, fill: 'var(--warn)' }, g); });
    item('In scope, untouched', function (g) { s('rect', { x: 3, y: 2, width: 16, height: 10, fill: 'var(--scope)' }, g); });
    item('Allowed area', function (g) { s('rect', { x: 2, y: 2, width: 18, height: 10, fill: 'none', stroke: 'var(--ok)', 'stroke-width': 1.6, 'stroke-dasharray': '4 3' }, g); });
    item('Off-limits', function (g) { s('rect', { x: 2, y: 2, width: 18, height: 10, fill: 'rgba(240,98,90,.18)', stroke: 'var(--bad)', 'stroke-width': 1.6, 'stroke-dasharray': '4 3' }, g); });
  })();

  /* panels */
  var host = $('panels'); host.style.setProperty('--cols', cols);
  for (var i = 0; i < cols; i++) P.push(makePanel(host, pair[i] != null ? pair[i] : 0));
  function maxT() { var m = 0; P.forEach(function (p) { var st = D.runs[p.run].steps; if (st.length) m = Math.max(m, st[st.length - 1].ms); }); return m; }
  var scrub = $('scrub');
  function resetClock() { var m = maxT(); scrub.max = String(Math.max(1, m)); T = m; scrub.value = String(T); paint(); }

  function makePanel(parent, runIdx) {
    var p = { run: runIdx, el: h('section', 'panel', null, parent) };
    var bar = h('div', 'bar', null, p.el);
    p.sel = h('select', null, null, bar); p.sel.setAttribute('aria-label', 'Run');
    var groups = {};
    D.runs.forEach(function (r, i) {
      var g = r.mode + ' · ' + r.model; if (!groups[g]) { groups[g] = h('optgroup', null, null, p.sel); groups[g].label = r.repo + ' · ' + g; }
      var o = h('option', null, r.label + ' · ' + r.summary.outcome_text, groups[g]); o.value = String(i); if (i === runIdx) o.selected = true;
    });
    p.chip = h('span', 'outcome', null, bar);
    p.stats = h('div', 'stats', null, p.el);
    p.svg = s('svg', { 'class': 'map', role: 'img' }, p.el);
    p.now = h('p', 'now', null, p.el);
    p.out = h('p', 'out', null, p.el);
    var lower = h('div', 'lower', null, p.el);
    p.list = h('ol', 'steps', null, lower);
    var det = h('details', 'msg', null, lower); det.open = true; h('summary', null, 'Final message', det); p.msg = h('p', null, null, det);
    p.sel.addEventListener('change', function () { p.run = Number(p.sel.value); setup(p); resetClock(); });
    setup(p);
    return p;
  }

  /* static layers for a panel's run: districts, buildings, fence regions; then the list */
  function setup(p) {
    var r = D.runs[p.run], L = D.layouts[r.layout];
    p.svg.setAttribute('viewBox', '0 0 ' + L.width + ' ' + L.height);
    p.svg.setAttribute('aria-label', 'Scope map of ' + r.label);
    while (p.svg.firstChild) p.svg.removeChild(p.svg.firstChild);
    var defs = s('defs', {}, p.svg), pat = s('pattern', { id: 'hatch', width: 7, height: 7, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
    s('rect', { width: 7, height: 7, fill: 'rgba(240,98,90,.06)' }, pat); s('line', { x1: 0, y1: 0, x2: 0, y2: 7, stroke: 'rgba(240,98,90,.32)', 'stroke-width': 1.4 }, pat);
    var scope = {}; r.in_scope.forEach(function (x) { scope[x] = 1; });
    p.at = {}; p.bEl = {};
    var gB = s('g', {}, p.svg), gD = s('g', {}, p.svg), gZ = s('g', {}, p.svg);
    L.buildings.forEach(function (b) {
      var inS = (b.members || [b.path]).some(function (m) { return scope[m]; });
      var el = s('rect', { x: b.x + 0.5, y: b.y + 0.5, width: Math.max(0, b.w - 1), height: Math.max(0, b.h - 1), 'class': inS ? 'b-scope' : 'b-out' }, gB);
      s('title', {}, el, b.path);
      p.bEl[b.path] = { el: el, base: inS ? 'b-scope' : 'b-out' };
      (b.members || [b.path]).forEach(function (m) { p.at[m] = b; });
      if (b.w > 64 && b.h > 22) s('text', { x: b.x + 4, y: b.y + b.h - 5, 'class': 'b-name' }, gB, fit(b.name, b.w - 8, 5.7));
    });
    L.districts.forEach(function (d) {
      if (d.depth === 0) return;
      s('rect', { x: d.x + 0.5, y: d.y + 0.5, width: Math.max(0, d.w - 1), height: Math.max(0, d.h - 1), 'class': 'd-box' }, gD);
      if (d.label) s('text', { x: d.x + 6, y: d.y + 15, 'class': 'd-lab' }, gD, fit(d.name, d.w - 12, 7));
    });
    r.regions.forEach(function (z) {
      if (!z.rects.length) return;
      z.rects.forEach(function (q) { s('rect', { x: q.x, y: q.y, width: Math.max(0, q.w), height: Math.max(0, q.h), 'class': z.kind === 'deny' ? 'z-deny' : 'z-only' }, gZ); });
      // the label sits inside the region's largest rectangle, bottom right, clear of the folder name at its top
      var r0 = z.rects.slice().sort(function (a, b) { return b.w * b.h - a.w * a.h; })[0];
      var txt = (z.kind === 'only' ? 'scope: ' : '') + z.text + (z.mode === 'block' ? ' (blocks)' : ' (warns)');
      var w = Math.min(L.width - 8, txt.length * 6.7 + 16), tx = Math.max(4, Math.min(r0.x + r0.w - w - 4, L.width - w - 4)), ty = Math.min(L.height - 22, r0.y + r0.h - 21);
      var tag = s('g', { 'class': 'z-tag ' + z.kind, transform: 'translate(' + tx + ',' + ty + ')' }, gZ);
      s('rect', { width: w, height: 17 }, tag); s('text', { x: 6, y: 12.5 }, tag, fit(txt, w - 10, 6.7));
    });
    p.gE = s('g', {}, p.svg); p.gN = s('g', {}, p.svg); p.gNow = s('g', {}, p.svg);
    /* static bits: outcome, final message, out-of-scope list, step list */
    p.chip.className = 'outcome ' + r.summary.outcome; p.chip.textContent = r.summary.outcome_text;
    p.msg.textContent = plain(r.final_message) || '(no final message recorded)';
    while (p.out.firstChild) p.out.removeChild(p.out.firstChild);
    if (r.summary.out_of_scope.length) { p.out.appendChild(document.createTextNode('Outside scope, written or tried: ')); r.summary.out_of_scope.forEach(function (f, i) { if (i) p.out.appendChild(document.createTextNode(', ')); h('b', null, f, p.out); }); }
    else p.out.textContent = 'Nothing written or tried outside scope.';
    while (p.list.firstChild) p.list.removeChild(p.list.firstChild);
    p.li = r.steps.map(function (st) {
      var li = h('li', st.verdict, null, p.list);
      h('span', null, String(st.n), li); h('span', null, clock(st.ms), li); h('span', null, OPS[st.op] || st.op, li);
      var f = h('span', 'f', (st.dir ? st.file + '/' : st.file) + (st.verdict !== 'allowed' ? '  · ' + VERB[st.verdict] : ''), li); f.title = st.tool + ' · ' + st.file + (st.fence ? ' · ' + st.fence : '');
      li.addEventListener('click', function () { stop(); T = st.ms; scrub.value = String(T); paint(st.n, p); });
      return li;
    });
  }
  /* what a step did, without repeating the tool's own verb ("Edit edit") */
  function doing(st) { return st.tool === 'Bash' || st.tool === 'Grep' || st.tool === 'Glob' ? st.tool + ' ' + (OPS[st.op] || st.op) : st.tool; }
  /* the final message is markdown: show it as plain text */
  function plain(m) { return String(m || '').replace(/```[a-z]*\n?/gi, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/^#+\s*/gm, ''); }
  function fit(t, w, cw) { t = String(t); var n = Math.max(1, Math.floor(w / cw)); return t.length > n ? t.slice(0, Math.max(1, n - 1)) + '…' : t; }

  /* dynamic layers at time T: nodes sized by hits, edges thick by repeats, the newest step pinged and named */
  function paint(focusN, focusP) {
    $('clock').textContent = clock(T);
    P.forEach(function (p) { draw(p, focusP === p ? focusN : null); });
  }
  function draw(p, focusN) {
    var r = D.runs[p.run], nodes = {}, order = [], edges = {}, prev = null, lastStep = null, rank = { allowed: 0, crossed: 1, blocked: 2 };
    var tot = { attempts: 0, blocked: 0, crossed: 0, out: {} }, scope = {}; r.in_scope.forEach(function (x) { scope[x] = 1; });
    r.steps.forEach(function (st) {
      var seen = st.ms <= T && (focusN == null || st.n <= focusN);
      p.li[st.n - 1].className = st.verdict + (seen ? ' seen' : '');
      if (!seen) return; lastStep = st;
      if (st.dir) return;
      tot.attempts++; if (st.verdict === 'blocked') tot.blocked++; if (st.verdict === 'crossed') tot.crossed++;
      if ((st.op !== 'read' && st.op !== 'search' || st.verdict !== 'allowed') && !scope[st.file]) tot.out[st.file] = 1;
      var b = p.at[st.file]; if (!b) return;
      var nd = nodes[b.path]; if (!nd) { nd = nodes[b.path] = { b: b, hits: 0, v: 'allowed' }; order.push(nd); }
      nd.hits++; if (rank[st.verdict] > rank[nd.v]) nd.v = st.verdict;
      if (prev && prev !== b.path) { var k = prev + '\n' + b.path; edges[k] = edges[k] || { a: prev, b: b.path, n: 0 }; edges[k].n++; }
      prev = b.path;
    });
    if (lastStep && p.li[lastStep.n - 1]) { p.li[lastStep.n - 1].className += ' now'; var li = p.li[lastStep.n - 1], box = p.list; if (li.offsetTop < box.scrollTop || li.offsetTop > box.scrollTop + box.clientHeight - 24) box.scrollTop = li.offsetTop - box.clientHeight / 2; }
    /* buildings tinted by what happened there */
    for (var path in p.bEl) { var be = p.bEl[path]; be.el.setAttribute('class', nodes[path] ? 'b-' + nodes[path].v : be.base); }
    /* edges */
    while (p.gE.firstChild) p.gE.removeChild(p.gE.firstChild);
    Object.keys(edges).forEach(function (k) {
      var e = edges[k], a = nodes[e.a].b, c = nodes[e.b].b;
      s('line', { x1: a.x + a.w / 2, y1: a.y + a.h / 2, x2: c.x + c.w / 2, y2: c.y + c.h / 2, 'class': 'edge', 'stroke-width': Math.min(7, 1 + e.n * 1.2) }, p.gE);
    });
    /* nodes */
    while (p.gN.firstChild) p.gN.removeChild(p.gN.firstChild);
    order.forEach(function (nd) {
      var b = nd.b, c = s('circle', { cx: b.x + b.w / 2, cy: b.y + b.h / 2, r: Math.min(16, 4 + 2.6 * Math.sqrt(nd.hits)), 'class': 'node ' + nd.v }, p.gN);
      s('title', {}, c, b.path + ' · ' + nd.hits + (nd.hits === 1 ? ' hit' : ' hits') + (nd.v !== 'allowed' ? ' · ' + nd.v : ''));
    });
    /* the newest step */
    while (p.gNow.firstChild) p.gNow.removeChild(p.gNow.firstChild);
    if (lastStep) {
      var b = lastStep.dir ? null : p.at[lastStep.file];
      if (b) s('circle', { cx: b.x + b.w / 2, cy: b.y + b.h / 2, r: 18, 'class': 'ping' }, p.gNow);
    }
    /* the newest step, named under the map */
    while (p.now.firstChild) p.now.removeChild(p.now.firstChild);
    if (lastStep) {
      h('span', 'n', 'Step ' + lastStep.n + ' of ' + r.steps.length + ' · ' + clock(lastStep.ms), p.now);
      h('span', 'what', doing(lastStep) + ' ' + lastStep.file + (lastStep.dir ? '/' : ''), p.now);
      h('span', 'v ' + lastStep.verdict, VERB[lastStep.verdict] + (lastStep.fence ? ': ' + lastStep.fence : ''), p.now);
    } else h('span', 'n', 'Before the first step', p.now);
    /* stats up to now; the outcome chip is the run's final outcome */
    while (p.stats.firstChild) p.stats.removeChild(p.stats.firstChild);
    [['Attempts', tot.attempts, ''], ['Blocked', tot.blocked, tot.blocked ? 'bad' : ''], ['Crossed', tot.crossed, tot.crossed ? 'warn' : ''], ['Out-of-scope paths', Object.keys(tot.out).length, Object.keys(tot.out).length ? 'bad' : '']]
      .forEach(function (x) { var d = h('div', null, null, p.stats); h('span', null, x[0], d); h('b', x[2], String(x[1]), d); });
  }

  /* timeline */
  function stop() { playing = false; cancelAnimationFrame(raf); $('play').textContent = 'Replay'; }
  function tick(ts) {
    if (!playing) return;
    var m = Number(scrub.max); T = Math.min(m, T + (ts - last) * Math.max(1, m / 12000)); last = ts; scrub.value = String(T); paint();
    if (T >= m) stop(); else raf = requestAnimationFrame(tick);
  }
  function play() { if (T >= Number(scrub.max)) T = 0; playing = true; $('play').textContent = 'Pause'; last = performance.now(); raf = requestAnimationFrame(tick); }
  $('play').addEventListener('click', function () { if (playing) stop(); else play(); });
  scrub.addEventListener('input', function () { stop(); T = Number(scrub.value); paint(); });
  document.addEventListener('keydown', function (e) {
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'range') return;
    if (e.key === ' ') { e.preventDefault(); playing ? stop() : play(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault(); stop();
      var all = []; P.forEach(function (p) { D.runs[p.run].steps.forEach(function (st) { all.push(st.ms); }); });
      all = all.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
      var next = e.key === 'ArrowRight' ? all.filter(function (v) { return v > T; })[0] : all.filter(function (v) { return v < T; }).pop();
      T = next != null ? next : (e.key === 'ArrowRight' ? Number(scrub.max) : 0); scrub.value = String(T); paint();
    }
  });
  window.ScopeMap = { setTime: function (ms) { stop(); T = Math.max(0, Math.min(Number(scrub.max), ms)); scrub.value = String(T); paint(); }, maxTime: function () { return Number(scrub.max); }, pick: function (i, run) { P[i].run = run; P[i].sel.value = String(run); setup(P[i]); resetClock(); } };
  resetClock();
})();
