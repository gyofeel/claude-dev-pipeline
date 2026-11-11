# Manual run — 2026-11-11

One full `auto-dev-pipeline` run of plugin `c81f3dc` (v0.4.0 candidate) on a throwaway app: a static list page served by a 40-line Node server, Vitest for unit tests, Playwright for E2E. Config: `language: ko`, `locale: ko`. Gates answered with the recommended option.

## Result

| Node | Gate | Outcome |
|---|---|---|
| PRD | G1 | 8 ACs. `coverage-gate --lint` clean |
| TC | G2 | 8 TCs (6 E2E, 1 unit-only, 1 manual) |
| PLAN | G3a | 2 tasks: pure filter function, then markup and wiring |
| IMPL | G3 | 2 commits. RED ledger: 8 RED → 8 GREEN, all `OK_RED` / `OK_GREEN` |
| E2E | G4 | 6 specs, each PASS on its first loop. Report conclusion "Approvable", PASS 6 · FAIL 0 · SKIP 0 |

PRD → plan approval took about 15 minutes; IMPL about 7.

## Defects found and fixed

| Symptom | Fix |
|---|---|
| G3 needs the branch start commit, but nothing said how to find it. The agent guessed `main`; the repo had only `master`, so `git merge-base HEAD main` failed. | The state file records `baseCommit` at creation. `surface-gate` resolves the base itself (`--base` · `--state` baseCommit · merge-base with origin/HEAD, main, master, develop) and reports `base` / `baseSource`; G3 reuses that base. No match → `ok: false`, ask the human. |
| After E2E, `npx vitest run` failed: Vitest's default include collected `e2e/specs/*.spec.js`. Nothing in the pipeline noticed. | E2E final run checks `commands.unitTestList` for paths under the spec dir and raises it as a G4 decision with the fix. |
| A fixture the TC listed did not exist. IMPL does not create fixtures and e2e-test never does. | The router's E2E node lists missing TC fixtures and offers to create them from the TC preconditions. |
| A permission-denied Playwright call came back as ENV and fell under "retry once automatically". | Runtime loop: a permission denial is asked at once, never retried. |
| `testMode: 'real-api'` read as "no mocks" to both writer and reviewer. | e2e-test documents it as "not isolated": mapped fixtures still answer. |
| The "predicted selectors" note stayed in the TC after the selectors were refreshed. | The refresh step deletes it. |
| specs, fixtures, kit and Playwright config were uncommitted when `finishing-a-development-branch` started; only the 2 implementation commits merge. | The completion report lists them and asks whether to commit them first. |
| spec-writer saved inputs under a literal `${TMPDIR}` folder (Write does not expand variables). | spec-writer resolves the folder in Bash first. |

## Left as is

- Every spec imports `captureNavigationCensus` even when unused: intended, the body slot may call it and the assembled file is never hand-edited.
- The archive reporter prints two `[archive]` lines (`report:` and `saved:`): two different facts.
- The runtime loop dispatches one validator per spec even when all pass first time (6 agents here). A batch pre-run is a possible later optimisation.
- "Filter clicks do not refetch" went manual: no checkpoint type asserts request counts, although the report already counts requests per test.

External PRD import (plan Task 21 Step 3) is checked in the euxp-admin run instead.
