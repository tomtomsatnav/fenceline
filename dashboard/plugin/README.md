# Fenceline dashboard (built plugin folder)

A local, read-only live dashboard for Claude Code sessions. Hooks log one compact line per event to a local file; a monitor folds them into a survey sheet (agents as routes over time, subagents branching from their session) served at http://127.0.0.1:4318. It also has a terminal view, a read-only MCP server and a branded macOS notifier.

This folder is built from `dashboard/` (`node dashboard/plugin/build.mjs`) and is loaded by the Fenceline plugin; it is not installed on its own. Install Fenceline from the repo root: the two `claude plugin` commands in the [root README](../../README.md), or `make install` from a clone. Remove it with `make uninstall` there (your history stays in the data folder).

## Use

- **Web:** http://127.0.0.1:4318 (`make open`). The monitor starts automatically at session start.
- **Terminal:** `aos-dash` (live full-screen; `q` quit, space pause, `l` cycles auto/list/ring, `d` shows done subagents from the last 10 minutes). `aos-dash --once` prints one frame.
- **In a session:** `/fenceline:dash` shows a snapshot; the `aos_*` MCP tools let Claude query the monitor (`aos_status` first).
- **Status line (optional):** `make statusline` (edits `~/.claude/settings.json` with a backup; `make statusline-off` removes it).
- **Notifications:** alerts for "needs your input" and "stuck" use a small branded notifier app on macOS (`make notifier`).

## Hooks (16 events, all async)

SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, SubagentStart, SubagentStop, Stop, StopFailure, TaskCreated, TaskCompleted, PreModelSwitch, PostModelSwitch, Notification, SessionEnd.

## Configuration

`${CLAUDE_PLUGIN_DATA}/live/config.json` (usually `~/.claude/plugins/data/fenceline-fenceline/live/config.json`; seeded on first run, never overwritten):

```json
{
  "stuck_after_s": 180,
  "stuck_after_s_by_model": { "opus": 600, "sonnet": 240, "haiku": 180 },
  "notify": { "enabled": true, "on": ["needs_input", "stuck"], "sound": false },
  "projects": { "my-app": "My App" }
}
```

- `stuck_after_s*`: seconds of silence before an agent counts as stuck (doubled while a tool call is open).
- `notify.on`: any of `needs_input`, `stuck`, `error`, `agent_done`, `session_done`.
- `projects`: rename a project by folder name or full path. A project is the folder containing most of a session's activity (a folder with `.git`, `package.json`, `CLAUDE.md` etc. wins over a plain parent).
- `prices.json` (same folder): optional per-model prices for dollar estimates; empty by default.

Environment: `AOS_NO_AUTOSTART=1` disables the monitor autostart, `AOS_PORT` changes the port, `AOS_LIVE_DIR` moves the data folder, `AOS_NOTIFY_DRY=1` prints notifications instead of sending them.

## Privacy

- Everything stays on this machine. The monitor binds 127.0.0.1 only and nothing is sent anywhere. The dashboard is read-only.
- **Not stored:** prompts, command lines (beyond the first word), file contents, tool output, error messages, notification text, environment values.
- **Stored (local log only):** event and tool names, truncated session IDs, agent IDs and types, the first word of a Bash command (when it is a plain word), short labels such as file basenames and the short `description` of Agent/Task tool calls (up to 80 characters, token-like strings redacted; it names the subagent), the full path of files edited by Edit/Write tools (for conflict detection), the full working-folder path of each event (for project grouping), transcript paths (for token counts and model names), notification types, error categories, model IDs, task IDs.
- The API, web UI, terminal view and MCP output show names and counts only, never full paths (a file conflict shows `parent-folder/file`).
- **Guard verdicts (read, not stored):** the monitor reads `aos-orch verify` records from `<orch dir>/verdicts/` and shows the repo's folder name, time, verdict, rejection kinds and details, warnings, failing test names, check commands with exit codes and durations, short commit ids, source and tool version. Absolute paths in that text are reduced to their last component; the full repo path and the session id are never shown (the session id is only matched, by its first 8 characters, to a live session).
- **Guard auto-verify (opt-in, off by default):** when `guard` is set in `config.json`, the Stop hook writes `guard/guard.log` (time, repo folder name, exit code, duration per run), `guard/last-<hash>.log` (the newest run's CLI output, max 256 KB) and a short-lived lock file into the data folder. Nothing is written into the repo.
- Data lives in `${CLAUDE_PLUGIN_DATA}/live` (or `AOS_LIVE_DIR`). The hook log is created owner-only (0600); the seeded `config.json` and `prices.json` keep normal permissions. The hook keeps one rotated copy (`hook-events.1.ndjson`, at 5 MB). Delete that folder to erase it.

## Layout

- `.claude-plugin/plugin.json`: manifest; `hooks/hooks.json`: hook registrations
- `hooks/aos-hook.mjs`, `monitor.mjs`, `ui/`, `cli/`: copies generated by `node plugin/build.mjs` (run `make build` after changing the sources in the repo root)
- `hooks/ensure-monitor.mjs`: SessionStart autostart (idempotent, silent)
- `hooks/aos-guard.mjs`: opt-in guard auto-verify on Stop (copied by the build; does nothing unless `guard` is configured; see docs/dashboard.md)
- `mcp/`: the read-only MCP server; `notify/`: the branded notifier; `bin/`: `aos-dash` and the status-line script; `skills/dash/`: the in-session snapshot skill; `defaults/`: seeded config
