import test from 'node:test';
import assert from 'node:assert/strict';
import { layout } from '../viewer/layout.mjs';

const E = 1e-6;
const mk = (n, dirs = 20) => Array.from({ length: n }, (_, i) => ({ path: `d${i % dirs}/s${i % 7}/f${i}.js`, size: (i * 7919) % 5000 }));
const check = (files, W = 1280, H = 720) => {
  const L = layout(files, { width: W, height: H });
  const bs = L.buildings;
  for (const b of bs) assert.ok(b.x >= -E && b.y >= -E && b.x + b.w <= W + E && b.y + b.h <= H + E && b.w > 0 && b.h > 0, `inside ${b.path}`);
  // sweep for overlaps
  const s = [...bs].sort((a, b) => a.x - b.x);
  for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length && s[j].x < s[i].x + s[i].w - E; j++) {
    const a = s[i], b = s[j];
    assert.ok(!(a.y < b.y + b.h - E && b.y < a.y + a.h - E), `overlap ${a.path} ${b.path}`);
  }
  const covered = new Set(); for (const b of bs) { if (b.members) b.members.forEach((m) => covered.add(m)); else covered.add(b.path); }
  for (const f of files) assert.ok(covered.has(f.path), `represented ${f.path}`);
  return L;
};

test('small tree: inside, no overlap, all represented', () => {
  const L = check([{ path: 'package.json', size: 81 }, { path: 'src/a/x.js', size: 200 }, { path: 'src/b.js', size: 0 }, { path: 'test/t.js', size: 900 }]);
  assert.equal(L.buildings.length, 4);
  assert.ok(L.districts.some((d) => d.path === 'src' && d.label));
});
test('works at 4:5 too', () => check(mk(60), 1080, 1350));
test('deterministic regardless of input order', () => {
  const f = mk(300);
  assert.deepEqual(layout(f, {}), layout([...f].reverse(), {}));
});
test('1 file fills the frame', () => {
  const L = check([{ path: 'a.txt', size: 5 }]);
  assert.equal(L.buildings.length, 1);
});
test('5000 files collapse to <= 2500 buildings', () => {
  const L = check(mk(5000));
  assert.ok(L.buildings.length <= 2500 && L.buildings.some((b) => b.members));
});
test('5000 files in one folder', () => {
  const L = check(Array.from({ length: 5000 }, (_, i) => ({ path: `big/f${i}.txt`, size: i })));
  assert.ok(L.buildings.length <= 2501);
});
test('empty input', () => assert.equal(layout([], {}).buildings.length, 0));
