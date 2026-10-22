# Fenceline (working name)

A live map of where your coding agent goes, with plain-English fences.

Status: Phase 0 (validation). `pilot/` holds the pilot: real `claude -p` sessions on small task repos that each state one
rule, with a logger plugin that records every tool call and every file it changed. Results: `node pilot/summarize.mjs`.

WARNING: `pilot/run.mjs` runs real agents with edit and shell permissions, unsandboxed, in temp copies of the task repos.
