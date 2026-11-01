# Claude Code live dashboard (plugin)

This repo contains a read-only **live monitor for Claude Code sessions**: it draws every session, project and subagent on a survey sheet (agents as routes along a time scale, subagents branching from their session, fences on the routes), with per-agent model, tokens, run time, tool feed, file conflicts, errors and alerts. It is local-only (binds 127.0.0.1) and stores only event and tool names, short labels, counts, and the local folder/file paths it needs for project grouping and file-conflict detection: never prompts, command lines (only a Bash command's first word), file contents, tool output or error messages. Full paths stay in the local log and are never shown in the dashboard, terminal view or MCP output (see [plugin/README.md](../plugin/README.md) for the exact list).

| Part | Where | What |
|---|---|---|
| Hooks | `hooks/aos-hook.mjs`, `plugin/hooks/hooks.json` | Claude Code hooks write sanitized one-line events |
| Monitor | `monitor.mjs` | Folds events into `/api/state`, `/api/history`, replay (`?at=`), alerts, notifications |
| Web UI | `ui/` | The survey sheet: Routes, Fences and Activity views, Needs-you margin notes, replay, light/dark toggle |
| Terminal UI | `cli/dash.mjs` (`aos-dash`) | The same sessions in the terminal (`--once` for a snapshot; `--json` for a JSON snapshot `{agents, tasks?, totals}`, or `{"error":"monitor unreachable"}` with exit 1 when the monitor is down) |
| MCP server | `plugin/mcp/server.mjs` | Read-only tools so Claude can query the monitor |
| Notifier | `plugin/notify/` | Branded macOS notifications with an app icon |
| Plugin | `plugin/`, `.claude-plugin/marketplace.json` | Packages all of the above; `node plugin/build.mjs` regenerates the copies |

Install (needs Node 18+ and the Claude Code CLI):

```sh
make install        # builds, registers + installs the local plugin, links `aos-dash`, builds the notifier, starts the monitor
make doctor         # checks the whole setup and tells you what to fix
make                # lists every target (test, build, start/stop, statusline, uninstall, ...)
```

Then open http://127.0.0.1:4318 (the monitor starts automatically with a session; set `AOS_NO_AUTOSTART=1` to disable). New sessions pick up the hooks; existing ones need `/reload-plugins`. Project grouping, alerts and the stuck/errored rules can be tuned in the monitor's `live/config.json` (see [plugin/README.md](../plugin/README.md)). Status: personal project, macOS-first. Licensed under the [MIT License](../LICENSE).

## Highlights

- Privacy-first local telemetry: hooks log event and tool names, counts and short labels only, never prompts, command lines, file contents, tool output or error messages.
- A survey sheet: each agent is a route from its start to now with a tick per tool call, drawn by status (running solid, idle thin, no activity dotted, error crossed out, finished barred); subagents branch from the session that started them; agents that finished before the window fold into one row per project.
- Fences on the routes (a solid wall where one blocked, a dashed bar where one only warned) and dashed ties between agents that touched the same file.
- Needs you as numbered margin notes, keyed to the same numbers on the routes: blocked fences, permission prompts waiting for an answer, unmentioned crossings, rejected work.
- Per-model stuck thresholds, plus errored-agent and file-conflict detection.
- Scale: Auto (the smallest of 5, 15, 30, 60 or 180 minutes that covers recent activity) or a fixed span; keyboard: j/k move between routes, 1/2/3 switch views, T switches theme.
- Replay: drag back through the recorded history and the sheet is redrawn as it was.
- Light and dark themes with checked contrast tokens; fonts ship with the plugin, nothing loads from the network.
- One plugin ships the hooks, the web UI, a terminal dashboard (`aos-dash`), a read-only MCP server and a macOS notifier.
- Automated test suites for the terminal UI, monitor (verdicts, fences, cost, timeline), MCP server, notifier and theme contrast (`make test`).

## Guard view

Guardrails around a single Claude Code session (the orchestrator's `aos-orch verify`: re-run the original tests in a sandbox, anti-cheat diff analysis) are what stops an agent rewriting tests to pass. The Fences view puts those verdicts on the dashboard, read-only.

- **Fences view.** Under each session's fences, the 50 newest verdicts: repo folder name, time, verdict (`verified`; `rejected: <kind>` for an integrity rejection such as tests edited, skipped or deleted, vacuous pass, literal copy, worktree mutated during checks; `rejected: checks failed` for a capability rejection), source, linked session, tree and base commit, reasons, failing tests and warnings.
- **Needs you.** A repo whose newest verdict is an integrity rejection adds a margin note; selecting it opens the Fences view. A newer verdict for the repo clears it.

Data: `<orch dir>/verdicts/<id>.json` (`id` matching `v-YYYYMMDD-HHMMSS-<6 hex>`, schema `aos.verdict/1`) in the same orchestrator dirs the monitor reads goals from (`AOS_ORCH_DIR`, `~/.aos/orch`, the legacy plugin-data `orch`). The newest 200 files by id are read (64 KB each, cached by mtime, rescanned at most once a second); bad JSON, a wrong schema, an id that differs from the file name, symlinks and oversized files are skipped. `GET /api/verdicts` returns `{verdicts: [...]}`; `/api/state` carries `verdicts: {total, verified, integrity, capability, latest[newest per repo]}` and `guard` on linked session agents; replay (`?at=`) omits both. A verdict is linked to a live session when its `session_id` starts with the session's 8-character id from the hook log. The full repo path and the session id are never exposed.

### Auto-verify on Stop (opt-in, off by default)

The plugin ships a SessionStart + Stop hook (`hooks/aos-guard.mjs`) that does nothing until you list repos in the monitor's `config.json` (`~/.claude/plugins/data/aos-dashboard-aos-local/live/config.json`, or `live/config.json` in a checkout):

```json
{
  "guard": {
    "repos": ["/abs/path/to/repo", { "path": "/abs/path/to/other", "base": "<40-hex commit sha>" }],
    "cli": "/abs/path/to/aos-orchestrator/bin/aos-orch.mjs",
    "timeout_s": 300
  }
}
```

When a session starts in one of those repos, the hook records the repo's `HEAD` as that session's base (`guard/bases/<session id>.json`: `{repo, sha, at}`). When the session finishes a turn, the hook starts `node <cli> verify --repo <listed repo> --base <recorded sha> --source hook --session <session id>` in the background and returns at once; the verdict then appears on the session node.

- **Base.** `verify` diffs against the commit recorded at session start, so an agent that commits its work onto `main` (or any branch) is still judged on everything it changed. The first record for a session is kept (a resume or compaction cannot move it). If there is no record (for example the hook was installed mid-session, or the session id is not valid), the repo's explicit `base` from config is used (a 40-hex sha only; a branch name is refused because the agent can move it); with neither, the run is skipped and `guard.log` says why. It never falls back to `main`.
- `HEAD` is read with `git rev-parse` started without a shell, with global and system git config ignored (`GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`), hooks and fsmonitor off, and a 5 s timeout; only a 40-hex result is stored. At most 200 base records are kept (oldest removed first).

- It never blocks or delays the session (registered `async`; the hook only spawns a detached runner and exits), never prints into the conversation and always exits 0.
- Every config value is validated: `repos` and `cli` must be absolute and are resolved with `realpath`; a repo must be an existing directory, `cli` an existing file, `timeout_s` 10 to 3600 (default 300). The session's `cwd` must be inside a listed repo after `realpath` (a symlink out of the repo does not count). The session id is passed only if it matches `^[A-Za-z0-9_-]{1,128}$`.
- No shell is ever used: the runner and the CLI are started with argument arrays. The CLI runs with its working directory in the data folder, not the repo, and is killed after `timeout_s`.
- At most one run per repo at a time (a lock file in `<data>/guard/`; a later Stop during a run is skipped and logged).
- It logs only to the data folder: `guard/guard.log` (one line per run) and `guard/last-<hash>.log` (the newest run's output, max 256 KB).

Remove the `guard` key (or the repo from `repos`) to turn it off.

## Debugging

`window.FLSheet` in the browser console exposes `getState()` (the last `/api/state`), `getModel()` (what the sheet drew: groups, lanes, notes, ties), `select(id)` and `setView(name)`. `node ui/sheet.test.mjs` checks the model, the read-only and text-only rules, and the palette's contrast.

## Security

- **Threat model.** The monitor is a local, read-only observer. It binds `127.0.0.1` only, rejects requests whose `Host` or `Origin` is not `localhost`/`127.0.0.1` (DNS-rebinding and cross-site protection), sends no CORS headers, has no write endpoints except the optional in-memory OpenTelemetry receiver at `/v1/metrics` (any local process can post figures to it; see [otel.md](otel.md)), and serves only the files under `ui/` (dotfiles, traversal and symlinks out of `ui/` are refused). Anyone who can run code as your user can read the log anyway; the design goal is that nothing leaves the machine and no other site or user can reach it.
- **Guard auto-verify (opt-in).** With `guard` configured, every finished turn in a listed repo runs that repo's tests through `aos-orch verify` (the orchestrator's sandbox) in the background, as your user. That executes the repo's own test code, which an agent may just have edited, so it is opt-in per repo: list only repos whose tests you would run yourself. The base it verifies against is the `HEAD` recorded at session start (or an explicit sha in config), never a branch the agent could move; without one no run happens. An agent that can write the data folder as your user could still forge the record, as it could the verdict files. The monitor itself stays read-only; only the guard hook starts processes, and nothing reaches it over HTTP.
- **What is stored.** See the exact field list under Privacy in [plugin/README.md](../plugin/README.md). Agent names and task labels come from Claude Code tool calls, so the UI and terminal view treat them as untrusted text (never rendered as HTML or terminal escape codes). New log files are created owner-only (`0600`, directory `0700`).
- **How to erase.** Delete the data folder: `~/.claude/plugins/data/aos-dashboard-aos-local/live` (or your `AOS_LIVE_DIR`); `make uninstall` removes the plugin but keeps the data.
- **Reporting.** Please open a GitHub issue. For anything sensitive, open an issue asking for a private contact rather than posting details.
