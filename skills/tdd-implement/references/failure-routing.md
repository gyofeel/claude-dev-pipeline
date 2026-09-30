# Failure routing table

Every value comes from `red-gate.mjs` output: `failureClass`, `routeTo`, `consumesFixRound`. The controller applies the row; it never invents a class.

| failureClass | Route | Fix round | Thrash prevented |
|---|---|---|---|
| `ENV` | **User** — report only (run `commands.setup`, reinstall deps, free the port, fix ownership). No auto-install, no `sudo` | **not consumed** | "fixing" healthy tests because the environment is broken |
| `NOT_COLLECTED` | **Controller** — move the test file to a path matching `unitTest.testFileGlobs` (and not `excludedFilePatterns`). Never edit the runner config without explicit user approval | no | implementer misreading `0 failed` as green; several implementers each widening the glob |
| `SKIPPED` | **Controller** — check that `unitTest.runnerArgs` selects the project/config that collects this file, and that no `it.skip` / `it.todo` / stray `.only` remains. **Do not touch production code** | no | reading a test that never ran as "passed at RED" and deleting working code |
| `GREEN_WITHOUT_RED` | **Controller — stop.** Delete (not adapt) the production code and restart from RED | no (rule violation, not a bug) | the #1 TDD-agent failure: implement → write a passing test → report DONE. **Indistinguishable from real TDD in the final diff** |
| `WRONG_REASON{module}` | **Implementer, test file only** — module-level failure (import, module-scope state, syntax) | consumed | papering over a broken test with production code |
| `WRONG_REASON` | **Implementer, test file only** (no production code this round) | consumed | same |
| `WRONG_REASON` timeout on the same `(file,test)` **twice in a row** (ledger lookup) | **User — stop.** "This check appears to exceed the unit-test boundary. Set this TC's `Unit target` to `(none)` and hand it to E2E?" | no | burning 5 rounds on something in `unitTest.excludedAreas` |
| `TARGET_NOT_FOUND` / `TARGET_AMBIGUOUS` | Implementer — align the `it('UCP-NN: …')` name with `--test` | consumed | — |
| `STILL_RED` | Implementer — normal SDD fix round (attach `subClass`) | consumed | — |
| `COLLATERAL_RED`, failing test **inside** plan `Files:` | Implementer — name the failing test | consumed | — |
| `COLLATERAL_RED`, failing test **outside** plan `Files:` | **User — stop.** Shared code outside the declared surface was touched | no | the two worst agent "repairs": fixing pre-existing failures it did not cause, deleting failing tests |
| pre-commit hook blocked (formatter / lint check) | Implementer — run `commands.format`, recommit. **Never `--no-verify`** | no | hook bypass accumulating format debt |
| TC / PRD contradictory or insufficient | Report to user; when the conclusion overturns a requirement, run the Upstream rewind procedure (SKILL.md) | no | implementing imagined requirements; a dropped requirement left in the docs and flagged as unimplemented next round |
| Code and a PRD spec value (URL, key basis, field) differ | **User — report before changing code**; check the spec source the PRD cites | no | "fixing" correct code to match a PRD that mis-copied the spec |

Cost tiers: deterministic gates run as direct Bash (no LLM re-spawn); per-task green runs one file; the full suite (`--all`) runs once at the final gate.
