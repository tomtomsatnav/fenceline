# Fenceline dashboard

**Part of [Fenceline](../README.md).** This folder is the live dashboard that used to be the AOS dashboard
([agent-orchestration-standard](https://github.com/tomtomsatnav/agent-orchestration-standard)), moved here with its history.
Installing Fenceline installs the dashboard too: Fenceline's plugin runs its hooks, starts its monitor and serves it at
http://127.0.0.1:4318. Fenceline adds its fences to the dashboard's Guard panel and to Needs you.

**Do not also install the standalone `aos-dashboard` plugin** (`make install` below): both would log every hook event and
start a monitor on the same port. `make install` and the rest of this README describe the standalone build, kept for
development (`make test`, `make build`) and for anyone who wants the monitor without fences.

The graph draws static lines coded by status (running solid, stalled and errored dashed, idle faint); the particle
streams and the Streams button are gone.

**A read-only live monitor for Claude Code.** It shows what your sessions and subagents are doing (agents, tasks, tokens, cost, file conflicts, alerts) as a streaming graph in the browser, a terminal view (`aos-dash`), an MCP server and a status line. It never starts, stops or steers agents. Local-only, zero dependencies.

Looking for orchestration (planning goals, launching and managing workers)? That is a different, separate and **experimental** project: [aos-orchestrator](https://github.com/tomtomsatnav/aos-orchestrator), opt-in. This dashboard can display its goals, nothing more.

| Which piece do I want? | Repo | What it is |
|---|---|---|
| Watch my Claude Code agents live | this repo (dashboard) | Read-only monitor. Start here. |
| A standard for observable agent state | [aos-1-spec](https://github.com/tomtomsatnav/aos-1-spec) | Open spec: heartbeat, plain-file state, event log. |
| Have agents planned and run for me | [aos-orchestrator](https://github.com/tomtomsatnav/aos-orchestrator) | Experimental engine that launches real `claude` workers. |

<p align="center">
  <img src="../docs/dashboard-dark.png" alt="The Fenceline dashboard: a project graph of sessions and subagents, lines coded by status" width="900"><br>
  <sub>The live dashboard on a synthetic demo dataset. More in <a href="docs/screenshots.md">docs/screenshots.md</a>.</sub>
</p>

## Install the dashboard

Needs Node 18+ and the Claude Code CLI (`claude` on your PATH; the installer checks and stops with a message if not). No dependencies to install. On Windows it also needs the full Git for Windows (its bash runs the recipes; MinGit has none) and GNU make (`winget install ezwinports.make`); `make` then works the same from Git Bash, cmd and PowerShell (except `make test`: the test suites still need Linux or macOS).

```sh
git clone https://github.com/tomtomsatnav/agent-orchestration-standard && cd agent-orchestration-standard
make install        # ~4 s. Builds, installs the local plugin, links `aos-dash`, starts the monitor
make doctor         # checks the whole setup and tells you what to fix
make                # lists every target
```

`make install` changes only: the Claude Code plugin (user scope, via `claude plugin install`), a symlink `~/.local/bin/aos-dash` (on Windows, two launcher scripts there instead: `aos-dash` for Git Bash and `aos-dash.cmd` for cmd and PowerShell; add that folder to your PATH if `aos-dash` is not found), a small notifier app under `~/.claude/plugins/data/`, and a monitor process on port 4318 (`make install PORT=4328` uses another port). `make uninstall` reverses it. `make stop` and `make uninstall` stop only the monitor on PORT (4318 unless you pass `PORT=`). `make doctor` shows "no hook log yet" until you start a Claude Code session; that is normal.

Then start a new Claude Code session and open http://127.0.0.1:4318 (the page is empty until a session sends events; `aos-dash` is the same view in the terminal). Local-only, read-only; hooks never log prompts, file contents or tool output, but do log event and tool names, working-folder and edited-file paths, transcript paths and a redacted short task description (full list: [plugin/README.md](plugin/README.md#privacy)). Status: personal project, macOS-first. [MIT License](LICENSE).

**Lowest overhead:** run `aos-dash` for the terminal view (no browser tab, no animation), and set the graph's `Streams` button to `Lines`.

<p align="center"><a href="docs/screenshots.md"><img src="docs/screenshots/08-terminal.png" alt="Terminal dashboard (aos-dash)" width="620"></a></p>

## Docs

- [aos-1-spec](https://github.com/tomtomsatnav/aos-1-spec): normative specification, schemas, conformance validator, reference runner
- [aos-orchestrator](https://github.com/tomtomsatnav/aos-orchestrator): orchestrator engine and its design doc
- [docs/dashboard.md](docs/dashboard.md): the Claude Code dashboard, highlights, debugging, security and threat model
- [docs/dashboard.md#guard-view](docs/dashboard.md#guard-view): the Guard view (verify verdicts on sessions, Needs-you on integrity rejections) and the opt-in auto-verify Stop hook
- [docs/architecture.md](docs/architecture.md): how events flow from hooks to the UI
- [docs/screenshots.md](docs/screenshots.md): screenshot gallery
- [docs/cross-machine.md](docs/cross-machine.md): opt-in, read-only view of agents and usage across several machines over your existing SSH access (no new ports)
- [docs/otel.md](docs/otel.md): optional exact cost from Claude Code's OpenTelemetry metrics (main vs subagent, by subagent type)
- [docs/overhead.md](docs/overhead.md): measured monitor CPU and memory
- [docs/orch-state-contract.md](docs/orch-state-contract.md): the on-disk layout the dashboard reads from an orchestrator
- [plugin/README.md](plugin/README.md): plugin details and the exact privacy field list

## Contributing

Issues and small pull requests are welcome. Edit the sources in the repo root (`monitor.mjs`, `hooks/`, `ui/`, `cli/`), then run `make build` and `make test`; keep it zero-dependency and Node 18 compatible.
