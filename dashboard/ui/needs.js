/* NEEDS YOU: the header badge and its popover. Lists what is waiting on the human: a session a fence stopped at the end of
 * its turn (the agent is probably asking), a crossing the agent never mentioned, and a repo whose newest guard verdict is an
 * integrity rejection. Items come from AOSNeeds.compute (needs-you.js) over the `fences` and `verdicts` summaries in
 * /api/state; clicking one opens the Guard panel at it. Read-only. Vanilla ES5, no deps; text only, never innerHTML.
 */
(function () {
  'use strict';
  if (typeof document === 'undefined' || !document.createElement) return;
  var R = {}, verdictSum = null, fenceSum = null;
  function safe(fn) { try { return fn(); } catch (e) { return undefined; } }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function clip(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…' : s; }
  function items() { return window.AOSNeeds ? window.AOSNeeds.compute(verdictSum, fenceSum) : { total: 0, items: [] }; }

  function build() {
    var top = document.querySelector('header.top'); if (!top) return;
    var nb = el('button', 'orch-needs'); nb.type = 'button'; nb.id = 'needs-btn'; nb.hidden = true;
    nb.setAttribute('aria-haspopup', 'true'); nb.setAttribute('aria-expanded', 'false'); nb.setAttribute('aria-controls', 'needs-pop');
    R.n = el('b', 'tnum', '0'); nb.appendChild(document.createTextNode('Needs you ')); nb.appendChild(R.n);
    var anchor = document.getElementById('guard-btn') || document.getElementById('theme-btn');
    if (anchor && anchor.parentNode === top) top.insertBefore(nb, anchor); else top.appendChild(nb);
    var pop = el('div', 'orch-needs-pop'); pop.id = 'needs-pop'; pop.hidden = true; pop.setAttribute('role', 'region'); pop.setAttribute('aria-label', 'Waiting on you');
    document.body.appendChild(pop);
    nb.addEventListener('click', function (e) { e.stopPropagation(); setOpen(pop.hidden); });
    document.addEventListener('click', function (e) { if (!pop.hidden && !pop.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !pop.hidden) { setOpen(false); nb.focus(); } });
    R.btn = nb; R.pop = pop;
    update();
  }
  function setOpen(on) { if (!R.pop) return; R.pop.hidden = !on; R.btn.setAttribute('aria-expanded', String(!!on)); if (on) render(); }
  function render() {
    clear(R.pop);
    items().items.forEach(function (it) {
      var b = el('button', 'orch-needs-it'); b.type = 'button'; b.setAttribute('data-id', it.id); b.setAttribute('data-kind', it.kind);
      b.appendChild(el('span', 'orch-needs-t', clip(it.title, 80))); b.appendChild(el('span', 'orch-needs-w', it.text));
      b.addEventListener('click', function () { setOpen(false); if (window.AOSGuard && window.AOSGuard.open) window.AOSGuard.open(it.id); });
      R.pop.appendChild(b);
    });
  }
  function update() {
    if (!R.btn) return;
    var nd = items();
    R.btn.hidden = nd.total <= 0; R.n.textContent = String(nd.total);
    R.btn.setAttribute('aria-label', 'Needs you: ' + nd.total + (nd.total === 1 ? ' item' : ' items') + ' waiting on you');
    if (nd.total <= 0) setOpen(false); else if (!R.pop.hidden) render();
  }
  var lastSig = '';
  function onState(st) {
    safe(function () {
      if (!st || st.replay) return;                      /* replay omits verdicts and fences: keep the live ones */
      verdictSum = st.verdicts && typeof st.verdicts === 'object' ? st.verdicts : null;
      fenceSum = st.fences && typeof st.fences === 'object' ? st.fences : null;
      var sig = JSON.stringify(verdictSum) + JSON.stringify(fenceSum); if (sig === lastSig) return; lastSig = sig;
      update();
    });
  }
  window.AOSNeedsUI = { onState: onState, open: function () { setOpen(true); } };   /* tests */
  function init() {
    safe(build);
    var n = 0, iv = setInterval(function () { var a = window.AosApp; if ((a && typeof a.onState === 'function' && (a.onState(onState), a.getState && onState(a.getState()), true)) || ++n > 60) clearInterval(iv); }, 300);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
