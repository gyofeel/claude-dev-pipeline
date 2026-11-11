---
name: auto-e2e-pipeline
description: Use when a feature is already implemented and needs end-to-end verification from scratch — requirements are scattered, no PRD or test cases exist yet, and the user wants specs that actually run. Also use to resume such a run ("continue the pipeline", "pick up from the TC stage"), or to start verification from a PRD written outside the pipeline. For a feature with no code yet, use dev-pipeline:auto-dev-pipeline instead.
---

# Verification pipeline router (existing code)

```
PRD ─G1→ TC ─G2→ E2E ─G3
 ↑
 └ import (external PRD) ─G1→
```

This skill reads the state, calls the next node, and opens the gate when the node finishes. Nothing else. Nodes (the sub-skills) write the artifacts and make the decisions inside them.

**Read first**: [references/shared-contract.md](references/shared-contract.md) — nodes and deterministic checks · reading check output · routing · external PRD import · node call convention (`--pipeline`) · gates and the next session · slug · state file. Here the state file's `pipeline` is `"auto-e2e-pipeline"` and its stages are `prd-extract` · `tc-extract` · `e2e-test`.

## Usage

```
/dev-pipeline:auto-e2e-pipeline                          # resume the run in progress, or start a new one
/dev-pipeline:auto-e2e-pipeline PROJ-1234 list filter    # issue key + feature hint
/dev-pipeline:auto-e2e-pipeline <slug>                   # resume that run
/dev-pipeline:auto-e2e-pipeline <tc.md path>             # start at E2E
/dev-pipeline:auto-e2e-pipeline <prd path>               # import an external PRD, or resume if it has a state file
```

**Arguments**: a match of config `issueKeyPattern` is the issue key. A file path routes by kind (contract, Routing). Anything else is the feature description or the resume target (slug).

## Step 0 — Config

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config-load.mjs"
```

Missing or invalid → apply "Missing config" in the shared contract's User-facing output, then re-run this step. Use the resolved `worksDir`, `e2e.specsDir`, `e2e.kitDir`, `issueKeyPattern`, `branchPrefix`, `language`, `locale`. Talk to the user in `language` and shape every message by the contract's User-facing output (where we are first, one next action last). Then route (contract, Routing).

## Nodes

| Node | Call | What the human decides at the gate |
|---|---|---|
| PRD | `Skill: dev-pipeline:prd-extract --pipeline` (+ feature description, issue key) — or the contract's External PRD import | slug, which `## Open Questions` items block progress |
| TC | `Skill: dev-pipeline:tc-extract <worksDir>/<slug>/prd.md --mode diff --pipeline <slug>` | `E2E suitability` (visual, pixel or real-device checks not marked `e2e`), whether TCs that overlap existing specs are merged |
| E2E | `Skill: dev-pipeline:e2e-test <worksDir>/<slug>/tc.md --pipeline <slug>` (batch mode) | the report's "needs review" items, whether a SKIP is missing data or a navigation defect |

The deterministic checks (`coverage-gate --lint`: AC coverage and lint) are in the node output. If `ok` is `false`, or `lint.errors` or `uncovered` is non-empty, do not open the gate; re-run the node.

The TC node targets existing code, so it reads selectors from the changed files (`git diff`).

At G3, have the user open the result report (`e2e-report.html`) with `node <e2e.kitDir>/report/open.mjs`. That is a viewer for the human; the router takes the conclusion and the review items from `<worksDir>/<slug>/e2e-report.md` into the gate question.

## Completion report

```
✅ <feature> — <worksDir>/<slug>/  prd.md · tc.md · e2e-report.md
   E2E specs  <e2e.specsDir>/<slug>/  PASS N / FAIL N / SKIP N
```

In `language`, first line `[3/3] …`. End with one next action in plain words: review and commit the specs under `<e2e.specsDir>/<slug>/` and `e2e-report.md`.

## Related

- [references/shared-contract.md](references/shared-contract.md) — single source for routing, gates, slug, state file
- `dev-pipeline:prd-extract` · `dev-pipeline:tc-extract` · `dev-pipeline:e2e-test` — nodes
- `dev-pipeline:auto-dev-pipeline` — the pipeline for features with no code yet
