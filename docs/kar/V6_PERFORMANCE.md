# V6 performance

These timings are separate measurements. They are not one combined score. None of them change KAR semantics.

## Public surface

Command: `node scripts/bench-kar-v6-surface.mjs`

Date: 2026-10-11. Node v22.14.0. Thirty repetitions. Median. One committed graph with 3 concepts, 2 relations, and both support and opposition requirements. Status `SATISFIED`.

| Step | Median |
| --- | --- |
| CEG compilation | 1.11 ms |
| Session creation | 0.74 ms |
| Warm evaluation | 0.19 ms |
| Cold verification | 1.05 ms |

Cold verification includes remounting the image and graph and checking the certificate. It does not include the evaluation that produced the result.

## Closure and exact cover

Command: `npm run bench:integration` in `research/kar-1`, rerun on 2026-10-11. The published `scale-results.json` and `cover-results.json` were restored after the run. Every row below was `SATISFIED`.

| Family | Nodes | Closure p50 | Exact cover p50 |
| --- | --- | --- | --- |
| chain degree 1 | 100 | 0.18 ms | 0.10 ms |
| chain degree 1 | 1,000 | 3.59 ms | 0.10 ms |
| chain degree 1 | 10,000 | 178.59 ms | 0.10 ms |
| chain degree 1 | 50,000 | 16290.93 ms | 0.12 ms |
| local degree 3, depth 4 | 100 | 0.08 ms | 0.07 ms |
| local degree 3, depth 4 | 1,000 | 0.43 ms | 0.07 ms |
| local degree 3, depth 4 | 10,000 | 4.15 ms | 0.08 ms |
| local degree 3, depth 4 | 50,000 | 27.47 ms | 0.09 ms |

A long chain makes closure expensive. Exact cover on these benches stays small because the requirement count stays inside the visit budget. `SEARCH_BOUND_EXCEEDED` is the fail-closed result when that budget is exhausted. V6 does not add an approximate cover.

## Published engineering benches

`docs/kar/benchmarks.json` is the 2026-10-10 KAR bench. It splits session creation, cold evaluation, warm evaluation, closure, and cover. It was not rewritten for V6.

`docs/kar/ceg-benchmarks.json` is the 2026-10-10 compiler bench. Compile medians there are 18.37 ms at 100 nodes, 76.77 ms at 1,000, 735.35 ms at 10,000, and 3813.62 ms at 50,000. Those files remain the historical record. The table above is the later integration rerun.
