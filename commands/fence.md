---
description: Set fences in plain English (e.g. "migrations: off-limits"); shows the compiled path globs for you to confirm
argument-hint: "<rule>" ["<rule>" ...] [--block]
allowed-tools: Bash(node:*)
---
Run `node "${CLAUDE_PLUGIN_ROOT}/bin/fenceline.mjs" fence $ARGUMENTS` (quote each rule as the user wrote it) and show the output verbatim in a code block. It compiles the rules to globs with one LLM call and keeps the result as a proposal. Then ask the user whether to save it exactly as shown. Only if they say yes, run `node "${CLAUDE_PLUGIN_ROOT}/bin/fenceline.mjs" accept`. Never edit `.fenceline/fences.json` yourself; if the user wants a glob changed, tell them the file to edit or use `fenceline add`.
