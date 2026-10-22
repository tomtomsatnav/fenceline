// Squarified treemap of a repo: folders are districts (nested boxes with a gutter = the streets and a label band),
// files are buildings. Pure and deterministic; runs in node and in the browser.
//   layout(files:[{path,size}], {width,height}) -> { width, height, districts:[{path,name,depth,x,y,w,h,label}], buildings:[{path,name,x,y,w,h,size,dir,members?}] }
// A building whose `members` is set is a "+N files" block standing for those paths.
const weightOf = (size, k) => Math.sqrt(Math.max(0, Number(size) || 0)) + k;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function buildTree(files) {
  const root = { name: '', path: '', dirs: new Map(), files: [] };
  const seen = new Set();
  for (const f of files) {
    const p = String(f.path).replace(/^\/+/, '');
    if (!p || seen.has(p)) continue;
    seen.add(p);
    const parts = p.split('/'); let n = root;
    for (let i = 0; i < parts.length - 1; i++) {
      let c = n.dirs.get(parts[i]);
      if (!c) { c = { name: parts[i], path: parts.slice(0, i + 1).join('/'), dirs: new Map(), files: [] }; n.dirs.set(parts[i], c); }
      n = c;
    }
    n.files.push({ path: p, name: parts[parts.length - 1], size: Number(f.size) || 0 });
  }
  return root;
}

function allNodes(n, out = []) { out.push(n); for (const c of n.dirs.values()) allNodes(c, out); return out; }

function squarify(items, x, y, w, h) {
  const total = items.reduce((s, it) => s + it.weight, 0);
  if (!items.length || total <= 0 || w <= 0 || h <= 0) return;
  const scale = (w * h) / total;
  let i = 0;
  while (i < items.length) {
    const short = Math.min(w, h);
    let sum = 0; let mx = 0; let mn = Infinity; let best = Infinity; let j = i;
    for (; j < items.length; j++) {
      const a = items[j].weight * scale;
      const s2 = sum + a; const m2 = Math.max(mx, a); const n2 = Math.min(mn, a);
      const worst = Math.max((short * short * m2) / (s2 * s2), (s2 * s2) / (short * short * n2));
      if (j > i && worst > best) break;
      best = worst; sum = s2; mx = m2; mn = n2;
    }
    const last = j >= items.length;
    const thick = last ? (w >= h ? w : h) : sum / short;
    if (w >= h) {
      let cy = y;
      for (let k = i; k < j; k++) { const ih = k === j - 1 ? y + h - cy : (items[k].weight * scale) / thick; Object.assign(items[k], { x, y: cy, w: thick, h: ih }); cy += ih; }
      x += thick; w -= thick;
    } else {
      let cx = x;
      for (let k = i; k < j; k++) { const iw = k === j - 1 ? x + w - cx : (items[k].weight * scale) / thick; Object.assign(items[k], { x: cx, y, w: iw, h: thick }); cx += iw; }
      y += thick; h -= thick;
    }
    i = j;
  }
}

export function layout(files, { width = 1280, height = 720, top = 0, margin = 8, gutter = 5, band = 13, k = 7, maxBuildings = 2500 } = {}) {
  const root = buildTree(files || []);
  const nodes = allNodes(root);
  for (const n of nodes) n.files.sort((a, b) => b.size - a.size || cmp(a.path, b.path));
  // keep the K biggest files per folder; the rest of a folder collapse into one "+N files" block (a lone leftover stays)
  const countAt = (K) => nodes.reduce((s, n) => { const r = n.files.length - K; return s + (r > 1 ? K + 1 : n.files.length); }, 0);
  const maxFiles = Math.max(0, ...nodes.map((n) => n.files.length));
  let K = maxFiles;
  if (countAt(K) > maxBuildings) { let lo = 1; let hi = maxFiles; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (countAt(mid) <= maxBuildings) lo = mid; else hi = mid - 1; } K = lo; }

  const buildings = []; const districts = [];
  const prep = (n) => {
    const kept = n.files.length - K > 1 ? n.files.slice(0, K) : n.files;
    const rest = n.files.length - K > 1 ? n.files.slice(K) : [];
    n.items = kept.map((f) => ({ weight: weightOf(f.size, k), file: f }));
    if (rest.length) n.items.push({ weight: rest.reduce((s, f) => s + weightOf(f.size, k), 0), block: rest });
    for (const c of [...n.dirs.values()].sort((a, b) => cmp(a.name, b.name))) { prep(c); n.items.push({ weight: c.weight, dir: c }); }
    n.weight = n.items.reduce((s, it) => s + it.weight, 0);
  };
  prep(root);

  const place = (n, x, y, w, h, depth) => {
    const g = depth === 0 ? margin : Math.min(gutter, w / 8, h / 8);
    let ix = x + g; let iy = y + g + (depth === 0 ? top : 0); let iw = w - 2 * g; let ih = h - 2 * g - (depth === 0 ? top : 0);
    let label = null;
    if (depth > 0 && iw > 40 && ih > band * 3) { label = { x: ix, y: iy, w: iw, h: band }; iy += band; ih -= band; }
    districts.push({ path: n.path, name: n.name, depth, x, y, w, h, label });
    const items = [...n.items].sort((a, b) => b.weight - a.weight || cmp(a.dir ? a.dir.path : a.file ? a.file.path : '~' + a.block[0].path, b.dir ? b.dir.path : b.file ? b.file.path : '~' + b.block[0].path));
    squarify(items, ix, iy, iw, ih);
    for (const it of items) {
      if (it.dir) place(it.dir, it.x, it.y, it.w, it.h, depth + 1);
      else if (it.file) buildings.push({ path: it.file.path, name: it.file.name, x: it.x, y: it.y, w: it.w, h: it.h, size: it.file.size, dir: n.path });
      else buildings.push({ path: `${n.path ? n.path + '/' : ''}+${it.block.length} files`, name: `+${it.block.length} files`, x: it.x, y: it.y, w: it.w, h: it.h, size: it.block.reduce((s, f) => s + f.size, 0), dir: n.path, members: it.block.map((f) => f.path) });
    }
  };
  place(root, 0, 0, width, height, 0);
  return { width, height, districts, buildings };
}
