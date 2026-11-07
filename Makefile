# Fenceline from a clone: install, check, start and test.   Run `make` for the list of targets.
# Needs Node 18+ and the Claude Code CLI (`claude`). macOS and Linux; on Windows run it from Git Bash.
# Installing from GitHub without a clone is two `claude plugin` commands (see the README); this file is for working
# from a checkout, where the plugin loads straight from this folder.

SHELL   := /bin/bash
REPO    := $(CURDIR)
PORT    ?= 4318
MAP_PORT ?= 4319
PLUGIN  := fenceline@fenceline
MARKET  := fenceline
# Claude Code keeps a plugin's data in plugins/data/<plugin>-<marketplace>; the dashboard's hooks log under live/ there
DATA    := $(HOME)/.claude/plugins/data/fenceline-fenceline
ENSURE  := CLAUDE_PLUGIN_ROOT="$(REPO)" CLAUDE_PLUGIN_DATA="$(DATA)" AOS_PORT=$(PORT) node dashboard/plugin/hooks/ensure-monitor.mjs
STOP    := PORT=$(PORT) node dashboard/scripts/aos.mjs stop
OPEN     = $(if $(filter Darwin,$(shell uname -s)),open,xdg-open)

.DEFAULT_GOAL := help
.PHONY: help install uninstall update doctor start stop restart open map scope test screenshots check

help: ## Show this list
	@echo "Fenceline"; echo
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*## "}{printf "  make %-12s %s\n", $$1, $$2}'
	@echo; echo "First time:  make install   then open a NEW Claude Code session and http://127.0.0.1:$(PORT)"

check:
	@command -v node >/dev/null || { echo "node not found (need 18+)"; exit 1; }
	@node -e 'process.exit(+process.versions.node.split(".")[0] >= 18 ? 0 : 1)' || { echo "node 18+ required"; exit 1; }
	@command -v claude >/dev/null || { echo "claude CLI not found: install Claude Code first"; exit 1; }

install: check ## Install Fenceline from this folder (removes the old aos-dashboard plugin first) and start the dashboard
	@echo "==> removing the old standalone aos-dashboard plugin, if installed"
	-@claude plugin uninstall aos-dashboard@aos-local >/dev/null 2>&1; claude plugin marketplace remove aos-local >/dev/null 2>&1; true
	@echo "==> stopping any dashboard on :$(PORT)"
	-@$(STOP) >/dev/null 2>&1; true
	@echo "==> registering this folder as the $(MARKET) marketplace"
	-@claude plugin marketplace remove $(MARKET) >/dev/null 2>&1; true
	@claude plugin marketplace add "$(REPO)" 2>&1 | tail -1
	@echo "==> installing $(PLUGIN)"
	@claude plugin install $(PLUGIN) 2>&1 | tail -1
	@$(MAKE) --no-print-directory start
	@echo; echo "Done. Next:"
	@echo "  1. Open a NEW Claude Code session in any project (sessions opened before the install keep their old hooks)"
	@echo "  2. Open http://127.0.0.1:$(PORT)   (make open)"
	@echo "  3. Add a fence in that session:  /fenceline:fence"
	@echo "  4. Anything odd:  make doctor"

uninstall: ## Remove the plugin and stop the dashboard (your fences and history stay)
	-@$(STOP) >/dev/null 2>&1; true
	-@claude plugin uninstall $(PLUGIN) 2>&1 | tail -1
	-@claude plugin marketplace remove $(MARKET) 2>&1 | tail -1
	@echo "Removed. Dashboard history is kept in $(DATA); fences and trails in ~/.fenceline (delete them to erase)."

update: ## Pull the latest code and restart the dashboard on it
	@git pull --ff-only
	@$(MAKE) --no-print-directory restart
	@echo "Open a new Claude Code session (or /reload-plugins) to pick up hook changes."

doctor: ## Check the install and say what to fix
	@PORT=$(PORT) node scripts/doctor.mjs

start: ## Start the dashboard on PORT with the plugin's data (normally automatic when a session opens)
	@$(ENSURE); for i in $$(seq 20); do curl -s -o /dev/null -m 1 http://127.0.0.1:$(PORT)/api/state && break; sleep 0.25; done; curl -s -o /dev/null -m 2 -w "dashboard on :$(PORT): HTTP %{http_code}\n" http://127.0.0.1:$(PORT)/api/state || echo "the dashboard did not start: run make doctor"

stop: ## Stop the dashboard on PORT
	@$(STOP)

restart: stop start ## Restart the dashboard (after pulling changes to the monitor or the page)

open: ## Open the dashboard in your browser
	@$(OPEN) http://127.0.0.1:$(PORT) || echo "Open http://127.0.0.1:$(PORT) in your browser"

map: ## Start the repo map in the background on MAP_PORT
	@node bin/fenceline.mjs view --detach --port $(MAP_PORT)

scope: ## Rebuild docs/scope-map.html, the scope map of every eval run
	@node bin/fenceline.mjs scope evals/results -o docs/scope-map.html

test: ## Run every test suite
	@echo "==> fences, map and plugin wiring"; out="$$(npm test --silent 2>&1)" || { echo "$$out" | grep -E "^not ok|error:" | head -20; exit 1; }; echo "$$out" | grep -E '^# (pass|fail)' | tr '\n' ' '; echo
	@$(MAKE) --no-print-directory -C dashboard test

screenshots: ## Regenerate the dashboard screenshots from synthetic demo data (needs the dashboard running and playwright-core)
	@cd dashboard && AOS_URL=http://127.0.0.1:$(PORT) node scripts/screenshots.mjs
	@cp dashboard/docs/screenshots/01-sheet-dark.png docs/dashboard-dark.png && cp dashboard/docs/screenshots/04-fences-dark.png docs/dashboard-fences.png && echo "  copied to docs/dashboard-dark.png and docs/dashboard-fences.png"
