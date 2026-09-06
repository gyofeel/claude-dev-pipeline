---
name: auto-dev-pipeline
description: Use when starting a feature that has no code yet and the user wants to go from scattered requirements to working, tested code — "kick off this feature", "build it with TDD from the requirements", "requirements through implementation". Also use to resume such a run, or when the user wants to stop after implementation and leave E2E for later ("skip E2E", "implementation only"). For code that already exists and only needs verification, use dev-pipeline:auto-e2e-pipeline.
---

# Development pipeline (new feature, no code yet)

Chains four skills for **a feature with no code**, pausing at a human gate between stages:

```
dev-pipeline:prd-extract →G→ dev-pipeline:tc-extract →G→ dev-pipeline:tdd-implement →G→ dev-pipeline:e2e-test
requirements                 TCs (new-impl mode)          TDD implementation             specs + runtime validation
                                  G = artifact review gate (user confirms)

with -no-e2e:  … → dev-pipeline:tdd-implement →G→ (end)
```

**Gate contract, slug rules, and the state-file schema are defined once in `../auto-e2e-pipeline/references/shared-contract.md`. Read it and follow it exactly.** Only the state file's `pipeline` value differs: `"auto-dev-pipeline"`.

## Usage

```
/dev-pipeline:auto-dev-pipeline                          # from the start (issue key auto-detected from branch)
/dev-pipeline:auto-dev-pipeline PROJ-1234                # issue key given
/dev-pipeline:auto-dev-pipeline PROJ-1234 home filter    # issue key + feature hint
/dev-pipeline:auto-dev-pipeline <feature or slug>        # resume target
/dev-pipeline:auto-dev-pipeline <prd.md or tc.md path>   # start mid-way
/dev-pipeline:auto-dev-pipeline -no-e2e                  # stop after implementation
/dev-pipeline:auto-dev-pipeline -no-e2e PROJ-1234        # option + issue key
```

## Argument parsing

Extract three things from `$ARGUMENTS`, in any order:

| Item | Pattern | Effect |
|---|---|---|
| **Option** `-no-e2e` | literal | **Step 4 (E2E) is not run.** Finish after the implementation gate (G3) |
| **Issue key** | config `issueKeyPattern` (e.g. `PROJ-1234`) | slug prefix; if absent, taken from the branch name (shared contract) |
| **Feature hint / path** | remaining text | new work: draft feature name; resume: target (feature, slug, or file path) |

No option → default: run through Step 4.

Record options in the state file's `options` array. On resume they are restored, but **options given at resume time win** (e.g. stopped with `-no-e2e`, resumed without it → E2E runs).

> **`-no-e2e` keeps the TC file's screen-level cases intact.** Run `/dev-pipeline:e2e-test <tc path>` later, or resume this pipeline without the option. The completion report prints both commands.

## What this command does NOT do (boundaries — mandatory)

- **It does not replace the sub-skills' interviews.** All four keep their own `AskUserQuestion` flows; this command asks only at **artifact review gates**.
- **It does not modify the sub-skills.** Each runs standalone.
- **It does not create artifacts.** Files are always written by the sub-skill.
- **It does not implement code.** `tdd-implement` delegates that to `superpowers:subagent-driven-development`.

---

## Step 0 — Load config and check for resumable work

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config-load.mjs"
```

Missing or invalid → stop: "No `.agents/pipeline.config.json`. Run `/dev-pipeline:init` first."

Same as `auto-e2e-pipeline` Step 0, with one extra artifact to look for:

```bash
ls <worksDir>/*/state.json 2>/dev/null
ls <worksDir>/*/prd.md <worksDir>/*/tc.md <worksDir>/*/*-plan.md 2>/dev/null
```

A `-plan.md` means implementation started. Also read the SDD ledger to place the resume point precisely:

```bash
cat .superpowers/sdd/<slug>-plan/progress.md 2>/dev/null | head -20
```

Tasks marked `Task <N>: complete` in the ledger **are finished. Never re-run them** — skipping this check re-executes every completed task, the worst possible waste.

**Option restore** — read `options` from the state file and apply them; options given in this invocation take precedence.

If the `e2e-test` stage is `skipped` (from `-no-e2e`) and this resume has no option, add one more choice to the resume question:

- `Continue with the E2E stage only` — implementation is done; run from Step 4

**Issue key + early collision check** [new work only] — shared contract order: ① `$ARGUMENTS` → ② `git branch --show-current`. A hit means the user is never asked. Then the contract's early collision check; a hit routes to the resume flow. Resumed work skips this.

---

## Step 1 — Requirements

### 1-a. PRD

`Skill: dev-pipeline:prd-extract`, passing any feature info from `$ARGUMENTS`.

**As soon as the interview settles the feature name**, go to 1-b — *before* `prd-extract` saves.

### 1-b. Slug confirmation + pre-emption check → PRD save [new work only]

Run the shared contract's **slug confirmation** and **pre-emption check** with the feature name from 1-a. Pass the slug to `prd-extract` for saving; record `slug` and `issue` in the state file.

This pipeline **creates a branch** (`tdd-implement` I-2), so the slug also fixes the branch name `<branchPrefix><slug>`. Getting it wrong here misaligns every artifact plus the branch.

Then **Gate G1**.

### Gate G1 — PRD review

- Metrics: `AC N · requirements N · server interface [yes/no/pass] · platform interface [yes/no/pass/n-a] · UI scenarios [yes/no/pass] · open questions N`
- Checklist:
  - required slots (feature name · target screen · acceptance criteria) carry no `?unclear` marker
  - **each AC is implementation-sized** — one AC covering a whole screen bloats the TCs and tasks downstream

> A PRD is optional. A hand-written spec document is accepted as input (if it lacks the standard headers, only the AC list is confirmed with the user). In that case skip Step 1 and use that file as `**Spec:**`.

---

## Step 2 — Test case extraction (new-implementation mode)

`Skill: dev-pipeline:tc-extract` with the **PRD path confirmed at G1**, **explicitly passing new-implementation mode.**

> This orchestrator already knows there is no code, so it **auto-answers** `tc-extract`'s implementation-state question (`New implementation — no code`). The user is not asked again.

Then **Gate G2**.

### Gate G2 — TC review

- Metrics: `TC N (unit N · e2e N · manual N) · UCP N · new files N`
- Checklist:
  - **the `Unit target` classification is right** — the hardest decision to undo in this pipeline. Anything listed in config `unitTest.excludedAreas` that got a unit target will burn fix rounds and end up back in E2E
  - predicted targets and state paths carry the `(new)` suffix — they are refreshed with real values in the E2E stage
  - `## Implementation surface` places new files where the project structure expects them

### Right after G2 — zero unit targets

If **no** TC has a `Unit target`, ask whether to skip implementation:

**Question**: "No TC has a unit target. What should happen to the implementation stage?"
- header: `Implementation`
- options:
  - `Skip implementation, go to E2E` — jump to Step 4; this feature is verified end-to-end
  - `Reclassify verification layers` — back to Step 2 to revisit `Unit target`
  - `Stop here`

> This is a **normal outcome** given a repository's testability boundary. Forcing unit targets produces tests that assert nothing.

**⚠️ Combined with `-no-e2e`** — zero unit targets *and* `-no-e2e` leaves **no stage to run**. Ask this instead:

**Question**: "There are no unit targets and the E2E stage is disabled, so nothing is left to run. What should happen?"
- header: `Nothing to run`
- options:
  - `Run the E2E stage` — drop `-no-e2e` for this run, go to Step 4
  - `Reclassify verification layers` — back to Step 2
  - `Stop after the TC file` — record state and end; the TC file stays for later

---

## Step 3 — TDD implementation

`Skill: dev-pipeline:tdd-implement` with the **TC path confirmed at G2**.

> `tdd-implement` owns its own precondition gate (I-0), scope confirmation (I-3), plan writing, and SDD execution loop. This orchestrator does not intervene inside it.

Then **Gate G3**.

### Gate G3 — Implementation review

- Metrics: `tasks N · unit tests N passing · commits N · RED evidence N`
- Checklist:
  - **each RED entry in `red-evidence.jsonl` precedes its GREEN entry in time** — the only proof TDD actually happened
  - `git log --oneline` shows one commit per task and **no `--no-verify` bypass**
  - for every config `approvalGates[]` entry whose `check` printed output: approve it explicitly or send it back

Confirm with:

```bash
cat .superpowers/sdd/<slug>-plan/red-evidence.jsonl | head -40
BASE=$(git merge-base HEAD $(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || echo main))
git log --oneline $BASE..HEAD
# then each approvalGates[].check from the config, e.g.:
#   BASE=$BASE bash -c "<approvalGates[i].check>"   ← checks may use $BASE; non-empty output = needs the user's explicit approval
```

---

## Step 4 — E2E spec generation and validation

### ⛔ With `-no-e2e` — do not run this step

Do **not** invoke `dev-pipeline:e2e-test`. Instead:

1. Record the stage in the state file:
   ```json
   { "name": "e2e-test", "status": "skipped", "skipReason": "-no-e2e option", "artifact": null, "confirmedAt": "<now>" }
   ```
2. Leave `next` as `"e2e-test"` — resuming without the option continues from here.
3. Print the **implementation-complete report** below.

Selector refresh (see "Before entering") is **not** done now either. It only matters when specs are generated, and doing it early blurs whether it already happened on resume.

```
✅ Implementation complete — <feature name>   (E2E stage skipped: -no-e2e)

  work dir      <worksDir>/<slug>/
    requirements   prd.md
    test cases     tc.md
    plan           <slug>-plan.md
  RED evidence  .superpowers/sdd/<slug>-plan/red-evidence.jsonl

  unit tests N passing · commits N

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
E2E stage remains — N screen-level TCs
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
To continue, either:
  /dev-pipeline:auto-dev-pipeline <feature>        ← resume without the option, from Step 4
  /dev-pipeline:e2e-test <worksDir>/<slug>/tc.md   ← run the E2E stage alone

Checkpoint targets from new-implementation mode are still predictions.
They are refreshed with real values in the E2E stage.
```

If there are **zero** screen-level TCs, replace the trailing block with one line: "No screen-level TCs — nothing for the E2E stage to generate."

---

### Without the option (default)

`Skill: dev-pipeline:e2e-test` with the **same TC file** (batch mode).

### Before entering — avoid a duplicate selector refresh

If `tdd-implement` step I-8 already refreshed the predicted selectors, **do not do it again**. Check the state file's `stages[tdd-implement]` record. If it was not refreshed, present `tdd-implement` I-8's choices here.

> Checkpoint targets and state paths that were "predictions" in new-implementation mode are now **verifiable**. The two branches meet here.

Then **Gate G4**.

### Gate G4 — Spec review and completion

- Metrics: `specs generated N · runtime PASS N / SKIP N / FAIL N · skipped N`
- Checklist:
  - a PASSing spec verifies what was intended (report screenshots, AI verdict rationale)
  - a SKIP with `NO_CANDIDATE` may mean a predicted target was wrong — update the TC checkpoint table with the real value
- Options: `Done` / `Re-run this stage` / `Stop here` (last stage — no `Continue in a new session`)

On `Done`: mark every stage `done` and report:

```
✅ Development pipeline complete — <feature name>

  work dir      <worksDir>/<slug>/
    requirements   prd.md
    test cases     tc.md
    plan           <slug>-plan.md
  RED evidence  .superpowers/sdd/<slug>-plan/red-evidence.jsonl
  E2E specs     <e2e.specsDir>/<slug>/

  unit tests N passing · E2E specs N PASS
```

---

## Related files

- `../auto-e2e-pipeline/references/shared-contract.md` — **single source** for gates, slug, state file
- `dev-pipeline:prd-extract` · `dev-pipeline:tc-extract` · `dev-pipeline:tdd-implement` · `dev-pipeline:e2e-test` — orchestrated skills
- `${CLAUDE_PLUGIN_ROOT}/scripts/red-gate.mjs` — RED/GREEN verification and evidence ledger
