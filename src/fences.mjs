// Fences: the user's plain-English rules, each compiled once into path globs the user can read and edit, stored in
// <repo>/.fenceline/fences.json. Two kinds:
//   deny  "migrations: off-limits"            a write (create / edit / delete) to a matching path crosses it;
//                                             with reads: true, reading one does too ("never read .env")
//   only  "this task only touches src/payments" a write to any path NOT matching crosses it
// mode: warn (record and flag, after the fact) or block (deny the edit before it happens, where it can be seen in advance).
import fs from 'node:fs';
import path from 'node:path';
import { matchAny, globToRegExp } from './glob.mjs';

export const SCHEMA_FENCES = 'fenceline.fences/1';
export const FENCES_FILE = '.fenceline/fences.json';
export const WRITE_OPS = new Set(['create', 'edit', 'delete']);
// never counted against an "only" fence: Fenceline's own config, Claude Code's local settings (written when you approve
// a permission), and lockfiles a package manager rewrites as a side effect
export const ALWAYS_ALLOWED = ['.fenceline/**', '.claude/**', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'Cargo.lock', 'poetry.lock', 'uv.lock', 'Gemfile.lock', 'go.sum', 'composer.lock'];

/** Validate and normalise a fences document. Throws with every problem listed. */
export function validateFences(doc) {
  const errs = [];
  const fences = Array.isArray(doc?.fences) ? doc.fences : (errs.push('fences must be an array'), []);
  const ids = new Set();
  const out = fences.map((f, n) => {
    const where = `fence ${n + 1}${f?.id ? ` (${f.id})` : ''}`;
    const id = String(f?.id || '').trim();
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id)) errs.push(`${where}: id must be lowercase letters, digits, . _ - (got ${JSON.stringify(f?.id)})`);
    if (ids.has(id)) errs.push(`${where}: duplicate id`); ids.add(id);
    if (!['deny', 'only'].includes(f?.kind)) errs.push(`${where}: kind must be "deny" or "only"`);
    if (!['warn', 'block'].includes(f?.mode ?? 'warn')) errs.push(`${where}: mode must be "warn" or "block"`);
    const paths = Array.isArray(f?.paths) ? f.paths.map(String) : [];
    if (!paths.length) errs.push(`${where}: paths must list at least one glob`);
    const except = Array.isArray(f?.except) ? f.except.map(String) : [];
    for (const g of [...paths, ...except]) {
      if (/(^|\/)\.\.(\/|$)/.test(g)) errs.push(`${where}: glob ${JSON.stringify(g)} leaves the repo`);
      else if (g.replace(/[*/]/g, '') === '' && f?.kind === 'deny') errs.push(`${where}: glob ${JSON.stringify(g)} matches the whole repo`);
      else try { globToRegExp(g); } catch (e) { errs.push(`${where}: ${e.message}`); }
    }
    return { id, text: String(f?.text ?? id), kind: f?.kind, mode: f?.mode ?? 'warn', paths, except, reads: f?.kind === 'deny' && f?.reads === true };
  });
  if (errs.length) throw new Error(`invalid fences:\n- ${errs.join('\n- ')}`);
  return { schema: SCHEMA_FENCES, fences: out };
}

export function loadFences(root) {
  const file = path.join(root, FENCES_FILE);
  if (!fs.existsSync(file)) return { schema: SCHEMA_FENCES, fences: [] };
  return validateFences(JSON.parse(fs.readFileSync(file, 'utf8')));
}
export function saveFences(root, doc) {
  const v = validateFences(doc);
  fs.mkdirSync(path.join(root, '.fenceline'), { recursive: true });
  fs.writeFileSync(path.join(root, FENCES_FILE), `${JSON.stringify(v, null, 2)}\n`);
  return v;
}

/** Does touching `file` with `op` cross fence `f`? */
export function crosses(f, file, op) {
  if (matchAny(f.except, file)) return false;
  if (f.kind === 'deny') return (WRITE_OPS.has(op) || (f.reads && op === 'read')) && matchAny(f.paths, file);
  if (f.kind === 'only') return WRITE_OPS.has(op) && !matchAny(f.paths, file) && !matchAny(ALWAYS_ALLOWED, file);
  return false;
}
/**
 * Every fence a touch crosses. With guardConfig (PreToolUse, edit tools), the fences file is a built-in block fence: the
 * agent cannot edit it with Edit/Write. Changes made any other way (`fenceline accept` after you said yes, or a shell
 * command) are not crossings; the hook records them as fence changes and the Stop summary lists them.
 */
export function crossingsFor(fences, file, op, { guardConfig = false } = {}) {
  const out = fences.filter((f) => crosses(f, file, op)).map((f) => ({ fence: f.id, text: f.text, mode: f.mode, file, op }));
  if (guardConfig && file === FENCES_FILE && WRITE_OPS.has(op)) out.push({ fence: 'fenceline-config', text: 'Fenceline\'s fences file: only you change it', mode: 'block', file, op });
  return out;
}

/** Files of the repo each fence covers (deny: the zone; only: the allowed area), for the confirm step and the map. */
export function preview(fences, files) {
  return fences.map((f) => {
    const hit = files.filter((p) => matchAny(f.paths, p) && !matchAny(f.except, p));
    return { id: f.id, matched: hit.length, sample: hit.slice(0, 5) };
  });
}

// ---- Bash: what a command will write, guessed BEFORE it runs (block mode only; every change is still caught after the
// fact by the snapshot diff). Deliberately simple: it reads redirections and the common file commands. It cannot see into
// scripts, interpreters (node -e, python -c) or variables, which is why block mode for Bash is best-effort.
/** Split a command line on ; && || | and newlines that are outside quotes (a quoted ";" must not hide the redirect after it). */
export function splitCommand(s) {
  const parts = []; let cur = ''; let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === q) q = null; else if (c === '\\' && q === '"' && i + 1 < s.length) cur += s[++i]; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '\\' && i + 1 < s.length) { cur += c + s[++i]; continue; }
    if (c === ';' || c === '\n' || c === '|' || (c === '&' && s[i + 1] === '&')) { parts.push(cur); cur = ''; if ((c === '|' && s[i + 1] === '|') || c === '&') i++; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts;
}
export function words(s) {
  const out = []; let cur = ''; let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; else if (c === '\\' && q === '"' && i + 1 < s.length) cur += s[++i]; else cur += c; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '\\' && i + 1 < s.length) { cur += s[++i]; continue; }
    if (/\s/.test(c)) { if (cur) { out.push(cur); cur = ''; } continue; }
    if (c === '>' ) { if (cur && !/^\d$/.test(cur)) out.push(cur); cur = ''; const app = s[i + 1] === '>'; if (app) i++; out.push(app ? '>>' : '>'); continue; }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}
/**
 * [{file, op, cd}]: `file` as written in the command, `cd` the directory a `cd` earlier in the same command moved to
 * (relative to the starting cwd, '' if none, null if it cannot be known, e.g. `cd -`). The caller resolves and expands
 * (".", "*", globs) against the repo.
 */
export function bashWriteTargets(command) {
  const targets = [];
  let cd = '';
  const src = String(command || '').replace(/>\|/g, '>');
  for (const part of splitCommand(src)) {
    let w = words(part.trim()); if (!w.length) continue;
    while (w.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0])) w = w.slice(1); // FOO=1 cmd ...
    if (!w.length) continue;
    const push = (file, op) => targets.push({ file, op, cd });
    for (let i = 0; i < w.length - 1; i++) if ((w[i] === '>' || w[i] === '>>') && !w[i + 1].startsWith('&') && w[i + 1] !== '/dev/null') push(w[i + 1], 'edit');
    const args = w.filter((x, i) => x !== '>' && x !== '>>' && w[i - 1] !== '>' && w[i - 1] !== '>>');
    let cmd = args[0]; let rest = args.slice(1);
    while (['sudo', 'command', 'env', 'nohup', 'time', 'xargs'].includes(cmd?.split('/').pop())) { rest = rest.filter((x) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(x)); cmd = rest[0]; rest = rest.slice(1); }
    cmd = (cmd || '').split('/').pop();
    if (cmd === 'cd' || cmd === 'pushd') {
      const d = rest.find((x) => !x.startsWith('-'));
      cd = cd == null || !d || d === '-' || d.startsWith('~') || d.startsWith('$') ? null : d.startsWith('/') ? d : path.posix.join(cd, d);
      continue;
    }
    const files = rest.filter((x) => !x.startsWith('-'));
    if (cmd === 'rm' || cmd === 'unlink' || cmd === 'rmdir' || cmd === 'shred') files.forEach((f) => push(f, 'delete'));
    else if (cmd === 'touch' || cmd === 'truncate' || cmd === 'tee') files.forEach((f) => push(f, 'edit'));
    else if (['mv', 'cp', 'install', 'ln', 'rsync'].includes(cmd)) {
      const t = rest.findIndex((x) => x === '-t' || x === '--target-directory');
      const tEq = rest.find((x) => x.startsWith('--target-directory='));
      const dest = t >= 0 ? rest[t + 1] : tEq ? tEq.split('=')[1] : files.at(-1);
      const srcs = t >= 0 ? files.filter((x) => x !== dest) : tEq ? files : files.slice(0, -1);
      if (cmd === 'mv') srcs.forEach((f) => push(f, 'delete'));
      if (dest && (srcs.length || t >= 0 || tEq)) push(dest, 'create');
    } else if ((cmd === 'sed' || cmd === 'perl' || cmd === 'gsed') && rest.some((x) => /^-[a-zA-Z]*i/.test(x) || x.startsWith('--in-place'))) {
      // sed -i [suffix] 'script' file...: the script is the first non-option word unless -e/-f supplied it
      const hasE = rest.some((x) => x === '-e' || x === '-f' || x === '--expression' || x === '--file');
      const nonOpt = rest.filter((x, i) => !x.startsWith('-') && !['-e', '-f', '--expression', '--file'].includes(rest[i - 1]));
      nonOpt.slice(hasE ? 0 : 1).forEach((f) => push(f, 'edit'));
    } else if (cmd === 'git' && ['checkout', 'restore', 'rm', 'mv', 'clean', 'reset', 'stash'].includes(rest[0])) {
      const sub = rest[0];
      if (sub === 'clean' || (sub === 'reset' && rest.includes('--hard')) || sub === 'stash') { push('.', sub === 'clean' ? 'delete' : 'edit'); continue; }
      const dd = rest.indexOf('--'); const fs2 = (dd >= 0 ? rest.slice(dd + 1) : rest.slice(1)).filter((x) => !x.startsWith('-'));
      fs2.forEach((f) => push(f, sub === 'rm' ? 'delete' : 'edit'));
    }
  }
  return targets;
}
