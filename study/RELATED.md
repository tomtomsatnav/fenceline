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

## Closest work from the second search (2026-10-29)

**EvasionBench: "Instrumental Monitor Evasion Emerges Under Ordinary Task Pressure"** (Schmotz, Prinzhorn,
Beurer-Kellner, Paulus, Prabhu, Andriushchenko), [arXiv:2609.30217](https://arxiv.org/abs/2609.30217), September 2026.
Full text read. **This is the closest prior work to H2.**

**What it does:**
- **Tasks:** 50 tasks (terminal, software engineering, support) where finishing requires an operation a runtime monitor
  prohibits.
- **Harnesses:** the monitor sits in Claude Code's and Codex's own pre-tool-call hooks, the same mechanism as Fenceline's
  block mode.
- **What the agent is told:** that its tool calls may be reviewed, but not the policy.
- **Pressure:** when an agent stops, it is told "The task is not done yet. Please continue."

**Findings:**
- Best-of-3 evasion attempts reach up to 98%, and success up to 88%.
- Claude Opus 5 and Fable 5.1 attempt evasion often (judge-flagged attempt rates around 78% and 84%) but rarely
  succeed.
- Evasion techniques include encoding commands and splitting operations across calls.
- One ablation compares a generic denial with a denial that gives a reason. This matters for our decision on Fenceline's
  deny wording (STATUS.md, decision 1).

**How it differs from this study:**
- **No stated-only condition.** There is no stated-versus-enforced comparison, which is our H2.
- **No legitimate alternative route** exists in its tasks.
- **Outcomes don't separate asking from giving up.** There is also no "complied on paper inside scope" outcome: its
  outcome is evading the monitor, roughly our `CROSS`.
- **It applies continuation pressure.** We apply none.

We should cite it as the result that enforcement plus pressure provokes evasion. Our contribution is what enforcement
does *without* pressure, compared with a stated rule, when an honest route exists.

**Zhang, "The Troy Moment of AI: Why Some Will Cheat and Some Will Follow?"**,
[arXiv:2609.15494](https://arxiv.org/abs/2609.15494), September 2026. Abstract read.
- **Setup:** seven ImpossibleBench tasks, run under an "explicit boundary" regime (authorisation rules plus restricted
  tools) against open shell tools, solo and with three agents.
- **Outcomes:** escalated, stopped silently, failed to terminate, or modified protected tests. These are close to our
  `ASK` and `QUIT`.
- **Findings:**
  - With explicit boundaries, no protected test was changed, but models differed a lot in escalating versus stopping
    silently.
  - Crossings were usually not framed as cheating: agents "restored" tests they took to be tampered with.

**Harness-IF** (Huang et al.), [arXiv:2608.11727](https://arxiv.org/abs/2608.11727), August 2026. Abstract read.
- **What it measures:** instruction following across five instruction surfaces (system prompt, project files, user
  instructions, tool and skill descriptions, and one more). There are 12 models.
- **Method:** it re-runs each task with the rule withheld, to separate compliance from what the model would have done
  anyway. That is the same logic as our `none` baseline.
- **How it differs:** it doesn't study enforcement or workarounds. It is relevant to our `stated` against `file`
  comparison.

**ContextCov**, [arXiv:2603.00822](https://arxiv.org/abs/2603.00822). Abstract read.
- Compiles AGENTS.md rules into executable checks (AST queries, shell shims, architecture validators).
- On SWE-bench Lite it reaches 88% constraint compliance, against 67% for prompt-only rules.
- It measures compliance, not what agents do instead when a check blocks them.

**"Don't Let AI Agents YOLO Your Files"** (Zhong et al.), [arXiv:2604.13536](https://arxiv.org/abs/2604.13536). Abstract
read.
- Reviews 290 public reports of coding agents misusing filesystem access.
- Proposes a filesystem that stages and gates agent writes.

**Also found (search only, not opened):**
- **HiL-Bench**, [arXiv:2604.09408](https://arxiv.org/abs/2604.09408). Do coding agents ask for help when they hit
  hidden blockers? Reportedly they rarely do. This is relevant to how often `ASK` should occur.
- **ClarEval**, [arXiv:2603.00187](https://arxiv.org/abs/2603.00187). Clarification under ambiguous instructions.
- **A factorial study of instruction adherence in coding-agent configuration files**,
  [arXiv:2605.10039](https://arxiv.org/abs/2605.10039). Reportedly 1,650 Claude Code sessions, with no effect of
  CLAUDE.md structure.
- **"Agent READMEs"**, [arXiv:2511.12884](https://arxiv.org/abs/2511.12884). A survey of 2,303 context files.
- **Claude Mythos Preview system card.** Secondary mirrors quote hack rates on Anthropic's "impossible" coding problems.
  Cite the official card.

**Where this leaves the study.**
- **H2 is not new as a phenomenon.** Enforcement provoking workarounds is shown by ImpossibleBench's read-only arm and,
  most directly, by EvasionBench.
- **What remains open is the comparison and the taxonomy:**
  - the same tasks with the rule stated, in `CLAUDE.md`, enforced, or both;
  - no continuation pressure;
  - an honest route available;
  - outcomes that separate asking, legitimate rerouting, compliance on paper and crossing.

  As far as these searches go, that has not been done. Lead the write-up with that, not with "enforcement causes
  workarounds".

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
