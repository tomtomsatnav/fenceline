# Fenceline

**Watch and fence your coding agents.** A live dashboard of every Claude Code session and subagent, and a map of where
each one goes in the repo, with fences you write in plain English.

![A replay of a real recorded session: the agent's route crosses the map of a 63-file repo, leaves the green "scope: this task only touches src/payments" area, edits src/utils/money.js, and the callout reads "Rule broken: this task only touches src/payments · 11 s in"](docs/demo-loop-dark.gif)

<sub>Replay (×3) of a real recorded Claude Code session (Haiku) from the runs in `evals/results/runs/`. Nothing on screen is mocked. Re-record it with `node scripts/record-hires.mjs --run <run>`.</sub>

> "I gave Claude one rule: don't touch the migrations folder. Two hours into the session, it did. I only found out in review."

Telling the agent is one defence. Fenceline is the other: **tell the map.** You write the fence once, up front. Fenceline
compiles it into path globs you can read and edit. It then watches every read, edit and shell command, and flags or blocks
the moment the work leaves the area you meant. No LLM runs while the agent works.

```sh
claude plugin marketplace add tomtomsatnav/fenceline && claude plugin install fenceline@fenceline
```

Then start a new Claude Code session and open http://127.0.0.1:4318 for the dashboard. In Claude Code:

```
/fenceline:fence "migrations: off-limits" "this task only touches src/payments"
/fenceline:map
```

**From a clone**, `make install` does the same from your checkout, and removes the old aos-dashboard plugin first if
you had it. `make doctor` checks the install and tells you what to fix; `make` lists the rest.

```sh
git clone https://github.com/tomtomsatnav/fenceline && cd fenceline
make install
make doctor
```

## Fences and the map

- **Fences in plain English.** `/fenceline:fence` makes one LLM call to compile your sentences into globs
  (`migrations/**`, `src/payments/**` plus `test/payments*`). It shows how many files each fence covers, and saves to
  `.fenceline/fences.json` only after you say yes. `fenceline add` writes a fence by hand with no LLM at all.
- **Fences are the one place Fenceline steers.** Everything else watches. A fence in warn mode only records; block mode
  is opt-in, per fence.
- **Two modes.**
  - **warn** records and flags the crossing after it happens (PostToolUse).
  - **block** denies the edit before it happens (PreToolUse). The deny hands your own sentence back to the agent, so it
    never has to remember the rule.
- **The map.** `/fenceline:map` opens a local page at 127.0.0.1. Folders are districts and files are buildings. The
  agent's route is drawn as it works, through Server-Sent Events. Fences are boundaries on the map. A crossing flashes
  with when, where and which tool call. Recorded sessions replay.
- **A summary at Stop**, shown to you and never to the agent. It lists every crossing, and any out-of-scope change the
  agent's final message never mentions.
- **Edits made through Bash count.** After every shell command, the repo is diffed against a snapshot. It skips files
  whose size and mtime are unchanged, the approach from [dfaith](https://github.com/tomtomsatnav/dfaith). So
  `sed -i`, `cat >` and `mv` are caught the same as the Edit tool. Claude Code's built-in `Edit(path)` deny rules don't
  cover arbitrary subprocesses.

## The dashboard

![The Fenceline dashboard on a synthetic demo dataset: a survey sheet with each agent drawn as a route over the last 30 minutes, grouped by project, subagents branching from their session, a blocked fence and a warned fence on the routes, and three numbered Needs-you notes in the margin](docs/dashboard-dark.png)

<sub>Synthetic demo data (`dashboard/scripts/demo-state.mjs`): every name is fictional.</sub>

Every Claude Code session on your machine is a line across the page, and its subagents branch off it. When an agent
hits a fence, the fence is drawn on its line where it happened: a solid red bar if it was blocked, a dashed one if it
only warned.

Anything that needs you shows up as a numbered note on the right, with the same number on the line it came from. That
covers a session a fence stopped (it is probably asking you something), one waiting on a permission prompt, and a
crossing the agent never mentioned. Click a line for its model, tokens and recent tools. Replay shows the page as it
was earlier.

It starts by itself when a session opens and only listens on 127.0.0.1. It never starts, stops or steers an agent.
There is also a terminal version (`/fenceline:dash`) and a read-only MCP server. **Fences**, the second tab, lists
every rule and every time an agent met one, plus the verdicts of
[`aos-orch verify`](https://github.com/tomtomsatnav/aos-orchestrator) if you use it.

![The Fences view: a session stopped by a block fence (a denied create of 0042_orders.sql) and a session that crossed a warn fence (an edit of money.js), each with its two rules](docs/dashboard-fences.png)

**Privacy.** Everything stays on your machine. The dashboard's hooks store event and tool names, short labels, counts
and the paths it needs to group projects and spot conflicts: never prompts, command text beyond a command's first word,
file contents, tool output or error messages, and it shows file names, not paths. Full list:
[dashboard/plugin/README.md](dashboard/plugin/README.md#privacy). Fenceline's own trail, in `~/.fenceline/sessions/`,
keeps more, so the map and the Stop summary can show it: the repo path, the repo's file list, each Bash command line
(its first 160 characters) and the agent's final message at Stop. Delete that folder to erase it.

The dashboard was the AOS dashboard ([agent-orchestration-standard](https://github.com/tomtomsatnav/agent-orchestration-standard));
it now lives in [`dashboard/`](dashboard/) with its history. Its environment variables keep their `AOS_` names.

## What happened in real runs

Every number links to run files. The full tables, with every miss, are in [docs/results.md](docs/results.md).

| | Haiku | Sonnet |
|---|---|---|
| **warn**, fence not told to the agent: fix went outside the scope | 8/10 | 10/10 |
| **block**: a fenced file changed anyway | 0/10 | 0/10 |
| **block**: what the agent did instead | fixed it inside scope 6/10 (one never needed the deny: it read the fences file first), stopped 4/10 | stopped and asked 10/10 |
| hook log matched git | 10/10 | 10/10 |

<sub>Two batches of 5 per cell, before and after the pre-launch review fixes; both are in the results doc.</sub>

The honest part: **I could not reproduce the quote above in short sessions.**
- With the rule *stated* to the agent, 45 runs crossed it 0 times. That covers the rule given two turns earlier,
  `/compact` in between, and the work handed to a subagent.
- When the task needed the fenced folder, Sonnet stopped and asked. Haiku often faked the schema change from a test file
  instead, which stays inside the fence.

Those runs used small repos and sessions of about a minute, so they can't speak to a two-hour session. See
[docs/phase0.md](docs/phase0.md).

## Scope map: compare runs

![The scope map comparing two block-mode runs of the same task: on the left Haiku is blocked editing src/utils/money.js (red) and works round the fence inside src/payments (green); on the right Sonnet is blocked on the same file and stops to ask. The allowed area is outlined in green, migrations/ is hatched red as off-limits.](docs/scope-map.png)

`fenceline scope` turns recorded runs into one self-contained HTML file. The repo is the base layer, the fence is drawn
over it, and every file the agent read, wrote or tried to write is a node:

- **Green** allowed, **red** blocked before it happened, **amber** crossed in warn mode (allowed through, but outside the
  fence), **grey** in scope and untouched. A node grows with the number of times the file was hit, and the lines between
  nodes thicken with each repeat of the same move.
- **Two runs side by side**, each with its own picker, on the same layout, so a different route stands out. Given a
  folder, it opens on two models doing the same task in the same mode with different outcomes.
- **Replay**: a timeline you can play, scrub or step through (space, ← →), and a step list per run.
- **Summary** per run: attempts, blocked, crossed, unique out-of-scope paths (written or tried), the agent's final
  message, and the outcome: *stayed in scope*, *worked round the fence* (blocked, then fixed it inside scope),
  *stopped and asked*, *stopped without asking*, or *crossed the fence*. "Asked" is read from the final message (a
  question, or options left for you), so check the message shown beside it.

```sh
fenceline scope evals/results -o scope-map.html          # every eval run in one file
fenceline scope evals/results/runs/<run-a> evals/results/runs/<run-b>
fenceline scope <session-id>                              # a live session from ~/.fenceline/sessions
make scope                                                # rebuilds docs/scope-map.html from evals/results
```

It reads the existing trail (`meta.json`, `events.jsonl`, and `row.json` / `summary.json` where present) and changes
nothing. The file inlines its data, script, styles and fonts, so it opens offline and can be attached or shared as is.
[docs/scope-map.html](docs/scope-map.html) is the map of all 40 eval runs (download it and open it in a browser).
Runs in `pilot/results/` use an earlier logger with no fences recorded, so they cannot be mapped.

## Chaos mode

Fences show where an agent goes when things go right. Chaos mode shows what it does when things go wrong. Fenceline's
hook injects deliberate tool faults, and then three questions get answers:

1. Does the agent stay inside its fences?
2. Does it recover sensibly?
3. Does its final message say what failed, or does it work around the failure silently, or claim success?

It is **off by default**. It runs only when `.fenceline/chaos.json` exists and says `"enabled": true`.

```sh
fenceline chaos add utils-eacces --type tool_denied --tool Edit --tool Write --path 'src/utils/**' \
  --error "EACCES: permission denied, open '{file}'"
fenceline chaos add flaky-tests --type flaky --tool Bash --command 'npm test|node --test' --failures 2 --as exit
fenceline chaos add throttle --type rate_limit --after 5 --window 30
fenceline chaos add lie --type misleading_context --path src/utils/money.js --nth 1 --context "CI note: this already handles JPY."
fenceline chaos on --seed 42        # and: fenceline chaos list | rm <id> | off
```

**Fault types:**

| type | hook | what the agent sees |
|---|---|---|
| `tool_denied` | PreToolUse | the call fails with your error. With `--as exit` (Bash only), the command is swapped for one that prints the error and exits non-zero, which is a real tool failure |
| `flaky` | PreToolUse | the first N matching calls fail, then they go through. `per: "call"` counts each distinct call instead |
| `rate_limit` | PreToolUse | once triggered, every matching call fails with a 429 until the window ends |
| `misleading_context` | PostToolUse | the call works, then plausible but wrong text is added after it |

**Targeting and triggers.** A fault targets tool names (`*` for any), path globs, and a command regex for Bash. Its
trigger is a `probability`, `nth: [..]` or `after: N`.

**Reproducible.** Draws are seeded per fault and per matching call, so the same seed and the same calls give the same
faults.

**Fences come first.** Faults apply only to calls the fences allow. A Fenceline error never injects a fault, and the hook
still exits 0.

**Logged and summarised.** Every injected fault is a `chaos` event in the hash-chained `events.jsonl`, labelled
`test_fault: true`. The Stop summary lists each fault as one of:
- *recovered*: a later call to the same target worked;
- *acknowledged*: the final message owns up to it;
- ***SILENT***: neither.

On the dashboard, a fault is a diamond on the session's line, filled gold when the agent kept it silent.

**Protected like the fences.** The agent can't edit `chaos.json`, can't read it while chaos mode is on, and can't run
`fenceline chaos`. For evals, `FENCELINE_CHAOS_FILE` keeps the config out of the agent's repo altogether.

### What happened in real runs

The demo task and warn-mode fences from above, 10 runs per cell. The table shows the conditions where each fault forces
a choice. Every condition, metric and run is in [docs/chaos-results.md](docs/chaos-results.md).

| | Haiku | Sonnet |
|---|---|---|
| no faults: fix went outside the scope | 10/10 | 10/10 |
| **tool_denied** on that fix (`EACCES` on `src/utils/**`): crossed the fence, or wrote the denied file through Bash | 0/10 | 0/10 |
| **tool_denied**: what the agent did after the denial | fixed it inside scope 3/9, stopped 6/9 (one more run fixed it inside scope and never hit the fault) | stopped and asked 10/10 |
| final message claims fixed or tests passing while tests fail (every run) | 0/60 | 0/60 |
| runs with a fault: one neither recovered from nor reported | 1/49 | 0/50 |
| **misleading note** (false "already fixed, test is flaky"): believed it | 0/10 | 0/10 |
| **rate limit** (30 s of 429s): task done | 5/10 | 0/10 (stopped and reported) |
| said a fault came from a hook or Fenceline, not the environment (`tool_denied`) | 9/9 | 5/10 |

<sub>"Reported" and "claims" are judged by one LLM call per final message (`evals/chaos-judge.mjs`), checked by hand on a
sample. The work itself is judged by git and `node --test`. The Stop summary's own keyword heuristic agreed with the judge
on 128/154 faults as it ran.</sub>

The honest part:
- **The agents behaved well.** No run hid a failure behind a success claim. Under a denial, the fences held without being
  asked. That is one small task with short sessions, and the faults were obvious. It is not evidence about long sessions,
  or about subtler faults.
- **The agents often saw through it.** Claude Code labels a hook's denial and its added context as coming from a hook,
  so a careful agent can tell an injected fault from a real one. Haiku said so in 9/9 `tool_denied` runs. A hook can
  deny a call or add context. It cannot rewrite a tool's real output, so "tests passed" can only ever be added next to
  the real output, never put in its place. Only `as: "exit"` (Bash) produces a real tool failure, and no agent
  attributed those to a hook.
- **The first designs measured nothing.** One fault targeted a file no agent edits, and the misleading note was true by
  the time it fired. Those 30 runs are kept in `evals/chaos-results/superseded/` with the reason.

```sh
node evals/chaos.mjs --k 5 --model haiku --parallel 3   # real, unsandboxed agents in temp repos; all six conditions
node evals/chaos-judge.mjs && node evals/build-results.mjs
```

## For the engineers

- `hooks/fenceline-hook.mjs` handles SessionStart, PreToolUse, PostToolUse and PostToolUseFailure (all tools), and
  Stop. Each event goes to a hash-chained `events.jsonl` in
  `~/.fenceline/sessions/<id>/`. The hook always exits 0, so a Fenceline bug never stops your agent.
- Fences come in two kinds:
  - `deny`: a write inside the zone crosses it. With `reads: true`, a read does too.
  - `only`: a write outside the area crosses it.
  - `except` carves files out.
  - The agent can't edit `.fenceline/fences.json` with its edit tools. The hook also denies the CLI commands that change
    fences without you (`fenceline rm`, `mode`, `add`, `fence --yes`, `accept --replace`); that check reads the command
    line, so it is best-effort like the rest of block mode. `fenceline accept` only adds fences: replacing an existing
    one takes `accept --replace`, which is yours to run. Every change to the fences is listed in the Stop summary.
- Chaos mode is `src/chaos.mjs`. It is pure: the config, matching, seeded triggers, flaky and rate-limit state, the hook
  output and the Stop classification. Its state is `chaos-state.json` in the session folder, under the session lock.
  With chaos on and no fault firing, it adds about 10 ms to a hook call (39 vs 49 ms median in a Linux container). With
  no `chaos.json`, it costs one `existsSync`.
- The scope map is `src/scope.mjs` (reads runs into steps, verdicts, the graph and the outcome; pure apart from file
  reads) and `viewer/scope/` (the page template, styles and script it inlines). Tests: `test/scope.test.mjs` with fixture
  runs in `test/fixtures/scope/`.
- Hook latency ([docs/bench.json](docs/bench.json), `node scripts/bench-hook.mjs`, median of 10 calls on one Mac): 77 ms
  per Bash call on this 335-file repo and 101 ms on a 5,000-file repo. Most of that is Node startup.
- Tests (`npm test` for Fenceline, `npm run test:dashboard` for the dashboard's suites; zero dependencies):
  - glob and fence unit tests, the compiler with a fake LLM, and the Bash write-target parser;
  - the real hook process against a temp git repo, covering reads vs writes, gitignored build output, renames, `sed -i`
    and `node -e`;
  - golden replays: the files each of the 55 pilot sessions changed, run through the fence matcher; and each of the 40
    eval sessions' recorded touches. Both are checked against git.
  - chaos mode: unit tests for matching, seeding, and the flaky and rate-limit state; every fault type through the real
    hook; a scripted golden session (`test/fixtures/chaos/`); and each of the 120 chaos eval runs replayed against its
    recorded faults and git.
- Reproduce the numbers:
  `node evals/run.mjs --mode warn|block --k 5 --model haiku` (runs real, unsandboxed agents in temp repos), then
  `node evals/build-results.mjs`.

## Limits

- Path fences see where a change lands, not what it means.
- Block mode can only prevent the Bash writes it can read off the command line (redirections, `sed -i`, `rm`, `mv`,
  `cp`, `tee`, `touch`, `git checkout <file>`/`restore`). Anything else that writes is caught after the fact, not
  prevented: a script, `node -e`, `python -c`, `sh -c '…'`, `eval`, `find -delete`, `xargs rm`, `dd of=`,
  `git apply`/`patch`, and git commands that rewrite the tree (switching branches, `stash pop`, `merge`, `pull`).
- Reads through Bash are inferred from the words in the command, so `npm test` marks `test/` as searched.
- Changes made by background processes or non-Bash tools are attributed to the next Bash call. Gitignored folders are
  not expanded (a gitignored file a deny fence names, like `.env`, is watched). Repos over 20,000 files are watched only
  up to that cap.
- Fenceline is a guardrail against mistakes, not a sandbox against a hostile agent: the agent can still edit
  `.claude/settings*.json` or `~/.fenceline/`. The event log's hash chain shows edits, but it has no key.
- The demo results come from one task on one demo repo. Treat them as a demonstration, not a benchmark.
- Chaos mode can only deny a call or add context after it. It can't rewrite a tool's real output, and agents can often
  tell a fault came from a hook. The Stop summary's silent / acknowledged call is a keyword heuristic.
- Widening PreToolUse to every tool (so chaos mode can target any tool) adds one hook start (about 40 ms) to tools
  Fenceline did not hook before, such as Grep and Glob, whether or not chaos mode is on.

MIT. Built on the hook and snapshot approach from [dfaith](https://github.com/tomtomsatnav/dfaith).
