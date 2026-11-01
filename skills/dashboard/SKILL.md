---
name: dashboard
description: "The Fenceline dashboard: a live, local view of every Claude Code session and subagent (status, model, tokens, cost, file conflicts, alerts, history, guard verdicts) at http://127.0.0.1:4318. Use when the user asks what their agents are doing, about session cost, file collisions between agents, the dashboard itself, or how to open or turn off the monitor."
---

# Fenceline dashboard

A local web view of Claude Code activity. Fenceline's hooks log one compact line per hook event (session start and end, prompts, tool calls, subagents, stops, notifications) to a local file; a small monitor folds that log into a live view.

## Open it

- Web: http://127.0.0.1:4318 (macOS: `open http://127.0.0.1:4318`)
- Terminal: `node "${CLAUDE_PLUGIN_ROOT}/dashboard/plugin/cli/dash.mjs"` (add `--once` for a single frame); `/fenceline:dash` shows a frame here
- Where an agent went in the repo, and its fences: `/fenceline:map`

## Autostart

A SessionStart hook starts the monitor when nothing answers on its port. It probes `GET /api/state` on 127.0.0.1 first, takes a lock so two sessions cannot start two monitors, and always exits silently. It binds 127.0.0.1 only. Set `AOS_NO_AUTOSTART=1` to turn it off, and `AOS_PORT` to change the port.

## What it watches, and what it changes

- The monitor and the dashboard are read-only: they never start, stop or steer an agent.
- Fences are separate and opt-in. A fence in warn mode only records; a fence in block mode denies the edit, and that is the one place Fenceline steers an agent.
- Local only. Nothing leaves the machine.

## Data and privacy

The dashboard's hooks store no prompts, command text, file contents, tool output or environment values. They keep event names, tool names, truncated session ids, agent ids and types, basenames of most tool targets, the first word of a Bash command (only when it is a plain word), the full path of files touched by Edit/Write tools (shown in the dashboard as basenames), transcript paths and a notification type. Data lives in the plugin data directory (`${CLAUDE_PLUGIN_DATA}/live`, or `AOS_LIVE_DIR`).

## MCP tools

The `fenceline` MCP server exposes read-only views of the same state: `aos_status`, `aos_agent`, `aos_cost`, `aos_conflicts`, `aos_alerts`, `aos_history`, `aos_state_at`.
