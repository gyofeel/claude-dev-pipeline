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

## Real project check — 2026-11-11

An existing admin front end (Vite, MSW mocks, kit 0.1.0) loaded the plugin with `--plugin-dir`. Steps: kit upgrade to 0.2.0, config `language: ko` / `locale: en`, one spec through the interview, `coverage-gate --prd --lint` on all 31 existing PRDs, and one external PRD import up to G1.

| Step | Outcome |
|---|---|
| Kit upgrade | `check-kit-dir` ok; old analyzer files removed; Step 3b flagged service worker, archive reporter and trace |
| Config | `config-load --check`: 0 warnings. Blocking workers stopped the app from mounting (it waits for its MSW worker), so the test server turns the mock flag off |
| Spec | 1 spec, 3 DOM checkpoints, PASS on the first run; report opened |
| PRD lint | 31/31 ok, 0 errors, 1 warning each (no publishing source table) |
| Import | external PRD entered at G1, state written, resume command printed |

### Defects found and fixed

| Symptom | Fix |
|---|---|
| Every spec imported `captureFailureDiagnostics` and `captureNavigationCensus`; a static spec never calls them, so the project's ESLint (`no-unused-vars`) blocked the pre-push hook. | The assembler imports them only when `setupBody` / `slotBody` / `testBody` calls them (or the slot is left open). |
| `hasText(Live)` compiled to `toContainText(Live)` and threw a ReferenceError at run time. | The assembler stops on an unquoted `hasText` argument; strings and regexes pass. |
| `${CLAUDE_PLUGIN_ROOT}` is expanded in SKILL.md and agent bodies only, not in reference files or the Bash shell, so commands copied from references failed. | Every SKILL.md states the plugin root once and says to use it for commands taken from reference files and to pass it to agents. |
| `.gitignore` additions do not untrack report files committed earlier; they showed as modified after every run. | `e2e-init gitignore` returns `stillTracked`; the skill offers `git rm --cached`. |
| `report/open.mjs` hung when piped (`tee`, CI): the detached server inherited stderr. | stderr is piped and released with stdout. |
| Fixtures must be JSON; nothing said so. Projects with code-module mocks had to inline data. | config-schema documents it. |
| e2e-init Step 3b gave no example for an app that needs its worker to boot. | One example: turn the mock flag off in `webServer.env`. |

### Left as is

- The publishing-source warning fires on every legacy PRD: a warning, not an error, and accurate.
- `testMode` is not shown in the report; the confusion was in the spec header, which e2e-test now explains.
