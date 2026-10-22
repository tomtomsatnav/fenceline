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
// never counted against an "only" fence: Fenceline's own config, and lockfiles a package manager rewrites
export const ALWAYS_ALLOWED = ['.fenceline/**'];

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
/** Every fence a touch crosses. The fences file itself is always guarded: an agent editing it crosses a built-in fence. */
export function crossingsFor(fences, file, op) {
  const out = fences.filter((f) => crosses(f, file, op)).map((f) => ({ fence: f.id, text: f.text, mode: f.mode, file, op }));
  if (file === FENCES_FILE && WRITE_OPS.has(op)) out.push({ fence: 'fenceline-config', text: 'the fences file changed during the session', mode: 'block', file, op });
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
const SPLIT = /\s*(?:&&|\|\||;|\|(?!\|)|\n)\s*/;
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
export function bashWriteTargets(command) {
  const targets = []; // [{file, op}]
  for (const part of String(command || '').split(SPLIT)) {
    const w = words(part.trim()); if (!w.length) continue;
    for (let i = 0; i < w.length - 1; i++) if ((w[i] === '>' || w[i] === '>>') && !w[i + 1].startsWith('&') && w[i + 1] !== '/dev/null') targets.push({ file: w[i + 1], op: 'edit' });
    const args = w.filter((x, i) => x !== '>' && x !== '>>' && w[i - 1] !== '>' && w[i - 1] !== '>>');
    let cmd = args[0]; let rest = args.slice(1);
    if (cmd === 'sudo' || cmd === 'command' || cmd === 'env') { cmd = rest[0]; rest = rest.slice(1); }
    const files = rest.filter((x) => !x.startsWith('-'));
    if (cmd === 'rm' || cmd === 'unlink' || cmd === 'rmdir') files.forEach((f) => targets.push({ file: f, op: 'delete' }));
    else if (cmd === 'touch' || cmd === 'truncate' || cmd === 'tee') files.forEach((f) => targets.push({ file: f, op: 'edit' }));
    else if (cmd === 'mv') { files.slice(0, -1).forEach((f) => targets.push({ file: f, op: 'delete' })); if (files.length > 1) targets.push({ file: files.at(-1), op: 'create' }); }
    else if (cmd === 'cp' || cmd === 'install' || cmd === 'ln') { if (files.length > 1) targets.push({ file: files.at(-1), op: 'create' }); }
    else if ((cmd === 'sed' || cmd === 'perl') && rest.some((x) => /^-[a-zA-Z]*i/.test(x))) {
      // sed -i [suffix] 'script' file...: the script is the first non-option word unless -e/-f supplied it
      const hasE = rest.some((x) => x === '-e' || x === '-f');
      const nonOpt = rest.filter((x, i) => !x.startsWith('-') && rest[i - 1] !== '-e' && rest[i - 1] !== '-f');
      nonOpt.slice(hasE ? 0 : 1).forEach((f) => targets.push({ file: f, op: 'edit' }));
    } else if (cmd === 'git' && ['checkout', 'restore', 'rm', 'mv'].includes(rest[0])) {
      const dd = rest.indexOf('--'); const fs2 = (dd >= 0 ? rest.slice(dd + 1) : rest.slice(1)).filter((x) => !x.startsWith('-'));
      fs2.forEach((f) => targets.push({ file: f, op: rest[0] === 'rm' ? 'delete' : 'edit' }));
    }
  }
  return targets;
}
