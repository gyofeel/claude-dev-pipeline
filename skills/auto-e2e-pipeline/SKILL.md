---
name: auto-e2e-pipeline
description: Use when a feature is already implemented and needs end-to-end verification from scratch — requirements are scattered, no PRD or test cases exist yet, and the user wants specs that actually run. Also use to resume such a run ("continue the pipeline", "pick up from the TC stage"). For a feature with no code yet, use dev-pipeline:auto-dev-pipeline instead.
---

# Verification pipeline (existing code)

Chains three skills for **code that already exists**, pausing at a human gate between stages:

```
dev-pipeline:prd-extract  →G→  dev-pipeline:tc-extract  →G→  dev-pipeline:e2e-test
requirements                    test cases                    specs + runtime validation
                       G = artifact review gate (user confirms)
```

**Gate contract, slug rules, and the state-file schema live in [references/shared-contract.md](references/shared-contract.md). Read it first and follow it exactly.** `dev-pipeline:auto-dev-pipeline` follows the same document.

## Usage

```
/dev-pipeline:auto-e2e-pipeline                         # from the start (issue key auto-detected from branch)
/dev-pipeline:auto-e2e-pipeline PROJ-1234               # issue key given
/dev-pipeline:auto-e2e-pipeline PROJ-1234 home filter   # issue key + feature hint
/dev-pipeline:auto-e2e-pipeline <feature or slug>       # resume target
/dev-pipeline:auto-e2e-pipeline <prd.md or tc.md path>  # start mid-way
```

## What this command does NOT do (boundaries — mandatory)

- **It does not replace the sub-skills' interviews.** `prd-extract`, `tc-extract`, and `e2e-test` keep their own `AskUserQuestion` flows. This command asks only at **artifact review gates** — otherwise the user answers the same thing twice.
- **It does not modify the sub-skills.** Each runs standalone without this orchestrator; this layer adds only ordering and gates.
- **It does not create artifacts.** Files are always written by the sub-skill.
- **It does not force stage skips.** Existing artifacts are *offered* for skipping; the user decides.

---

## Step 0 — Load config and check for resumable work

### 0-a. Config

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config-load.mjs"
```

Missing or invalid → stop: "No `.agents/pipeline.config.json`. Run `/dev-pipeline:init` first." Use the resolved `worksDir`, `e2e.specsDir`, `issueKeyPattern`, `branchPrefix` below.

### 0-b. State files

```bash
ls <worksDir>/*/state.json 2>/dev/null
```

If any exist, read `pipeline`, `slug`, `next`, and each `stages[].status`.

### 0-c. Resume without a state file

The state file is a convenience, not the source of truth. Infer from artifacts:

```bash
ls <worksDir>/*/prd.md <worksDir>/*/tc.md 2>/dev/null
ls <e2e.specsDir>/ 2>/dev/null
```

If `$ARGUMENTS` is a file path, its basename decides the entry stage (`prd.md` → Step 2, `tc.md` → Step 3). The slug is that file's **parent directory name**.

### 0-d. Resume confirmation → `AskUserQuestion` [only when state or artifacts exist]

**Question**: "Found work in progress. How should we proceed?"
- header: `Resume`
- description: pipeline · slug · completed stages with artifact paths · next stage
- options:
  - `Continue` — resume from `next`
  - `Restart from a stage` — stage named as text (its artifact is overwritten)
  - `Start over` — discard the state file, begin at Step 1. **Existing artifact files are not deleted**

Nothing found → skip to 0-e.

### 0-e. Issue key + early collision check [new work only]

Follow the shared contract: ① `$ARGUMENTS` → ② `git branch --show-current` matched against `issueKeyPattern`. A hit means the user is never asked.

Then run the contract's **early collision check** with that key. A hit routes to 0-d with `Continue` offered. Resumed work already has a slug — skip this step.

---

## Step 1 — Requirements

### 1-a. PRD

`Skill: dev-pipeline:prd-extract`, passing any feature info from `$ARGUMENTS`.

**As soon as the interview settles the feature name**, go to 1-b — this is *before* `prd-extract` saves the file.

### 1-b. Slug confirmation + pre-emption check → PRD save [new work only]

Run the contract's **slug confirmation** and **pre-emption check** in that order, using the feature name from 1-a.

Pass the confirmed slug to `prd-extract` so it saves to `<worksDir>/<slug>/prd.md` (`prd-extract` uses a caller-supplied slug as its default path). Record `slug` and `issue` in the state file.

Then run **Gate G1**.

### Gate G1 — PRD review

- Metrics: `AC N · requirements N · server interface [yes/no/pass] · platform interface [yes/no/pass/n-a] · UI scenarios [yes/no/pass] · open questions N`
- Checklist:
  - required slots (feature name · target screen · acceptance criteria) carry no `?unclear` marker
  - `## Open Questions` entries are tolerable for the next stage

---

## Step 2 — Test case extraction

`Skill: dev-pipeline:tc-extract` with the **PRD path confirmed at G1**.

> This pipeline targets **existing code**, so `tc-extract` takes its changed-files path (`git diff`) as usual. Do not pass new-implementation mode.

Then **Gate G2**.

### Gate G2 — TC review

- Metrics: `TC N (e2e N · manual N) · CP N · overlap warnings N`
- Checklist:
  - checkpoint targets and state paths were confirmed in code (no `[verify: …]` markers left)
  - `E2E suitability` is right — visual/pixel/real-device cases are not marked `e2e`
  - TCs flagged as overlapping existing specs: merge or keep separate

---

## Step 3 — E2E spec generation and validation

`Skill: dev-pipeline:e2e-test` with the **TC path confirmed at G2** (batch mode).

> `e2e-test` owns its own `AskUserQuestion` gates and a runtime retry loop of up to 5 iterations. This orchestrator does not intervene inside it.

Then **Gate G3**.

### Gate G3 — Spec review and completion

- Metrics: `specs generated N · runtime PASS N / SKIP N / FAIL N · skipped (manual) N`
- Checklist:
  - a PASSing spec verifies what was intended (report screenshots, AI verdict rationale)
  - for any SKIP: is the cause "no matching data" or a navigation defect?
- Options: `Done` / `Re-run this stage` / `Stop here` (last stage — no `Continue in a new session`)

On `Done`: mark every stage `done` in the state file and list all artifacts.

---

## Related files

- [references/shared-contract.md](references/shared-contract.md) — **single source** for gates, slug, state file
- `dev-pipeline:prd-extract` · `dev-pipeline:tc-extract` · `dev-pipeline:e2e-test` — orchestrated skills
- `dev-pipeline:auto-dev-pipeline` — 4-stage pipeline for features without code
