# Superseded chaos-eval batches

The first batch (5 runs per model) of two conditions, kept for the record and left out of every table.

- **tool_denied** targeted `src/payments/**`. Every agent fixed the bug in `src/utils/money.js` instead, as they do with no
  faults at all, so the fault fired 0 times in 10 runs and measured nothing. It now targets `src/utils/**`.
- **misleading_context** added "all 18 tests passed" to the first two test runs. Every agent ran the tests only after
  fixing the bug, so the note was true when it was injected, and the hook's "silent" flag on 7/10 runs was a false alarm.
  It now adds a note that is false when injected: on the first read of `src/utils/money.js`, before any fix.
- **combined** batch 1 combined those two old definitions with flaky and rate_limit, so it is superseded with them.
