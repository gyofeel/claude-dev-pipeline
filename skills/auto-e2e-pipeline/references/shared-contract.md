# Shared pipeline contract

> `dev-pipeline:auto-e2e-pipeline` and `dev-pipeline:auto-dev-pipeline` both follow this document. Each router reads it before Step 0. Every skill of the plugin follows its "User-facing output" section. Defining it twice causes drift; do not copy it.

Paths come from `.agents/pipeline.config.json` (`worksDir`, `e2e.specsDir`, `e2e.kitDir`, `branchPrefix`, `issueKeyPattern`, `language`, `locale`). Below, `<worksDir>` etc. stand for the resolved values and `<plugin>` for `${CLAUDE_PLUGIN_ROOT}`.

## Contents
- User-facing output (incl. Missing config)
- Graph principle
- Nodes, gates and deterministic checks
- Reading check output
- Routing (resume · entry)
- External PRD import
- Node call convention (`--pipeline`)
- Gates and the next session
- Slug
- State file

## User-facing output

Every skill follows this, standalone or in a pipeline.

- **Language.** Read config `language` at the start (`resolved.language` from `config-load.mjs`) and use it for everything the user reads: messages, summaries, and every `AskUserQuestion` question, header, label and description. Artifact files keep the headings of `locale`. Skill docs quote English text; say it in `language` in natural words. Korean: plain words, the consequence before the mechanism, no translationese.
- **Shape of a message.** First line: where we are. In a pipeline that is `[n/N] <stage> <state>`, N being the run's node count (auto-dev 5, or 4 with `-no-e2e`; auto-e2e 3), e.g. `[2/5] TC 추출 완료` / `[2/5] TC extraction done`; standalone, the skill and what just happened. Last part: exactly **one** next action. A command goes alone in a code block. Never list several commands as alternatives; when the user has a real choice, ask one `AskUserQuestion` and act on the answer.
- **Session handoff** (progress answer `Next step in a new session`): three lines, then the command. Run the clipboard script in "Gates and the next session" first.
  1. what finished
  2. what comes next
  3. copied: `새 세션을 열고 붙여 넣으세요 (클립보드에 복사됨)` / `Open a new session and paste it (copied to the clipboard)`; not copied: `새 세션을 열고 아래 명령을 실행하세요` / `Open a new session and run this command`

  then the resume command alone in a code block.
- **Resume hint, once.** At the first handoff of a run (G1), add one plain sentence without a code block: running the same router with no argument always picks up where the run stopped. Do not repeat it at later handoffs.
- **Missing config.** No `.agents/pipeline.config.json` yet (the check or load says so): ask one `AskUserQuestion`, bilingual because no `language` is known yet. Never tell the user to run init and stop.
  - Question: "This project is not set up for dev-pipeline yet. Set it up now? / 이 프로젝트는 아직 dev-pipeline 설정이 없습니다. 지금 설정할까요?" (header `Setup`)
  - `Set up now / 지금 설정` — "Runs setup (about 2 minutes of questions), then continues with what you asked. / 설정 질문(2분 정도)을 마친 뒤 요청하신 작업을 이어서 진행합니다."
  - `Not now / 나중에` — "Stops here. Run /dev-pipeline:init whenever you are ready. / 여기서 멈춥니다. 준비되면 /dev-pipeline:init 을 실행하세요."

  Yes → `Skill: dev-pipeline:init --from-skill`, then continue at the calling skill's own config step, keeping the user's original arguments. If the config still fails after one init round, show the remaining `errors[]` and stop; never call init a second time in the same request. No → stop with the second option's text. A config that exists but fails `--check` → show `errors[]`, then call init the same way (it opens its settings fix-up).

## Graph principle

The pipeline is a graph of nodes (one artifact + its deterministic checks) and gates (human decisions). When something goes wrong, look for what is missing before adding a rule: a node, an edge, or a data contract. Whatever can be decided deterministically moves into `<plugin>/scripts/*`. Prose rules are only for judgement calls, and each names the node that enforces it.

## Nodes, gates and deterministic checks

```
auto-dev-pipeline   PRD ─G1→ TC ─G2→ PLAN ─G3a→ IMPL ─G3→ E2E ─G4
auto-e2e-pipeline   PRD ─G1→ TC ─G2→ E2E ─G3
                     ↑
                     └ import (external PRD) ─G1→
```

The deterministic checks are already in the node's output. The router does not turn them into a checklist for the human.

| Gate | Check (run by the node) |
|---|---|
| G1 | `node <plugin>/scripts/coverage-gate.mjs --prd <worksDir>/<slug>/prd.md --lint` |
| G2 | `node <plugin>/scripts/coverage-gate.mjs --prd <worksDir>/<slug>/prd.md --tc <worksDir>/<slug>/tc.md --lint` |
| G3a | `node <plugin>/scripts/coverage-gate.mjs --prd <worksDir>/<slug>/prd.md --tc <worksDir>/<slug>/tc.md --plan <worksDir>/<slug>/<slug>-plan.md --lint` |
| G3 (dev) | `node <plugin>/scripts/red-gate.mjs --phase green --plan <worksDir>/<slug>/<slug>-plan.md --all` (regression + ledger audit) · `node <plugin>/scripts/surface-gate.mjs --state <worksDir>/<slug>/state.json` · `node <plugin>/scripts/coverage-gate.mjs --prd … --tc … --plan …` |

If `ok` is `false`, `lint.errors` is non-empty, or `uncovered` is non-empty, **do not open the gate.** Re-run the node.

## Reading check output

Every script prints one JSON object and always exits 0. The exit code says nothing; read the fields.

**coverage-gate** — read `ok` first.
- `ok: false` → the run itself failed; `error` says why (`no-ac`, `no-tc`, `no-related-ac` when no TC at all has a related-AC row, a missing argument, or a config error). With `--lint` the same messages are also in `lint.errors`. Never treat this as a pass.
- Zero-target codes appear in `error` (`ok: false`) **or** only in `lint.errors` (`ok: true`): `no-ac` (no `AC-NN` under the acceptance-criteria heading of the configured `locale`) is lint-only in `--prd --lint` mode; `no-targets` (`source.roots` matched no source file) and per-TC `no-related-ac` (one TC lacks the row) are always lint-only. Read both places.
- `ok: true` → then `uncovered` (G2: ACs no TC covers), `unknownRefs` (TCs pointing at ACs the PRD lacks), `missing` and `summary` / `table` (completion: one state per AC — `implemented` · `verifyOnly` · `split` · `excluded` · `missing`), and `lint.errors` / `lint.warnings`.
- Headings and field names are read with the labels of config `locale` (`<plugin>/kit/artifact-labels.mjs`). A PRD or TC file written with the other locale's headings fails as `no-ac` / `no-related-ac`, never as "uncovered 0".

**red-gate** — read `ok`, `failureClass`, `routeTo`. The ledger is `red-evidence.jsonl` next to the plan: `<worksDir>/<slug>/red-evidence.jsonl`. `--project` is optional (omitted = no runner project filter).

| `failureClass` | `routeTo` |
|---|---|
| `OK_RED` · `OK_GREEN` · `OK_CHAR` | `null` (pass) |
| `ENV` | `user:env` — environment, not a test defect; no fix round |
| `NOT_COLLECTED` · `SKIPPED` | `controller:placement` |
| `GREEN_WITHOUT_RED` · `NO_RED_ON_RECORD` · `GATE_ERROR` | `controller:halt` |
| `RUN_INCOMPLETE` | `controller:rerun` — the run did not finish; no regression can be claimed |
| `TARGET_NOT_FOUND` · `TARGET_AMBIGUOUS` · `WRONG_REASON` · `WRONG_REASON{module}` · `WRONG_REASON_UNKNOWN` | `implementer:test-only` |
| `STILL_RED` · `COLLATERAL_RED` | `implementer` |

With `--all`, `audit.violations` (GREEN without an earlier RED, tests whose last record failed) and `audit.tasksWithoutEvidence` go to G3 as they are. Per-task routing is `dev-pipeline:tdd-implement`'s failure-routing table.

**surface-gate** — report only. `reachability.unreachableFiles` / `reachability.unreferencedExports` (new code nothing reaches) and `vanishedTokens` (identifiers removed from production code that existing specs still use).

## Routing

The router picks the next node in this order. **If exactly one run is in progress, do not ask.**

1. **A file path argument** decides by kind. Under `<worksDir>`, the slug is the parent directory name.
   - `<worksDir>/<slug>/prd.md`:
     - its directory has a `state.json` → resume: go to that state's `next`. This is never an import.
     - no `state.json` and no `tc.md` / `*-plan.md` beside it → **External PRD import** (below)
     - no `state.json` but later artifacts beside it → infer from the artifacts (rule 4)
   - A PRD file outside `<worksDir>` (`prd.md`, or any other `.md` the user passes as the PRD) → **External PRD import**
   - `tc.md` → dev: PLAN / e2e: E2E. `*-plan.md` → IMPL (auto-dev only).
2. **A slug or issue key argument** → go to `next` of `<worksDir>/<that>*/state.json`.
3. **No argument** → look for runs in `ls <worksDir>/*/state.json` whose `pipeline` is this router and whose `next` is not `null`.
   - one → go to its `next`
   - several → list them and let the user pick (`AskUserQuestion`, once)
   - none → start a new run at PRD
4. **No state file but artifacts exist** → infer the point from the artifacts (`prd.md` · `tc.md` · `*-plan.md` · `red-evidence.jsonl`). The state file is a convenience, not the source of truth.
5. **Resuming IMPL** → check `Task N: complete` in `.superpowers/sdd/<slug>-plan/progress.md`. Never re-run finished tasks.

`options` (e.g. `-no-e2e`) are restored from the state file. An option given in this invocation wins.

## External PRD import

For a PRD written outside the pipeline. The router never edits the PRD.

1. Check the file where it is:
   ```bash
   node <plugin>/scripts/coverage-gate.mjs --prd <path> --lint
   ```
2. `ok: false` or non-empty `lint.errors` → print a fix list and **stop**. One line per error: location (heading or line) · expected format (the heading or field for config `locale`, from `<plugin>/kit/artifact-labels.mjs`) · current value. Add `lint.warnings` below it. Do not fix the PRD and do not open G1. The user fixes it by hand (or reworks it with `dev-pipeline:prd-extract`) and runs the same router command again.
3. No errors → open **G1** (one `AskUserQuestion`):
   - slug — when the file is already `<worksDir>/<dir>/prd.md`, propose `<dir>`; otherwise propose one from the issue key and the PRD title (see Slug). Run the pre-emption check first, but ignore a hit on `<worksDir>/<dir>` itself — that is the PRD being imported, not someone else's work. Any other hit is a real collision.
   - which items under `## Open Questions` (`ko`: `## 확인 필요`) block the next stage — a blocking item stops the import the same way as step 2
   - the progress choice (Gates and the next session)
4. On approval, place the PRD at `<worksDir>/<slug>/prd.md` by one rule:
   - file outside `<worksDir>` → copy it (`mkdir -p <worksDir>/<slug> && cp <path> <worksDir>/<slug>/prd.md`); the original stays untouched
   - file at `<worksDir>/<dir>/prd.md` and the slug kept as `<dir>` → nothing to do
   - file at `<worksDir>/<dir>/prd.md` and the slug renamed at G1 → move the directory: `git mv <worksDir>/<dir> <worksDir>/<slug>` (plain `mv` if it is untracked); `sourcePath` keeps the path as given
   - write the state file with `"source": "external"`, `"sourcePath": "<path as given>"`, the `prd-extract` stage `done` with `confirmedAt`, and `next` = `tc-extract`
   - go to the TC node (or stop for a new session, per the progress choice)

## Node call convention

The router calls each node skill with `--pipeline <slug>` (the PRD node of a new run gets `--pipeline` alone; it proposes the slug). `dev-pipeline:tdd-implement` is the exception: it takes the slug from its input path, opens its own gates (G3a, G3) with the progress question in the same call, and updates its own stages; the router does not ask the progress question again. A node that receives `--pipeline`:
- does not ask for a save path; it saves to `<worksDir>/<slug>/` under its fixed file name
- skips its own final confirmation question and "next step" guidance; the human confirms once, at the router's gate, so nothing is asked twice
- ends with a **gate summary**: artifact path · key metrics · pending decisions (only what a human must decide) · deterministic check result (the `lint.errors` list when not empty, or `error` when `ok` is false)

Run standalone (no `--pipeline`), a node does its own confirmation and guidance as usual.

## Gates and the next session

A gate is **one** `AskUserQuestion`, with up to 4 questions in that call (e.g. confirm the pending decisions + how to proceed). The progress question is asked by whoever opens the gate — the router, or tdd-implement at G3a / G3 — never by both.
- `description` carries: artifact path · metrics · pending decisions.
- Never re-ask as a checklist what a deterministic check already covered.
- Put `(Recommended)` only on an option that has a basis, and name the source in the description. The PRD comes first, then sibling convention (the existing branches of the same switch, existing code that reads the same input). Only PRD items marked as stated count; an inferred item is the PRD node's reading and does not override sibling convention. A requirement like "same as existing X" settles only what X explicitly covers. Never recommend an option that departs from convention without a basis. When siblings disagree, the sibling at the insertion point (the existing branches of the same switch) wins: entry information visible only at that spot (e.g. a flag the caller passes in) is not overridden by other code that reads the same input elsewhere. When siblings of the same rank disagree there is no convention: recommend neither and put both locations in the description; if the PRD wording decides it (even inferred), the PRD is the basis. No basis → no recommendation on that question. A recommendation tends to be clicked as is, so an unfounded one passes without review.

Progress options:

| Option | Action |
|---|---|
| `Next step in a new session (Recommended)` | update state (`done` + `confirmedAt`, `next`) → copy the resume command to the clipboard → the session handoff message (User-facing output) → stop |
| `Continue in this session` | update state, then call the next node |
| `Re-run this step` | take the correction, run the same node again (overwrites its artifact), return to the same gate |
| `Stop here` | save state, list the artifacts |

Why a new session: every node loads tens of thousands of characters of skill text into the context. Later nodes then pay that cost every turn and lose quality. Every artifact is a file, so nothing is lost by splitting.

Resume command — always show it (User-facing output, session handoff), and copy it with the first clipboard tool that exists (`pbcopy` macOS, `xclip` Linux/X11, `clip.exe` Windows/WSL). None, or the copy fails → print only.

```bash
# standalone tdd-implement handoff: CMD="/dev-pipeline:tdd-implement <worksDir>/<slug>/<slug>-plan.md"
CMD="/dev-pipeline:<pipeline> <slug>"; COPIED=
if command -v pbcopy >/dev/null 2>&1; then printf '%s' "$CMD" | pbcopy && COPIED=1
elif command -v xclip >/dev/null 2>&1; then printf '%s' "$CMD" | xclip -selection clipboard && COPIED=1
elif command -v clip.exe >/dev/null 2>&1; then printf '%s' "$CMD" | clip.exe && COPIED=1
fi
echo "copied=${COPIED:-0}"   # picks line 3 of the handoff message
```

The last node's gate offers only `Done` / `Re-run this step` / `Stop here`. After `Done`, auto-dev-pipeline runs `superpowers:finishing-a-development-branch` (tdd-implement runs it at G3 instead only when standalone or with `-no-e2e`). The node report's conclusion is the basis: `Approvable` (`ko`: `승인 가능`) → recommend `Done`; a defect left (`Not approvable — …` / `승인 불가 — …`) → recommend `Re-run this step`; `Needs review` (`확인 필요`) → list the remaining items in the question and recommend nothing.

**Gate text** (in `language`, see User-facing output):
- write non-ASCII text literally — never `\uXXXX` escapes (one wrong digit is a different, valid-looking character)
- no unreplaced `[...]` placeholders
- no code or paths in labels (put them in the description)

## Slug

The identifier of one feature and the join key across its artifacts.

```
<worksDir>/<slug>/{prd.md, tc.md, <slug>-plan.md, red-evidence.jsonl, state.json, e2e-report.md, e2e-loops.json}
.superpowers/sdd/<slug>-plan/   SDD workspace (derived from the plan's basename)
<e2e.specsDir>/<slug>/          E2E specs
<branchPrefix><slug>            branch (auto-dev-pipeline)
```

- **Format**: `<issue key>-<feature-kebab>` or `<feature-kebab>`. The issue key matches config `issueKeyPattern` and is taken from the argument, then the current branch name. The feature part is lowercase kebab-case ASCII — it becomes a directory and a branch name. Never force an issue key.
- **Who sets it**: the PRD node proposes it from the feature name when it drafts, and saves under it. The human confirms it once at G1. Renamed at G1 → `git mv` the directory; no other artifact exists yet, so this costs nothing. Only the plan keeps the slug in its file name, because the SDD workspace is named after the plan's basename.
- **Pre-emption check** (right before saving; never skip — a colliding slug overwrites someone else's work):
  ```bash
  ls -d <worksDir>/<slug> <e2e.specsDir>/<slug> 2>/dev/null; git branch -a --list "*<slug>*"
  ```
  A hit → let the user pick `Resume that work` / `Use another slug` / `Stop`.

## State file

Path: `<worksDir>/<slug>/state.json` (gitignored; the `init` skill adds the rule).

```json
{
  "pipeline": "auto-dev-pipeline",
  "slug": "PROJ-1234-list-filter",
  "issue": "PROJ-1234",
  "createdAt": "2026-10-12T07:00:00.000Z",
  "baseCommit": "8cfcdb0",
  "options": [],
  "stages": [
    { "name": "prd-extract", "status": "done", "artifact": "<worksDir>/PROJ-1234-list-filter/prd.md", "confirmedAt": "2026-10-12T07:20:00.000Z" },
    { "name": "tc-extract", "status": "pending", "artifact": null, "confirmedAt": null }
  ],
  "next": "tc-extract"
}
```

- Stage names: `prd-extract` · `tc-extract` · `tdd-plan` · `tdd-impl` · `e2e-test`. Each pipeline keeps only the ones it uses.
- `status`: `pending` / `running` / `done` / `skipped`. `skipped` is a deliberate choice, never a failure; record `skipReason`.
- `done` is written only when the gate passes. A written file is not completion.
- `createdAt` and `confirmedAt` are UTC ISO strings (`new Date().toISOString()`).
- `artifact` values are repo-relative paths as on disk (not placeholders).
- `issue`: the issue key or `null`.
- `baseCommit`: `git rev-parse --short HEAD` when the state file is created. G3 measures the run's changes from it (`surface-gate --state`), so nobody has to guess the default branch.
- Imported runs add `"source": "external"` and `"sourcePath"` (the PRD path the user gave). Runs the PRD node started carry neither.
- `selectorsRefreshed`: `true` once auto-dev-pipeline's E2E node has corrected the predicted selectors (so it is not done twice); absent before.
- Create the directory if missing: `mkdir -p <worksDir>/<slug>`.
