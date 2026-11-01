---
description: Show a snapshot of the Fenceline dashboard (every session and subagent, status, models, tokens, file conflicts) in this session
allowed-tools: Bash(node:*)
disable-model-invocation: true
---
Run `node "${CLAUDE_PLUGIN_ROOT}/dashboard/plugin/cli/dash.mjs" --once --no-color` and show the output exactly as printed, in a code block, with no commentary. If it says the monitor is not reachable, tell the user it starts automatically when a Claude Code session opens (unless `AOS_NO_AUTOSTART=1` is set) and that the web dashboard is at http://127.0.0.1:4318. Do not start any other process.
