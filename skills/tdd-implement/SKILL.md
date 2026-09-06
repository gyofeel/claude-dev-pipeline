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

## Delegation boundary

| This skill owns | Delegated to superpowers |
|---|---|
| TC parsing + verification-layer re-confirmation (human gate) | plan writing → `superpowers:writing-plans` |
| **Wiring the gate into plan checkboxes** | execution, per-task review, fix rounds ≤5, final review → `superpowers:subagent-driven-development` |
| Failure routing table ([failure-routing.md](references/failure-routing.md)) | per-task TDD discipline → `superpowers:test-driven-development` |
| `${CLAUDE_PLUGIN_ROOT}/scripts/red-gate.mjs` | completion claims → `superpowers:verification-before-completion` |
| E2E handoff + selector refresh | branch wrap-up → `superpowers:finishing-a-development-branch` |

**No second retry loop.** SDD already has fix rounds + model escalation + final review. This skill only supplies the routing table that says which SDD lever to pull.

## I-0 — Prerequisite gate [automatic, stop on failure]

**superpowers must be installed — check first.**

```bash
python3 -c "import json,os,sys; d=json.load(open(os.path.expanduser('~/.claude/settings.json'))).get('enabledPlugins',{}); sys.exit(0 if any(k.startswith('superpowers@') and v for k,v in d.items()) else 1)" \
  && echo "superpowers OK" || echo "superpowers MISSING"
```

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
| `(none)` | E2E only — out of scope here |

Zero implement TCs → report "No unit targets in this feature. Continue with `/dev-pipeline:e2e-test`." and stop. This is a normal outcome, not an error.

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
5. **Checkbox shape** = [task-checkbox-contract.md](references/task-checkbox-contract.md)

## I-5 — Traceability gate [automatic]

```bash
TC=<worksDir>/<slug>/tc.md
PLAN=<worksDir>/<slug>/<slug>-plan.md
awk '/^### TC-/{tc=$2; sub(/:$/,"",tc)}
     /^\| \*\*Unit target\*\*/{ if ($0 !~ /\(none\)/) print tc }' "$TC" | sort -u > /tmp/tc.ids
grep -oE '\[TC-[0-9]+\]' "$PLAN" | tr -d '[]' | sort -u > /tmp/plan.ids
echo "TC=$(wc -l < /tmp/tc.ids) PLAN=$(wc -l < /tmp/plan.ids)"
diff /tmp/tc.ids /tmp/plan.ids
```

**Read both counts first.** A silent `diff` with `TC=0` means parsing broke — **silence is not success**; treat as gate failure. Counts equal and diff empty → pass. Otherwise send the missing ids back to `writing-plans`.

> `writing-plans` self-review has a coverage pass, but that is an LLM re-reading its own output. A quietly dropped TC surfaces hours later in the E2E branch.

## I-6 — Execute → `Skill: superpowers:subagent-driven-development`

Pass the plan path. SDD owns: workspace `.superpowers/sdd/<plan-basename>/`, `progress.md` ledger, per-task briefs, one fresh implementer per task, task reviewer, fix rounds ≤5 (model escalation at round 4), final branch review, `finishing-a-development-branch`.

**Tell the SDD task reviewer**: trust `red-evidence.jsonl` and the gate JSON as the single source of truth; spend judgement only on the "left to humans" items below.

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

Apply `superpowers:verification-before-completion` — **no completion claim without the actual command output above.**

## I-8 — E2E handoff → `AskUserQuestion`

```
✅ TDD implementation complete — <worksDir>/<slug>/<slug>-plan.md
   Tasks N done / unit tests M passing
   RED evidence: .superpowers/sdd/<slug>-plan/red-evidence.jsonl

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
| Is AC → TC decomposition sufficient | human | coverage is checkable, completeness is not |
| Naming, structure, items in `approvalGates` | human | no oracle; these are approvals, not checks |
| Legitimate one-shot timer vs forbidden polling | reviewer | syntactically identical; a detector that flags both teaches suppression |

## Related

- `../tc-extract/SKILL.md` — produces the input (new-implementation mode)
- `../e2e-test/SKILL.md` — screen verification after implementation
- `../auto-dev-pipeline/SKILL.md` — 4-stage orchestrator containing this skill
- `${CLAUDE_PLUGIN_ROOT}/scripts/red-gate.mjs` — RED/GREEN verification + evidence ledger
