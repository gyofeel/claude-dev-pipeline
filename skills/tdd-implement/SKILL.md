---
name: tdd-implement
description: Use when a tc.md produced by tc-extract (new-implementation mode) is ready to be built test-first with recorded RED evidence, or when its plan (`<slug>-plan.md`) is ready to execute — triggers like "/dev-pipeline:tdd-implement", "implement with TDD", "tests first", or right after tc-extract reports unit targets and implementation owners.
---

# TDD implement

The superpowers plugin owns TDD discipline, the plan format, subagent execution and the review loop. This skill only adds what attaches them to the project:
- TC → plan conversion
- wiring the deterministic gates: `${CLAUDE_PLUGIN_ROOT}/scripts/red-gate.mjs` · `coverage-gate.mjs` · `surface-gate.mjs`
- failure routing

Gates G3a and G3 follow "Gates and the next session" in `../auto-e2e-pipeline/references/shared-contract.md`. When `<worksDir>/<slug>/state.json` exists, this skill updates its `tdd-plan` and `tdd-impl` stages (`running` on entry, `done` + `confirmedAt` when its gate passes) and adds the contract's progress question to its G3a / G3 `AskUserQuestion` (at most 4 questions per call). The router does not ask it again; it updates `next` and acts on the answer.

## Usage

```
/dev-pipeline:tdd-implement <worksDir>/<slug>/tc.md [--style <name>]      # PLAN
/dev-pipeline:tdd-implement <worksDir>/<slug>/<slug>-plan.md              # IMPL
```

Two nodes; the input file picks the node. Start a fresh context between them, so what piled up while writing the plan does not ride along through execution.

| Input | Node | Ends at |
|---|---|---|
| `<worksDir>/<slug>/tc.md` | **PLAN** — write the plan | G3a plan review |
| `<worksDir>/<slug>/<slug>-plan.md` | **IMPL** — SDD execution + final gate | G3 implementation review |

No argument → list `<worksDir>/*/tc.md` and `<worksDir>/*/*-plan.md` and let the user pick. The slug is the input file's parent directory name. `--style` is passed to PLAN step 4.

**Execution premise**: verification runs on the developer machine, not the production platform. Anything in config `unitTest.excludedAreas` is not a unit target; it belongs to `dev-pipeline:e2e-test`. **Verification layer ≠ implementation owner.** A TC without a unit test still needs someone to build it; its owner was decided at G2 in tc.md `## Implementation owners`.

**Two departures from superpowers defaults**
- No `brainstorming`. Requirements and design were settled in the PRD and TC stages.
- No `using-git-worktrees` unless config `unitTest.useWorktree` is `true`. A fresh worktree has no installed dependencies or build artifacts, so neither tests nor commit hooks run there. Isolate with a branch.

## Step 0 — Config and prerequisites

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config-load.mjs" --check
```

Missing or invalid → apply "Missing config" in the shared contract's User-facing output (`../auto-e2e-pipeline/references/shared-contract.md`), then re-run this step. Below uses `worksDir`, `branchPrefix`, `language`, `locale`, `commands.*`, `unitTest.*`, `constraintsFile`, `approvalGates`, `issueKeyPattern`. Plan markers (`### Task N`, characterization, RED exempt) follow `${CLAUDE_PLUGIN_ROOT}/kit/artifact-labels.mjs` for `locale`. Talk to the user in `language` and shape every message by the contract's User-facing output (`../auto-e2e-pipeline/references/shared-contract.md`).

superpowers must be enabled:

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

Plugins can be enabled per project, so user, project and project-local settings are all read. `MISSING` → stop: "superpowers is not installed. Run `/plugin install superpowers@claude-plugins-official`, restart the session, and re-run this command. PRD and TC files are untouched." There is no fallback: without superpowers there is no record that tests were written first.

---

## PLAN

1. **Environment + baseline**
   ```bash
   <commands.setup>     # only if set
   node "${CLAUDE_PLUGIN_ROOT}/scripts/red-gate.mjs" --phase green --plan <worksDir>/<slug>/<slug>-plan.md --all
   ```
   - The plan need not exist yet; `--plan` only fixes the ledger location (`<worksDir>/<slug>/red-evidence.jsonl`).
   - A red baseline (failures outside `unitTest.knownFailuresFile`) makes every later collateral verdict untrustworthy. Report it and stop.
   - `RUN_INCOMPLETE` → the suite did not finish; re-run it before judging the baseline.
   - `ENV` / `EACCES` → never run `sudo`. Show the failing path and the ownership fix to the user, and stop.

2. **Branch**: `git switch -c <branchPrefix><slug>`; if it exists, switch to it. (`unitTest.useWorktree: true` → `superpowers:using-git-worktrees` instead.)

3. **Plan** → `Skill: superpowers:writing-plans`, passing:
   - **Save location**: `<worksDir>/<slug>/<slug>-plan.md`. The slug stays in the file name because SDD names its workspace after the plan's basename.
   - **Header**:
     - `**Spec:** <worksDir>/<slug>/prd.md, <worksDir>/<slug>/tc.md` — the plan holds no implementation code, so these are SDD's only basis for review.
     - "Implementation steps need judgement. Implementers use the standard model or better."
     - "Execution is fixed: subagent-driven-development."
   - **Scope**: every TC in tc.md, except those whose `## Implementation owners` row is `split` or `existing`. If the user narrowed the scope at G2, use that list.
   - **`## Implementation owners`** before the first task: one row per TC without a unit test — `Task N`, `existing`, or `split <issue key>`. `coverage-gate` reads it.
   - **Task template**: [references/task-checkbox-contract.md](references/task-checkbox-contract.md), handed over as is. Give the template itself, not a description of it.
   - **Global Constraints**: the block below.
   - **Extra tests from Review Focus** carry no `UCP-` name; they stay out of the traceability count.
   - **Full replacement**: a task that replaces the whole pattern of an existing file writes `**Full replacement:** <scope — reason>` in its body. Use it only where the code has no settled style to blend into. Implementers never switch to a full rewrite without this marker.

4. **Style context** [automatic]

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/style/plan-context.mjs" --plan <worksDir>/<slug>/<slug>-plan.md [--style <name>]
   ```

   - Picks the runner's style file (`--style` → the plan's `**Style:**` line → the file listing `git config user.email` → `style.defaultStyle`), writes it to the plan header, and puts a `Read context` step before each task's first checkbox: the task's development layers (from `Files:`) and the matching style sections. Implementer and task reviewer both read it from the task brief.
   - `{"style":null,"skipped":true}` → no style file for this runner; go on. Mention `/dev-pipeline:style-extract` once in the G3 report.
   - Exit 2 → show stderr. It names the missing piece: an unknown `--style`, a `style.defaultStyle` that does not exist, or a `**Style:**` line pointing at a deleted file. Fix the name or remove that line, then re-run.
   - `fullReplace` non-empty → one `AskUserQuestion` listing each task's scope and reason; a declined task loses its marker and goes back to `writing-plans` as an in-place change.
   - `unmapped` (paths in no layer) and `noLayerSection` go to the G3 report. They never block.
   - Never copy style content into `## Global Constraints`: the task reviewer treats that section as binding requirements and would flag tendencies as violations.
   - Re-run it whenever tasks are added to the plan (upstream rewind); it is idempotent.

5. **Plan check**
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/coverage-gate.mjs" --prd <worksDir>/<slug>/prd.md --tc <worksDir>/<slug>/tc.md \
     --plan <worksDir>/<slug>/<slug>-plan.md --lint
   ```
   - Read `ok` first (`ok: false` → `error` says why; never a pass). Then fix the plan and re-run until `lint.errors` and `uncovered` are both empty.
   - It catches: unit TCs without a task, TCs without an owner, a `##` section after the first task, red-gate commands missing arguments or with a relative `--file`, `Modify:` targets that do not exist and `Create:` targets that already do.

6. **G3a — plan review** (one `AskUserQuestion`)
   - The only point where a human reads the RED contract (the test code).
   - Description: task count; wiring, characterization and RED-exempt tasks; the `## Implementation owners` summary; the style file applied; full-replacement tasks (scope · reason); paths with no layer.
   - With a state file, the progress question is one of this call's questions.
   - Approved → with a state file, mark `tdd-plan` done and return to the router with the progress answer. Standalone, IMPL starts in a new session: end with the session handoff (User-facing output) for `/dev-pipeline:tdd-implement <worksDir>/<slug>/<slug>-plan.md` — the contract's clipboard script with `CMD` set to that command.

### Global Constraints (into the plan)

`## Global Constraints` = the contents of config `constraintsFile`, **verbatim** — no summary, no rewrite; this is SDD's only channel to every implementer. If `constraintsFile` is null, derive at most 15 lines from `CLAUDE.md` / `AGENTS.md`, show them, and get one `AskUserQuestion` confirmation first. Then append this block as is:

```
- Run tests only through red-gate or the one-shot form of commands.unitTest on a single file. Never a watch-mode command — it never exits. The whole suite is red-gate --all.
- Traceability join keys: [TC-NN] in task titles, it('UCP-NN: …') in test names. red-gate --test looks tests up by this name.
- Commit: format the changed files (commands.format, when set), git add the named files, then git commit -F <message file the controller wrote>. Never git add -A / git add . (untracked credentials can sit in the working tree). Never --no-verify.
- When you conclude a requirement is wrong, or code and a PRD spec value (URL, key or signature basis, field name) differ: implement what the PRD says and leave the conflicting existing code alone. Put the evidence (with the spec source the PRD cites) in the report's `upstream conflict` line. Changing a requirement is a human decision at G3.
- Do not leave a long run in the background and end the turn without reporting its result. Wait in the foreground.
- New comments say only what the code cannot: why, constraints, pitfalls, external spec sources. One line as a rule, three at most; doc comments only on exported functions, one or two sentences.
- Comments never carry work history, future speculation, restated code, or ticket or artifact IDs (issue keys, requirement N, AC-, TC-, UCP-, Task N) — revisions renumber them and the comment turns false. State the reason in words; a needed reference names only the source (`// <spec name> p.18`), no line numbers.
- Write comments in the project's language the way a native speaker would. Leave existing comments as they are.
```

---

## IMPL

1. **Execute** → `Skill: superpowers:subagent-driven-development` with the plan path. Workspace (`.superpowers/sdd/<plan-basename>/`), `progress.md`, briefs, reviews, fix rounds and model choice follow SDD.
   - Before dispatching a task, the controller writes `.superpowers/sdd/<plan-basename>/commit-msg-task-N.txt` (subject in the project's commit style + the trailer the session prescribes, verbatim). The implementer commits it with `-F` and never edits it.
   - Before dispatching the first task, run the project's commit-msg hook on task 1's message file (JSON on stdout):
     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/scripts/commit-msg-check.mjs" .superpowers/sdd/<plan-basename>/commit-msg-task-1.txt
     ```
     `ok: true` → overwrite `commit-msg-task-1.txt` with the returned `message`, and write tasks 2..N the same way (trailer present or absent as decided; if `trailerDropped`, no trailer for the whole run). `ok: false` → do not dispatch; show `output` and ask the human. With no hook (`hook: null`), CLAUDE.md / AGENTS.md rules that forbid trailers still win over the session's trailer.
   - Before dispatch, re-measure the brief's line numbers and `Files:` with `grep -n`; earlier tasks move code after the plan was written.
   - Tell the task reviewer: `red-evidence.jsonl` and the gate JSON are the source of truth; commit trailers are not a review item.
   - A gate failure → handle it by [references/failure-routing.md](references/failure-routing.md). The controller never classifies a failure itself. When everything passes, do not read it.

2. **Final gate** — after SDD's final review and **before the workspace is deleted and before finishing**; afterwards the Rulings in `progress.md` are gone.
   ```bash
   B=<branch start commit>; W=<worksDir>/<slug>
   node "${CLAUDE_PLUGIN_ROOT}/scripts/red-gate.mjs" --phase green --plan $W/<slug>-plan.md --all    # regression + ledger audit
   node "${CLAUDE_PLUGIN_ROOT}/scripts/surface-gate.mjs" --base $B                                    # reachability · vanished tokens
   node "${CLAUDE_PLUGIN_ROOT}/scripts/coverage-gate.mjs" --prd $W/prd.md --tc $W/tc.md --plan $W/<slug>-plan.md
   BASE=$B <approvalGates[].check>                                                                    # each entry
   git diff -U0 $B..HEAD -- '*.js' '*.mjs' '*.cjs' '*.ts' '*.jsx' '*.tsx' '*.vue' '*.svelte' ':!*.test.*' ':!*.spec.*' \
     | grep -nE '^\+[[:space:]]*(//|\*|/\*|<!--|#).*(<issueKeyPattern>|AC-[0-9]+|TC-[0-9]+|UCP-[0-9]+|Task ?[0-9]+)' || echo "no IDs in new comments"
   git add $W/red-evidence.jsonl && git commit -m "<slug> RED evidence ledger"
   ```
   - `--all` runs every project with two workers against the `unitTest.knownFailuresFile` baseline. If you fix a pre-existing failure, remove it from the baseline.
   - `failureClass` `RUN_INCOMPLETE` (`routeTo: controller:rerun`) → the suite did not finish; re-run before claiming no regression.
   - `NOT_COLLECTED` with `--all` → the runner collected zero tests; fix `commands.unitTest` / `unitTest.testFileGlobs` before claiming no regression.
   - coverage-gate: read `ok` first. `ok: false` → do not open G3; report `error`.
   - `<issueKeyPattern>` goes into POSIX `grep -E`: write `\d` as `[0-9]`.
   - `audit.violations` (GREEN without an earlier RED, tests whose last record failed) and `audit.tasksWithoutEvidence` go to G3 as they are.
   - Apply `superpowers:verification-before-completion`: no completion claim without this output.

3. **G3 — implementation review** (one `AskUserQuestion`). Put these in the description in this order and ask only what needs a human:
   1. AC coverage: `missing` first, at the top.
   2. Ledger audit violations, tasks without evidence.
   3. SDD's **Rulings I made** and the task reports' `upstream conflict` lines. Ask `Keep` / `Rewind` for each.
   4. surface-gate:
      - `unreachableFiles` · `unreferencedExports` → "is this intended?" Surface created by `RED exempt` or characterization tasks must be empty here.
      - `vanishedTokens` → old identifiers existing specs still use.
   5. `approvalGates` with output → ask for approval by gate name. A reviewer subagent cannot approve these.
   6. Publishing source deviations, IDs in new comments.
   7. The task reports' `style:` lines, with Modify files where `author` won listed first — that is where styles may have mixed — plus the style step's `unmapped` / `noLayerSection`. Not asked separately.

   With a state file, the progress question is one of this call's questions (split the call when the items above already take 4); mark `tdd-impl` done when G3 passes and return to the router with the progress answer.

4. **Rewind** — if any item got `Rewind`, ignore the progress answer of the same call.
   1. The controller edits the PRD and the TC file, and adds at the top of both: `> **Revised**: <YYYY-MM-DD> — <overturned requirement> → <new requirement>`.
   2. Pass `coverage-gate --prd --tc --plan --lint`: `ok: true` and empty `lint.errors`.
   3. Append a fix task with its RED contract to the plan, re-run `plan-context.mjs`, and run only that task through SDD. That task also fixes the affected existing test expectations.
   4. Re-run from step 2 (final gate) and open G3 again. A rewound implementation is done only after a human has seen it at G3.

   G3 passed → run SDD's `finishing-a-development-branch` here only when this skill runs standalone or the state's `options` have `-no-e2e`; otherwise the router runs it after the last gate's `Done`. Next is `dev-pipeline:e2e-test <worksDir>/<slug>/tc.md`; in a pipeline the router continues (and refreshes the predicted selectors first). Standalone, run `dev-pipeline:ui-selector-extractor` on the new files and correct the `e2e` TCs' checkpoint tables before generating specs: new-mode selectors were predictions. Then end with the one next action, alone in a code block: `/dev-pipeline:e2e-test <worksDir>/<slug>/tc.md`.

---

## Left to judgement (never a deterministic gate)

| Decision | Owner | Why |
|---|---|---|
| unit / E2E / manual classification, implementation owner | LLM proposes → human (G2) | no code yet, nothing for a script to read; a keyword heuristic used as a gate gets gamed |
| Does the test check behaviour or implementation detail | SDD reviewer | no syntactic signature |
| Is the GREEN implementation minimal | SDD reviewer | "minimal" depends on intent |
| Naming, structure, items in `approvalGates` | human | no oracle; these are approvals |
| Do new comments follow the comment rules | SDD reviewer | only IDs are counted by grep |
| One-shot timer or forbidden polling | reviewer | syntactically identical |

## Related

- `${CLAUDE_PLUGIN_ROOT}/scripts/red-gate.mjs` — RED / GREEN / characterization verdicts + ledger `<worksDir>/<slug>/red-evidence.jsonl` + `--all` audit
- `${CLAUDE_PLUGIN_ROOT}/scripts/coverage-gate.mjs` — AC → TC → task coverage and PRD / TC / plan lint
- `${CLAUDE_PLUGIN_ROOT}/scripts/surface-gate.mjs` — reachability · vanished tokens
- `${CLAUDE_PLUGIN_ROOT}/scripts/commit-msg-check.mjs` — dry-runs the project's commit-msg hook on a message file; drops the trailer when the hook rejects it
- `${CLAUDE_PLUGIN_ROOT}/scripts/style/plan-context.mjs` — style file pick + per-task development-layer context step
- `dev-pipeline:style-extract` — builds the layer catalog and the style files
- `dev-pipeline:tc-extract` — produces the input (new mode); `dev-pipeline:e2e-test` — screen verification afterwards
