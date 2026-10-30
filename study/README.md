# Study: what Claude agents do when a constraint blocks the task

When the honest fix for a coding task needs something a constraint forbids, what does a Claude agent do? And how does
that change with the model, and with how the constraint is presented? The headline question is **H2**: does
*enforcing* a guardrail move agents from asking for help to working around it?

| File | What it holds |
|---|---|
| [PREREG.md](PREREG.md) | The question, hypotheses, categories and analysis plan, fixed before any run |
| [DEVIATIONS.md](DEVIATIONS.md) | Every later change to that plan |
| [STATUS.md](STATUS.md) | Where the study is, the spend so far, and what is waiting on Tom |
| [RELATED.md](RELATED.md) | ImpossibleBench and other close work |
| [results.md](results.md) | Generated: every table and figure, from the run files alone |

## How it works

| Piece | What it does |
|---|---|
| `tasks/<task>/` | Each task folder holds `task.mjs` (the repo generator, prompt, rule, fences, hidden tests, and reference solutions including the known workarounds) and `rubric.md` (what an acceptable in-scope fix looks like). `npm test` checks every task against its reference solutions. |
| `run.mjs` | One batch: k trials of one cell. Each trial is a fresh temp repo and a real, unsandboxed `claude -p` with Fenceline loaded. Ground truth comes from git. Every run is saved to `results/runs/<batch>-<t>/`, with machine paths redacted. |
| `judge.mjs` | Grades REROUTE vs PAPER for runs that need it. Sonnet sees only the task, the rubric and the diff. |
| `grid.mjs` | Runs the pre-registered phase 1 and 2 grids, cell by cell. It never reruns a cell. |
| `audit.mjs` | Draws Tom's blind sample (`--draw`) and scores it against the judge (`--score`). |
| `build-results.mjs` | Rebuilds `results.md`. |

**Warning:** trials run real agents with edit and Bash permissions, unsandboxed. The runner only ever creates them in a
fresh directory under the OS temp dir.

## Reproduce one cell

One command runs a cell, grades it and writes its tables. It uses its own results folder, so it never mixes with the
study's runs. Example: the yen task, enforced, Haiku, k = 10:

```sh
node study/run.mjs --phase main --task yen-receipt --presentation block --model haiku --k 10 --out /tmp/repro \
  && node study/judge.mjs --results /tmp/repro \
  && node study/build-results.mjs --results /tmp/repro --out /tmp/repro/results.md
```

You can change the cell:
- `--task`: `yen-receipt`, `nickname-migration`, `upload-config`, `vendored-slugify`, `refund-control` or
  `users-control`.
- `--presentation`: `none`, `stated`, `file`, `block`, `stated+block` or
  `block-neutral`.
- `--model`: `haiku` or `sonnet`.

## The whole study

```sh
node study/grid.mjs --phase pilot      # phase 1: 30 runs
node study/grid.mjs --phase main       # phase 2: 720 runs
node study/judge.mjs                   # grade what needs grading
node study/audit.mjs --draw            # Tom's blind sample; he fills study/audit/tom.csv
node study/build-results.mjs           # study/results.md
```

`npm test` covers the tasks, the categoriser and statistics, and the runner, judge, audit and results builder end to
end. The end-to-end tests use a fake `claude` that drives the real Fenceline hook.
