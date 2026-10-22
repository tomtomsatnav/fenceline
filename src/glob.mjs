// Gitignore-flavoured globs -> RegExp, for repo-relative POSIX paths. Supports **, *, ?, [abc], {a,b}. A pattern with no
// slash matches at any depth (like .gitignore: "*.env" matches "config/prod.env"); a trailing slash means "everything under
// this directory"; a pattern naming a directory also matches everything under it ("migrations" = "migrations/**").
const esc = (c) => c.replace(/[.+^$()|\\]/g, '\\$&');

export function globToRegExp(glob) {
  let g = String(glob).trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!g) throw new Error('empty glob');
  const anchored = g.startsWith('/') || g.replace(/\/$/, '').includes('/');
  g = g.replace(/^\//, '');
  if (g.endsWith('/')) g += '**';
  let re = ''; let i = 0; let brace = 0;
  while (i < g.length) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        const atStart = i === 0 || g[i - 1] === '/'; const atEnd = i + 2 === g.length || g[i + 2] === '/';
        if (atStart && atEnd) { re += i + 2 === g.length ? '.*' : '(?:.*/)?'; i += i + 2 === g.length ? 2 : 3; continue; }
        re += '[^/]*'; i += 2; continue;
      }
      re += '[^/]*'; i++; continue;
    }
    if (c === '?') { re += '[^/]'; i++; continue; }
    if (c === '[') { const j = g.indexOf(']', i + 1); if (j > i) { re += `[${g.slice(i + 1, j).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`; i = j + 1; continue; } }
    if (c === '{') { brace++; re += '(?:'; i++; continue; }
    if (c === '}' && brace) { brace--; re += ')'; i++; continue; }
    if (c === ',' && brace) { re += '|'; i++; continue; }
    re += esc(c); i++;
  }
  if (brace) throw new Error(`unbalanced { in ${glob}`);
  // a pattern that names a directory covers everything below it
  return new RegExp(`^${anchored ? '' : '(?:.*/)?'}${re}(?:/.*)?$`);
}

const cache = new Map();
export function matchGlob(glob, rel) {
  let re = cache.get(glob); if (!re) { re = globToRegExp(glob); cache.set(glob, re); }
  return re.test(rel);
}
export const matchAny = (globs, rel) => (globs || []).some((g) => matchGlob(g, rel));
