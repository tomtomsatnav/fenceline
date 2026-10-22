// The fence compiler: plain-English rules -> fences with path globs. The ONLY place Fenceline calls an LLM, once, when
// the user sets fences; the result is shown for confirmation and saved as plain JSON the user can read and edit. Nothing
// here runs while the agent works.
import { spawnSync } from 'node:child_process';
import { validateFences } from './fences.mjs';

export const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['fences'],
  properties: { fences: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'text', 'kind', 'paths'],
    properties: { id: { type: 'string' }, text: { type: 'string' }, kind: { enum: ['deny', 'only'] }, paths: { type: 'array', items: { type: 'string' } }, except: { type: 'array', items: { type: 'string' } }, reads: { type: 'boolean' } } } } },
};

/** A compact outline of the repo for the prompt: every folder with its file count, then up to `maxFiles` file paths. */
export function outline(files, { maxFiles = 300 } = {}) {
  const dirs = new Map();
  for (const f of files) { const parts = f.split('/'); for (let i = 1; i < parts.length; i++) { const d = parts.slice(0, i).join('/'); dirs.set(d, (dirs.get(d) || 0) + 1); } }
  const dl = [...dirs].sort(([a], [b]) => a.localeCompare(b)).slice(0, 400).map(([d, n]) => `${d}/ (${n} files)`);
  const fl = [...files].sort().slice(0, maxFiles);
  return `Folders:\n${dl.join('\n') || '(none)'}\n\nFiles${files.length > maxFiles ? ` (first ${maxFiles} of ${files.length})` : ''}:\n${fl.join('\n')}`;
}

export function buildPrompt(sentences, files) {
  return `You turn a developer's plain-English rules about which parts of a repository a coding agent may change into path rules.
Return one fence per rule (split a sentence that states two rules).

Each fence:
- id: short lowercase kebab-case name (e.g. "migrations", "payments-only", "env").
- text: the user's rule, verbatim.
- kind: "deny" when the rule names an area that must not be changed ("X is off-limits", "never edit X", "don't touch X");
        "only" when the rule confines the work to an area ("this task only touches X", "stay inside X").
- paths: gitignore-style globs relative to the repo root. For "deny", the forbidden area; for "only", the allowed area.
  Use the real folder and file names from the outline below. A folder is written "dir/**". A file name that may appear
  at any depth has no slash (".env*"). Do not widen the rule beyond what the user said.
- except: optional globs carved out of paths (e.g. "never edit .env" should not cover ".env.example": except [".env.example"]).
- reads: true only if the rule also forbids reading or opening the files (e.g. "never read .env"); otherwise false.
For an "only" fence, include the tests that belong to that area if the repo keeps them elsewhere (e.g. test/payments*).

Rules:
${sentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Repository outline:
${outline(files)}`;
}

/** Pull the fences out of whatever the LLM returned, then validate them like a hand-written fences file. */
export function parseCompiled(out, { mode = 'warn' } = {}) {
  let j = out;
  if (typeof j === 'string') { const m = j.match(/\{[\s\S]*\}/); if (!m) throw new Error('compiler returned no JSON'); j = JSON.parse(m[0]); }
  if (j && j.structured_output) j = j.structured_output;
  else if (j && typeof j.result === 'string' && !j.fences) return parseCompiled(j.result, { mode });
  return validateFences({ fences: (j.fences || []).map((f) => ({ ...f, id: String(f.id || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, ''), mode })) });
}

/** Default LLM: one tool-less `claude -p` call with structured output. FENCELINE_DISABLE keeps our own hooks out of it. */
export function claudeLLM(prompt, { model = process.env.FENCELINE_COMPILE_MODEL || 'haiku', cwd } = {}) {
  const r = spawnSync('claude', ['-p', prompt, '--model', model, '--tools', '', '--json-schema', JSON.stringify(SCHEMA), '--output-format', 'json', '--no-session-persistence'],
    { cwd, encoding: 'utf8', env: { ...process.env, FENCELINE_DISABLE: '1' }, timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
  if (r.error) throw new Error(`could not run claude: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`claude exited ${r.status}: ${String(r.stderr || r.stdout).slice(-500)}`);
  return JSON.parse(r.stdout);
}

export function compileFences(sentences, files, { llm = claudeLLM, mode = 'warn', cwd } = {}) {
  return parseCompiled(llm(buildPrompt(sentences, files), { cwd }), { mode });
}
