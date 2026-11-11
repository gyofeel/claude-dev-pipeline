---
name: auto-dev-pipeline
description: Use when starting a feature that has no code yet and the user wants to go from scattered requirements to working, tested code — "kick off this feature", "build it with TDD from the requirements", "requirements through implementation". Also use to resume such a run, to start from a PRD written outside the pipeline, or when the user wants to stop after implementation and leave E2E for later ("skip E2E", "implementation only"). For code that already exists and only needs verification, use dev-pipeline:auto-e2e-pipeline.
---

# Development pipeline router (new feature, no code yet)

```
PRD ─G1→ TC ─G2→ PLAN ─G3a→ IMPL ─G3→ E2E ─G4
 ↑                                  └ -no-e2e: ends at G3 (E2E can be resumed later)
 └ import (external PRD) ─G1→
```

This skill reads the state, calls the next node, and opens the gate when the node finishes. Nothing else. Nodes (the sub-skills) write the artifacts and make the decisions inside them.

**Read first**: `../auto-e2e-pipeline/references/shared-contract.md` — nodes and deterministic checks · reading check output · routing · external PRD import · node call convention (`--pipeline`) · gates and the next session · slug · state file. Here the state file's `pipeline` is `"auto-dev-pipeline"` and its stages are `prd-extract` · `tc-extract` · `tdd-plan` · `tdd-impl` · `e2e-test`.

## Usage

```
/dev-pipeline:auto-dev-pipeline                          # resume the run in progress, or start a new one
/dev-pipeline:auto-dev-pipeline PROJ-1234 list filter    # issue key + feature hint
/dev-pipeline:auto-dev-pipeline <slug>                   # resume that run
/dev-pipeline:auto-dev-pipeline <tc.md or *-plan.md path>  # start at PLAN or IMPL
/dev-pipeline:auto-dev-pipeline <prd path>               # import an external PRD, or resume if it has a state file
/dev-pipeline:auto-dev-pipeline -no-e2e PROJ-1234        # stop after implementation
```

**Arguments**: `-no-e2e` is recorded in the state's `options`. A match of config `issueKeyPattern` is the issue key. A file path routes by kind (contract, Routing). Anything else is the feature description or the resume target (slug).

## Step 0 — Config

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config-load.mjs"
```

Missing or invalid → apply "Missing config" in the shared contract's User-facing output (`../auto-e2e-pipeline/references/shared-contract.md`), then re-run this step. Use the resolved `worksDir`, `e2e.specsDir`, `e2e.kitDir`, `issueKeyPattern`, `branchPrefix`, `language`, `locale`. Talk to the user in `language` and shape every message by the contract's User-facing output (where we are first, one next action last). Then route (contract, Routing).

## Nodes

| Node | Call | What the human decides at the gate |
|---|---|---|
| PRD | `Skill: dev-pipeline:prd-extract --pipeline` (+ feature description, issue key) — or the contract's External PRD import | slug, which `## Open Questions` items block progress |
| TC | `Skill: dev-pipeline:tc-extract <worksDir>/<slug>/prd.md --mode new --pipeline <slug>` | unit / E2E / manual classification, the implementation owner of each TC without a unit test (`implement` / `split <issue key>` / `existing`), scope |
| PLAN | `Skill: dev-pipeline:tdd-implement <worksDir>/<slug>/tc.md` | whether the plan's test code (the RED contract) captures the requirements correctly |
| IMPL | `Skill: dev-pipeline:tdd-implement <worksDir>/<slug>/<slug>-plan.md` | missing ACs, rulings and upstream deviations (keep or rewind), unreachable code, new component-scoped styles |
| E2E | see "E2E node" below | the spec results' review items |

`dev-pipeline:tdd-implement` opens the PLAN and IMPL gates (G3a, G3) itself, puts the progress question into that same `AskUserQuestion`, and updates the `tdd-plan` / `tdd-impl` stages. The router does not ask again: it updates `next` and carries out the progress answer tdd-implement returns.

After the last gate's `Done` (G4, or the completion report when the E2E node finishes without E2E TCs), the router runs `superpowers:finishing-a-development-branch`. With `-no-e2e`, tdd-implement already ran it at G3.

**The deterministic checks are already in the node output.** The gate never re-asks them as a checklist.
- G1: `coverage-gate --prd --lint`
- G2: `coverage-gate --prd --tc --lint` (AC coverage + TC lint)
- G3a: `coverage-gate --prd --tc --plan --lint`
- G3: `red-gate --all` audit · `surface-gate` · `coverage-gate`

The exact commands and how to read their output are in the contract. If `ok` is `false`, or `lint.errors` or `uncovered` is non-empty, do not open the gate; re-run the node.

**The implementation owner, not the verification layer, decides what gets built.** A TC without a unit test still gets a wiring task in PLAN when its owner is `implement`. PLAN is never skipped, even with zero unit TCs: for a feature with no code, zero unit TCs means all of the implementation is on the screen side, not that nothing needs building.

## E2E node

1. **No E2E TCs → finish.** Count the TCs whose `E2E suitability` is `e2e` (row labels follow config `locale`):
   ```bash
   grep -cE '^\| \*\*E2E suitability\*\* \| `?e2e' <worksDir>/<slug>/tc.md      # locale en
   grep -cE '^\| \*\*E2E 적합성\*\* \| `?E2E 가능' <worksDir>/<slug>/tc.md        # locale ko
   ```
   Zero → regardless of options, set the stage to `{ "status": "skipped", "skipReason": "no E2E TCs" }`, set `next` to `null`, and give the completion report.
2. **`-no-e2e` → do not run.** Set the stage to `{ "status": "skipped", "skipReason": "-no-e2e option" }`, leave `next` as `"e2e-test"`, and give the completion report. The command to continue is `/dev-pipeline:auto-dev-pipeline <slug>`.
   - Calling a run whose `next` is `e2e-test` again means resuming E2E. Remove `-no-e2e` from the state's `options` and go to 3.

   The reports of 1 and 2 include surface-gate `vanishedTokens`. Without an E2E run it is the only signal that existing specs broke silently.
3. **Refresh the predicted selectors.** The TC node's checkpoint selectors and state paths were predicted from sibling files while no code existed. Run the `dev-pipeline:ui-selector-extractor` agent on the implementation files that now exist and correct, in place, the checkpoint tables of the `e2e` TCs and the selectors and conditions (e.g. focus markers) in their `Entry path` sub-sections. If the implementation changed only logic files, run it on the screen file the checkpoint selectors point to (the TC's `Implementation surface`, the page of the start URL). Edit only the rows that change; never bulk-replace across the file. The same selector also appears in manual TCs' notes and changes with them. In each refreshed TC, delete the `> Predicted selectors for new implementation — verify after implementing` note (or its `locale` wording) from `#### Notes`. Record `selectorsRefreshed: true` in the state so it is not done twice.
   - **Missing fixtures.** e2e-test never creates fixtures, so the router does it here. List the `**Fixtures**` files of the `e2e` TCs that do not exist under `e2e.fixturesDir`. None → go on. Otherwise ask once, showing each file with the content its TC's `#### Preconditions` describe: `Create them` (write exactly that content) / `I'll add them` (wait, then re-check) / `Run without them` (the specs mock those globs with `{}`; the report shows the gap).
4. `Skill: dev-pipeline:e2e-test <worksDir>/<slug>/tc.md --pipeline <slug>` (batch mode).
5. At G4, have the user open the result report (`e2e-report.html`) with `node <e2e.kitDir>/report/open.mjs` to see its "needs review" items. That is a viewer for the human; the router takes the conclusion and the items from `<worksDir>/<slug>/e2e-report.md` into the gate question. A `NO_CANDIDATE` SKIP caused by a wrong predicted selector → correct the TC's checkpoint table with the real value. If G4 decisions changed the TC or a spec, run the B-Step 6 command block from `../e2e-test/references/batch-mode.md` again to rebuild `e2e-report.md` before finishing, and first remove the approved needs-review markers (`[verify` / `ko`: `[확인 필요`) from the TC and spec descriptions.

## Completion report

In `language`; the first line says where we are (`[5/5] …` / `[4/4] …`).

```
✅ <feature> — <worksDir>/<slug>/
   prd.md · tc.md · <slug>-plan.md · red-evidence.jsonl · e2e-report.md
   unit tests N passing · E2E specs N PASS
```

The one next action is the `superpowers:finishing-a-development-branch` question that follows. Before it, list what the E2E node left uncommitted (`git status --short -- <e2e.specsDir>/<slug> <e2e.fixturesDir> <e2e.kitDir> playwright.config.* .gitignore`); the implementation commits do not include them. Non-empty → ask whether to commit them to this branch first, and commit only on a yes.

With E2E skipped by `-no-e2e`, replace the last line with the two below. The one next action is resuming E2E later, alone in a code block: `/dev-pipeline:auto-dev-pipeline <slug>` (finishing-a-development-branch already ran at G3).

```
   unit tests N passing · E2E skipped (-no-e2e) — N E2E TCs remain
   surface-gate vanishedTokens: <list or none>
```

## Related

- `../auto-e2e-pipeline/references/shared-contract.md` — single source for routing, gates, slug, state file
- `dev-pipeline:prd-extract` · `dev-pipeline:tc-extract` · `dev-pipeline:tdd-implement` · `dev-pipeline:e2e-test` — nodes
- `${CLAUDE_PLUGIN_ROOT}/scripts/red-gate.mjs` — RED/GREEN gate; ledger `<worksDir>/<slug>/red-evidence.jsonl`
