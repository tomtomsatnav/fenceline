/* Pure, read-only aggregation of what is waiting on the human, from the /api/state summaries.
   Loaded as a plain script (window.AOSNeeds) and by node (module.exports) for tests. */
(function (root) {
  'use strict';
  var FENCE_TEXT = { denied: 'a fence stopped the agent: it may be waiting on you', unmentioned: 'crossed a fence without saying so' };
  function list(x, key) { return x && typeof x === 'object' && Array.isArray(x[key]) ? x[key] : []; }
  /* -> { total, items: [{ id, title, kind: fence|integrity, n: 1, text }] }
     fences: the Fenceline summary; a session whose last turn ended after a fence denied an edit (the agent is probably asking),
     or with a crossing its final message never mentioned, is one item (id = fence session id).
     verdicts: the guard summary; a repo whose NEWEST verdict is an integrity rejection is one item (id = verdict id). */
  function compute(verdicts, fences) {
    var items = [];
    list(fences, 'needs').forEach(function (f) {
      if (!f || typeof f !== 'object' || !f.id || !FENCE_TEXT[f.needs]) return;
      items.push({ id: String(f.id), title: String(f.repo_name || 'repo') + (f.agent ? ' · ' + String(f.agent) : ''), kind: 'fence', n: 1, text: FENCE_TEXT[f.needs] });
    });
    list(verdicts, 'latest').forEach(function (v) {
      if (!v || typeof v !== 'object' || v.verdict !== 'integrity' || !v.id) return;
      items.push({ id: String(v.id), title: String(v.repo_name || 'repo'), kind: 'integrity', n: 1, text: 'guard rejected: ' + (v.kind ? String(v.kind).replace(/[_.-]+/g, ' ').slice(0, 60) : 'integrity') });
    });
    return { total: items.length, items: items };
  }
  var api = { compute: compute };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AOSNeeds = api;
})(typeof window !== 'undefined' ? window : globalThis);
