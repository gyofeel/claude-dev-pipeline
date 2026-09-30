---
name: tdd-implement
description: Use when a tc.md produced by tc-extract (new-implementation mode) has TCs with a Unit target and the user wants them implemented test-first with recorded RED evidence — triggers like "/dev-pipeline:tdd-implement", "implement with TDD", "tests first", or right after tc-extract reports unit targets.
---

# TDD implement (TC-driven)

Turns the unit-targeted TCs of a `tc.md` into code, test-first. The superpowers plugin owns TDD discipline, plan format, subagent execution, and review loops. This skill is only the **glue for this repository**: parse the TC contract, inject project laws, wire the deterministic gate, route failures by cause.

## Usage

```
/dev-pipeline:tdd-implement <worksDir>/<slug>/tc.md
```

`$ARGUMENTS` is the TC path. Missing → list `<worksDir>/*/tc.md` with `AskUserQuestion`. **The slug is the parent directory name.**

## Step 0 — Config

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config-load.mjs" --check
```

Missing or invalid → stop: "Run `/dev-pipeline:init` first." Everything below uses resolved config values (`worksDir`, `branchPrefix`, `commands.*`, `unitTest.*`, `constraintsFile`, `approvalGates`).

## Execution premise (all steps, all subagents)

Verification runs on the developer machine, not the production platform. **Anything listed in config `unitTest.excludedAreas` is not a unit target** — it belongs to `/dev-pipeline:e2e-test`. Blurring this line produces mocks for interfaces that never answer and tests that assert nothing.

> **Verification layer ≠ implementation owner.** `Unit target: (none)` means "verified by E2E", not "implemented by E2E". `/dev-pipeline:e2e-test` generates specs; it never implements the feature. So the implementation owner of every E2E/manual TC is **decided at I-3b** — leave it undecided and that TC is implemented by no stage of the pipeline while every gate stays green (observed downstream: 9 of 22 TCs, the user-visible behaviour of the feature).

## Delegation boundary

| This skill owns | Delegated to superpowers |
|---|---|
| TC parsing + verification-layer re-confirmation (human gate) | plan writing → `superpowers:writing-plans` |
| **Wiring the gate into plan checkboxes** | execution, per-task review, fix rounds ≤5, final review → `superpowers:subagent-driven-development` |
| Failure routing table ([failure-routing.md](references/failure-routing.md)) | per-task TDD discipline → `superpowers:test-driven-development` |
| `${CLAUDE_PLUGIN_ROOT}/scripts/red-gate.mjs` · `surface-gate.mjs` · `coverage-gate.mjs` | completion claims → `superpowers:verification-before-completion` |
| E2E handoff + selector refresh | branch wrap-up → `superpowers:finishing-a-development-branch` |

**No second retry loop.** SDD already has fix rounds + model escalation + final review. This skill only supplies the routing table that says which SDD lever to pull.

## I-0 — Prerequisite gate [automatic, stop on failure]

**superpowers must be installed — check first.**

```bash
python3 - <<'PY' && echo "superpowers OK" || echo "superpowers MISSING"
import json, os, sys
paths = [os.path.expanduser('~/.claude/settings.json'), '.claude/settings.json', '.claude/settings.local.json']
def on(p):
    try:
        d = json.load(open(p)).get('enabledPlugins', {})
    except (OSError, ValueError):
        return False
    return any(k.startswith('superpowers@') and v for k, v in d.items())
sys.exit(0 if any(on(p) for p in paths) else 1)
PY
```

Plugins can be enabled per project, so user, project, and project-local settings are all read; any one enabling superpowers passes. Reading only the user file stops healthy projects here.

`MISSING` → stop. No fallback path: without superpowers there is no record that tests were written first, which is the whole point.

> superpowers is not installed. Run `/plugin install superpowers@claude-plugins-official`, restart the session, and re-run this command. PRD and TC files are untouched.

`OK` → environment check:

```bash
<commands.setup>          # only if set
<commands.unitTest>       # must exit 0 — green baseline
<commands.unitTestList>   # only if set — record collected count
```

**Without a green baseline no gate is trustworthy**: red-gate's collateral check treats "unrelated failures" as defects. If the baseline is red and `unitTest.knownFailuresFile` is set, that baseline is used; otherwise report the failures and stop.

Permission errors (`EACCES` etc.) → **never run `sudo`**. Show the user the failing path and stop.

## I-1 — Parse the TC file [automatic]

Read per [tc-format.md](../tc-extract/references/tc-format.md). Extract:

- slug (parent dir name); `## Acceptance Criteria` list
- per TC: `### TC-NN:` name · **Unit target** · **Related AC** · **E2E suitability** · `#### Unit checkpoints` table

| Unit target | Class |
|---|---|
| test file path | **implement** |
| `(none)` | **implementation owner decision needed** — E2E/manual verifies it; who implements it is decided at I-3b |

Also read the TC file's `## Implementation surface` (new-implementation mode) and the `(new)` selectors / state paths in checkpoints. They list **DOM and state that do not exist yet** and are shown at I-3b as the basis for the owner decision.

Zero implement TCs does **not** end the skill. Decide the owners of the E2E/manual TCs at I-3b first; only if every one is `existing` or `split`, report "Nothing for this skill to implement. Continue with `/dev-pipeline:e2e-test`." and stop.

> The PRD referenced as `Spec:` may be any spec document, not only prd-extract output. Without the standard header, confirm the AC list with the user.

## I-2 — Branch isolation

`unitTest.useWorktree: false` (default):

```bash
git switch -c <branchPrefix><slug>
```

`true` → `superpowers:using-git-worktrees`. The default is a branch because a fresh worktree has no installed dependencies or build artifacts; rollback story is identical and setup cost is zero.

## I-3 — Scope + verification layer → `AskUserQuestion` [gate]

**Question**: "Confirm the implementation scope."
- header: `Scope`
- description: table + list of TCs excluded as E2E-only

```
| TC | Name | AC | Test file | UCP |
|----|------|----|-----------|-----|
| TC-01 | … | AC-01 | src/lib/filter.test.js | 3 |
```

- options:
  - `Implement all`
  - `High priority only`
  - `Pick TCs` — ids as text
  - `Reclassify` — move a TC's Unit target to `(none)` (E2E branch)
  - `Cancel`

> This is the last human check on the verification layer. The code does not exist yet, so no script can judge it; a keyword heuristic used as a gate gets gamed.

### I-3b — Implementation owner of E2E/manual TCs → `AskUserQuestion` [gate; cannot proceed with a blank]

`(none)` TCs are **decisions, not exclusions**. Show this table first:

```
N TCs are verified by E2E/manual only. Without a unit test, nothing in the pipeline implements them yet.
| TC | Name | AC | E2E rationale | Surface to build ((new) selectors / state paths) |
|----|------|----|---------------|---------------------------------------------------|
| TC-11 | … | AC-04, AC-15 | focus · render | .remaining-count (new), auth.remainCount (new) |
```

One choice per TC (group identical answers when there are many):
- `Implement here` — add a **wiring task** to the plan (I-4 wiring rules)
- `Split` — take the issue key as text
- `Already implemented` — existing code, verification only (re-confirm when the TC carries `(new)` surface)

Record the decisions in the plan section `## Implementation owners` — `${CLAUDE_PLUGIN_ROOT}/scripts/coverage-gate.mjs` and I-5 read it. Owner values are exactly `Task N`, `split <ISSUE-KEY>`, or `existing`.

```
## Implementation owners
| TC | Owner | Reason |
|----|-------|--------|
| TC-11 | Task 15 | wiring — fetch remaining count on entry and render it |
| TC-17 | existing | shared template applies automatically — regression check only |
| TC-24 | split PROJ-999 | entry path not reachable yet |
```

> `Reclassify` above moves a TC from unit to E2E; this question makes sure **its implementer does not disappear with it**. Without it, "nobody owns this" is the default.

## I-4 — Plan → `Skill: superpowers:writing-plans`

Inject:

1. **`Spec:`** = absolute TC path (plus PRD path if present)
2. **Save location override**: `<worksDir>/<slug>/<slug>-plan.md` — the plan alone keeps the slug in its filename because SDD names its workspace after the plan basename (a plain `plan.md` would make every feature share `.superpowers/sdd/plan/`)
3. **`## Global Constraints`** = contents of config `constraintsFile`, **verbatim** — no summary, no rewrite; this is SDD's only channel to every implementer. If `constraintsFile` is null: derive ≤15 lines from `CLAUDE.md` / `AGENTS.md`, show them, and get `AskUserQuestion` confirmation before use.
4. **Task rules**
   - one implement TC = one task
   - title **must** be `### Task N: [TC-NN] <name>` — `[TC-NN]` is the traceability join key
   - `**Files:** Test:` = the TC's `Unit target` **verbatim** (never invent a path)
   - `**Interfaces:**` = the UCP table's `Target (module#export)` column
   - every UCP row → at least one `expect` in Task Step 1
   - test names **`it('UCP-NN: <description>')`** — the exact `red-gate --test` target
5. **Wiring-task rules** (TCs answered `Implement here` at I-3b)
   - same title shape `### Task N: [TC-NN] <name>`. When one task owns several TCs, write the others as **bracketed** `[TC-NN]` in the body — a bare `TC-NN` counts only as a reference
   - **get RED from a component mount test** when the UI framework supports one — follow the mount-test convention in `constraintsFile` / `unitTest.testNaming` (do not assume a framework). "Does the button call the new API", "is the remaining count rendered" are mount-testable. That test is the task's `**Files:** Test:` and the red-gate steps are the normal ones
   - only what a mount test cannot observe (real focus movement, native round trips, routing round trips) gets `**RED exempt:** <reason>` and no red-gate steps. Exempt tasks **must** be checked in the I-7 reachability report
   - a task that changes existing files first pins current behaviour with a **characterization test**
6. **`## Implementation owners`** = the I-3b decision table, verbatim
7. **Checkbox shape** = [task-checkbox-contract.md](references/task-checkbox-contract.md)

## I-5 — Traceability gate [automatic]

```bash
TC=<worksDir>/<slug>/tc.md
PLAN=<worksDir>/<slug>/<slug>-plan.md
# TC side: unit TCs / E2E-manual TCs
awk '/^### TC-/{tc=$2; sub(/:$/,"",tc)}
     /^\| \*\*Unit target\*\*/{ print tc, ($0 ~ /\(none\)/ ? "E" : "U") }' "$TC" | sort -u > /tmp/tc.kinds
awk '$2=="U"{print $1}' /tmp/tc.kinds > /tmp/tc.unit
awk '$2=="E"{print $1}' /tmp/tc.kinds > /tmp/tc.e2e
# plan side: bracketed [TC-NN] in tasks + TCs in the owners table
grep -oE '\[TC-[0-9]+\]' "$PLAN" | tr -d '[]' | sort -u > /tmp/plan.ids
sed -n '/^## Implementation owners/,/^## [^I]/p' "$PLAN" | grep -oE '^\| *TC-[0-9]+' | grep -oE 'TC-[0-9]+' | sort -u > /tmp/owner.ids

echo "UNIT=$(wc -l < /tmp/tc.unit) E2E=$(wc -l < /tmp/tc.e2e) PLAN=$(wc -l < /tmp/plan.ids) OWNER=$(wc -l < /tmp/owner.ids)"
echo "--- unit TCs without a task";        comm -23 /tmp/tc.unit /tmp/plan.ids
echo "--- E2E/manual TCs without an owner"; comm -23 /tmp/tc.e2e <(sort -u /tmp/plan.ids /tmp/owner.ids)
```

**Read the counts first.** An empty list and a broken `awk` that caught nothing look the same — **silence is not success**. `UNIT=0` and `E2E=0` together means parsing broke; treat as gate failure.

Both lists empty → pass. **Unit TC without a task** → back to `writing-plans`. **E2E/manual TC without an owner** → back to I-3b. Comparing unit TCs only made it structurally impossible for this gate to see that an E2E TC had no implementer.

> `writing-plans` self-review has a coverage pass, but that is an LLM re-reading its own output. A quietly dropped TC surfaces hours later in the E2E branch.

## I-6 — Execute → `Skill: superpowers:subagent-driven-development`

Pass the plan path. SDD owns: workspace `.superpowers/sdd/<plan-basename>/`, `progress.md` ledger, per-task briefs, one fresh implementer per task, task reviewer, fix rounds ≤5 (model escalation at round 4), final branch review, `finishing-a-development-branch`.

**Tell the SDD task reviewer**: trust `red-evidence.jsonl` and the gate JSON as the single source of truth; spend judgement only on the "left to humans" items below. **Commit trailers are not a review item** — reviewers also claim their own model name is canonical and flag correct trailers as defects.

### Dispatch rules

Done by the controller **before** each dispatch, or pasted **verbatim** into the brief:

1. **Write the commit message file first** — `.superpowers/sdd/<plan-basename>/commit-msg-task-N.txt`. The implementer commits it with `git commit -F`.
2. **Re-measure line numbers and the `Files:` list** — earlier tasks add and move files after the plan is written. `grep -n` just before dispatch; fix the brief if it drifted.
3. Brief, verbatim: "Do not run long commands in the background and end the turn without reporting the result. Wait in the foreground."
4. Brief, verbatim: "Run tests only through red-gate or the one-shot form of `commands.unitTest` for a single file. Never a watch-mode command — it never exits."

Failure handling: every value comes from red-gate's `failureClass` / `routeTo` / `consumesFixRound`. **The controller never classifies on its own.** Table: [failure-routing.md](references/failure-routing.md).

Cost tiers: deterministic gates always via direct Bash (no LLM re-spawn); per-task green runs a single file; the full suite runs once in I-7.

## I-7 — Final gate [automatic]

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/red-gate.mjs" --phase green --plan <worksDir>/<slug>/<slug>-plan.md --all
```

> `--all` uses `unitTest.knownFailuresFile` as the baseline when set: only failures absent from it count as regressions; output `collateral.knownFailuresSkipped` shows how many were excluded. **If you fix a pre-existing failure, remove it from the baseline** — otherwise it can break again silently.

Then run every `approvalGates[].check`:

```bash
<gate.check>   # for each entry
```

Non-empty output → **escalate to the user** with the gate name; a reviewer subagent cannot approve these.

Then the two report-only gates (they never block):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/surface-gate.mjs" --base <base>
node "${CLAUDE_PLUGIN_ROOT}/scripts/coverage-gate.mjs" --prd <worksDir>/<slug>/prd.md --tc <worksDir>/<slug>/tc.md --plan <worksDir>/<slug>/<slug>-plan.md
```

**What `surface-gate` reports** — a unit gate stays green even when the code has **zero callers**, so this counts them separately.
- `reachability.unreachableFiles` / `unreferencedExports` — files and exports added on this branch that production code never uses. Non-empty → ask the user the `question` text verbatim ("is this intended?"). Building a library layer first can be deliberate, so it **does not block**. Surface created by `RED exempt` wiring tasks must be empty here.
- `vanishedTokens` — identifiers and path fragments this branch removed or renamed that are gone from production but still present under `surfaceGate.specPaths`. Renaming a query knob or an endpoint kills existing specs **silently** (the old parameter is simply ignored). `comment: true` hits are leftovers in comments and not urgent.
- `limits` — members added to existing files without an export line (store actions, composable return members) are not detected; **code that is connected but calls the wrong target** is not detected either. Reachability is necessary, not sufficient.

**What `coverage-gate` reports** — per AC: `implemented` (a related TC is bracketed `[TC-NN]` in a task) / `verifyOnly` (mentioned bare in a task body, or owner `existing`) / `split` / `excluded` / `missing`. `missing` is likely a defect — put it at the top of the completion report.

Apply `superpowers:verification-before-completion` — **no completion claim without the actual command output above.**

## I-8 — E2E handoff → `AskUserQuestion`

```
✅ TDD implementation complete — <worksDir>/<slug>/<slug>-plan.md
   Tasks N done (wiring K, RED exempt R) / unit tests M passing
   RED evidence: .superpowers/sdd/<slug>-plan/red-evidence.jsonl

AC coverage (coverage-gate)
   A ACs — implemented a · verify-only v · split s · excluded x · missing m
   missing: AC-NN, …            ← warn at the top when non-zero
   | AC | State | TC | Owner |

Unconnected code (surface-gate)
   files: … / exports: …        ← "is this intended?"
   old identifiers left in existing specs: <token> → <spec:line> …

Next — E2E spec batch generation
  /dev-pipeline:e2e-test <worksDir>/<slug>/tc.md
  → K e2e-suitable TCs → one spec file each
```

- header: `E2E handoff`
- options:
  - **`Refresh selectors, then continue (Recommended)`** — new-implementation CP targets were **predictions** from sibling files. The files now exist: run `dev-pipeline:ui-selector-extractor` on them, update the `e2e` TCs' checkpoint tables in place, then run `/dev-pipeline:e2e-test`.
  - `Continue as-is` — hand off unchanged; the e2e runtime loop catches wrong targets as `NO_CANDIDATE`, at the cost of extra iterations.
  - `Later` — report the TC path and the remaining `e2e` TCs only.

> No auto-chaining: `/dev-pipeline:e2e-test` has its own gates and a 5-iteration runtime loop. Two long orchestrations in one context without a human checkpoint push the context out.

## Left to human/reviewer judgement (never a deterministic gate)

| Decision | Owner | Why no contract |
|---|---|---|
| Is this requirement unit / E2E / manual | LLM proposes → **human confirms** (I-3) | no code yet, nothing for a script to read |
| Does the test check behaviour or implementation detail | SDD task reviewer | no syntactic signature |
| Is the GREEN implementation really minimal | SDD task reviewer | "minimal" is relative to intent |
| Is AC → TC decomposition sufficient | human | coverage itself is counted by `coverage-gate`; whether the ACs are right and the TC set complete is not provable |
| Naming, structure, items in `approvalGates` | human | no oracle; these are approvals, not checks |
| Legitimate one-shot timer vs forbidden polling | reviewer | syntactically identical; a detector that flags both teaches suppression |

## Related

- `../tc-extract/SKILL.md` — produces the input (new-implementation mode)
- `../e2e-test/SKILL.md` — screen verification after implementation
- `../auto-dev-pipeline/SKILL.md` — 4-stage orchestrator containing this skill
- `${CLAUDE_PLUGIN_ROOT}/scripts/red-gate.mjs` — RED/GREEN verification + evidence ledger
- `${CLAUDE_PLUGIN_ROOT}/scripts/surface-gate.mjs` — reachability (unconnected new files/exports) + vanished tokens (old identifiers left in existing specs)
- `${CLAUDE_PLUGIN_ROOT}/scripts/coverage-gate.mjs` — AC → TC (→ Task) coverage; shared by tc-extract and I-7
