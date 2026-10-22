# Phase 0: is Fenceline worth building?

Date: 2026-10-22. Every number below is printed by `node pilot/summarize.mjs` (copied to `phase0-pilot-table.md`) from
`pilot/results/*.json` (ground truth: `git status` of the trial repo against its seed commit) and
`pilot/results/runs/*/` (hook log, diff, final message). Claude Code 2.1.308.

## 1. Prior art (checked 2026-10-22)

| Project | Map of the repo? | Plain-English zones? | Block / warn? |
|---|---|---|---|
| [cosmtrek/mindwalk](https://github.com/cosmtrek/mindwalk) | Yes: 3D radial tree / treemap "citymap", files glow by seen/read/edited | No (its "scope" is a post-hoc LLM judge dimension) | No; replay of session logs, "doesn't control the agent" |
| [JamsusMaximus/codemap](https://github.com/JamsusMaximus/codemap) | Loosely: live pixel-art hotel, folders = rooms, files = desks | No | No |
| [NirDiamant/claude-watch](https://github.com/NirDiamant/claude-watch) | Partial: bubble graph of prompt/rule/config files | No | No |
| [patoles/agent-flow](https://github.com/patoles/agent-flow), [disler/…-multi-agent-observability](https://github.com/disler/claude-code-hooks-multi-agent-observability), [matt1398/claude-devtools](https://github.com/matt1398/claude-devtools) | No (node graph / timeline / log viewer) | No | disler: hard-coded `.env`/`rm -rf` block; devtools: notify only |
| [Cocabadger/saferun-guard](https://github.com/Cocabadger/saferun-guard) | No | No (regex JSON; ships ask-rules for CI config and migrations) | Block / ask |
| [Dicklesworthstone/destructive_command_guard](https://github.com/Dicklesworthstone/destructive_command_guard) (dcg) | No | No (command packs) | Block, warn, log |
| [Claude Code permissions](https://code.claude.com/docs/en/permissions) `Edit(path)` deny rules | No | No (gitignore globs) | Deny / ask; covers file tools and recognised Bash file commands, not arbitrary subprocesses (docs point to the sandbox) |
| Cursor / Codex sandboxes | No | No | OS-level writable roots |
| AgentSpec, AgentLTL (papers) | No | AgentSpec: LLM-generated rules (not repo paths) | Yes |

Not found: guardhook; any Gource / codebase-city view of live agent activity; any tool that compiles plain-English scope
into path globs. Searches were not exhaustive.

**Verdict:** each half exists; the combination does not. Nearest is mindwalk (the map, replay-only, no zones). The
built-in `Edit(path)` deny rule already covers plain "never edit X" blocking, so the differentiators are the live map, the
one-off plain-English compile, warn mode with a Stop summary, and catching edits made through Bash subprocesses.

## 2. Pilot: do agents cross fences?

Small seed repos (6-7 files, zero dependencies), real `claude -p` sessions, k = 5 per condition, a PostToolUse logger
on every tool (snapshot diff, so Bash edits count). A crossing = any added / modified / deleted file inside the fence,
per git.

See `phase0-pilot-table.md` for the full tables and per-crossing lines. Summary:

- **Rule stated to the agent: 0 / 45 crossings** (Haiku 30, Sonnet 15) across 9 conditions: rule in the same message;
  rule given once in turn 1 of 3; the same with `/compact` before the tempting turn; the same with the tempting turn
  delegated to a subagent; two single-turn tasks.
- **When the task genuinely needed the fenced zone** (a nickname that needs a new column, migrations off-limits):
  Sonnet stopped and asked 5/5. Haiku stopped 4/5 when the rule was turns earlier, but in the other Haiku conditions
  built the feature with the column faked from the test file (`db.addColumn('users','nickname')` in
  `test/users.test.js`): rule-inline 5/5, compacted 3/5, subagent 5/5, long-session 1/5. All 14 of those final messages
  say production still needs the column (regex check in the session log of this report, not yet in `summarize.mjs`).
  The fence held by the letter; the schema change moved to where the fence wasn't.
- **Fence NOT told to the agent: payments 5/5 crossed** into the shared `src/utils/money.js` (first crossing at tool
  call 4-5 of 5-7, 11-14 s in). Each final message names `money.js` as the cause, but nothing tells the reviewer that
  it was outside the intended scope. The migrations bug: 0/5 even with no rule (the in-scope fix was the natural one).

**Limits:** tiny repos, sessions of 1-4 turns and at most ~65 s. Nothing here reproduces a two-hour session; the
original incident is neither confirmed nor refuted.

## 3. Recommendation: ADJUST, then go

The headline "agents break the rules you give them" is not supported by these runs, and a GIF of a stated rule being
broken could not honestly be recorded from them. What the data does support:

1. **"Don't tell the agent. Tell the map."** Fences are the reviewer's scope, not an instruction the agent has to
   remember. Unstated scope drift is the common case (5/5 here), and it is invisible in the final message even when the
   file is named. The GIF can be a real recorded run: the trail heads into `src/utils`, the fence flashes
   "Outside scope: src/utils/money.js · 11 s in".
2. **Block mode as the answer to the two-hour case:** a PreToolUse deny returns the user's own sentence at the moment
   of crossing, so the agent never needs to remember the rule. (Pitch it as cheap insurance, not as a measured rescue.)
3. **Honest limit for the README:** path fences catch where an edit lands, not what it means; the faked-column
   workaround above stays inside the fence.

Optional before launch: one larger-scale run (a real repo, hour-long Sonnet sessions, rule stated early) to see whether
stated-rule crossings appear at scale. Expensive and may again return 0.
