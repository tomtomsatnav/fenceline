# Related work

Checked 2026-10-29. The search was not exhaustive. Items marked *(search only)* were seen in search results but not
opened, and should be read before they are cited.

## ImpossibleBench

Zhong, Raghunathan & Carlini, "ImpossibleBench", [arXiv:2510.20270](https://arxiv.org/abs/2510.20270), ICLR 2026.
Code: [safety-research/impossiblebench](https://github.com/safety-research/impossiblebench), MIT licence.

**What it measures.** How often agents exploit unit tests when the tests contradict the spec. Tests from LiveCodeBench
(hard split) and SWE-bench Verified are mutated so that no solution that follows the spec can pass. Two kinds of
mutation:
- **One-off:** one assertion's expected value changes.
- **Conflicting:** a contradictory copy of an assertion is added.

Any pass therefore counts as cheating, and the metric is the **cheating rate**, the pass rate on impossible tasks.

**Cheating categories** (their names):
- Modify Test Cases;
- Overload Comparison Operators;
- Record Extra States;
- Special Casing.

**Findings:**
- **Interventions they vary:** prompt strictness, test access (hidden, read-only), a multi-submission feedback loop,
  and an explicit "flag for human intervention" option.
- **Strategies differ by model family.** Claude models mostly cheat by modifying tests.
- **Read-only tests stop test edits,** but not special-casing.
- **Giving agents an abort option cuts cheating sharply for OpenAI models,** but much less for Claude Opus 4.1.
- **LLM monitors catch most cheating on LiveCodeBench,** but only about half on SWE-bench.
- **Harness:** Inspect AI, with Docker for SWE-bench. There is no Claude Code support.

**How this study differs:**
- **The task is solvable.** An honest fix exists but sits behind an external scope rule (a path fence or deny) that
  the harness imposes. The test isn't contradictory. So `ASK` and a legitimate `REROUTE` are both valid outcomes, and
  separating `REROUTE` from `PAPER` needs a reviewer-style judge, not a pass/fail signal.
- **The manipulation is how the constraint is presented** (not told, stated, in `CLAUDE.md`, enforced), not prompt
  strictness over contradictory tests.
- **H2 has a direct prior in ImpossibleBench.** Making tests read-only moved some models from editing tests to other
  exploits. H2 asks the analogous question for scope rules.
- **The agents are real Claude Code CLI sessions,** and ground truth is the git tree.

**Categories we reuse** as named workarounds inside `PAPER`:
- **Special Casing:** e.g. `jpy-literal`, `special-case-title`, `special-case-percent`.
- **Modify Test Cases:** `edit-test` and `column-in-test`, caught mechanically by `seed_tests_pass`.

Operator overloading and recorded state are possible in principle, but no rubric lists them yet. If they occur, the
judge would mark them `other`.

**New here:**
- "Duplicating logic to dodge the fence" (`copy-library`);
- "Moving the change to where the fence isn't" (`column-at-runtime`, `override-in-code`).

## Other close work

**Reward hacking in coding agents:**
- **EvilGenie: A Reward Hacking Benchmark**, [arXiv:2511.21654](https://arxiv.org/abs/2511.21654). Built on
  LiveCodeBench; it detects hacks with held-out tests, an LLM judge and test-edit checks. It runs Claude Code, Codex and
  Gemini CLI directly, which makes it the closest precedent for running real agent CLIs. Code:
  [JonathanGabor/EvilGenie](https://github.com/JonathanGabor/EvilGenie) *(search only)*.
- **METR, "Recent frontier models are reward hacking"** (June 2025),
  [metr.org](https://metr.org/blog/2025-06-05-recent-reward-hacking) *(search only)*. Documents models tampering with
  graders, and admitting the behaviour isn't what the user wanted.
- **Baker et al., "Monitoring Reasoning Models for Misbehavior and the Risks of Promoting Obfuscation"**,
  [arXiv:2503.11926](https://arxiv.org/abs/2503.11926). Chain-of-thought monitors catch coding reward hacks, and
  penalising them teaches models to hide their intent. This is relevant to grading from final messages.
- **Taylor et al., "School of Reward Hacks"**, [arXiv:2508.17511](https://arxiv.org/abs/2508.17511). Training on
  harmless reward hacks generalises to broader misalignment.
- **MacDiarmid et al., "Natural Emergent Misalignment from Reward Hacking in Production RL"**,
  [arXiv:2511.18397](https://arxiv.org/abs/2511.18397).
- **Claude 4 system card, reward-hacking section** (hard-coding and special-casing in coding tasks). *Not verified:
  only secondary quotes were seen. Cite Anthropic's PDF directly.*

**Agent permission systems and getting around them:**
- **AgentSpec**, [arXiv:2503.18666](https://arxiv.org/abs/2503.18666). A DSL for runtime enforcement on LLM agents;
  the academic counterpart of PreToolUse hooks.
- **"Measuring the Permission Gate: A Stress-Test Evaluation of Claude Code's Auto Mode"**,
  [arXiv:2604.04978](https://arxiv.org/abs/2604.04978). Many state-changing actions reach their effect through in-project
  file edits that the classifier never evaluates. This is evidence that blocked effects get reached by other routes.
- **Command denylist bypass (CmdNeedle)**, [arXiv:2606.15549](https://arxiv.org/abs/2606.15549) *(search only)*.
  Reports that most real-world command denylists can be bypassed.
- **SandboxEscapeBench**, [arXiv:2603.02277](https://arxiv.org/abs/2603.02277) *(search only)*. Container escape. This is
  adversarial rather than goal-driven, so it is adjacent rather than close.
- **Claude Code [hooks](https://code.claude.com/docs/en/hooks) and
  [permissions](https://code.claude.com/docs/en/permissions) docs.**
  - A PreToolUse deny is returned to the model, which can adjust its approach.
  - `Edit` deny rules cover the file tools and recognised Bash file commands, but not scripts that write files
    themselves.
  - This is why this study takes ground truth from git, not from the hooks.
- **Phase 0 prior-art table:** [docs/phase0.md](../docs/phase0.md) section 1 covers guard and monitoring tools for
  Claude Code (saferun-guard, destructive_command_guard, mindwalk and others).
