---
name: tc-extract
description: Use when a PRD (or a feature description) needs to become concrete, verifiable test cases before writing specs or implementation — including when the code does not exist yet. Triggers on "extract test cases", "TC from this PRD", "what should we verify", "test case list", or when /dev-pipeline:prd-extract has just saved a PRD.
---

# TC extraction

Reads the PRD, checks the code, and writes `<worksDir>/<slug>/tc.md`.
- **Format**: [references/tc-format.md](references/tc-format.md), exactly. The e2e-test batch parser, `tdd-implement` and `coverage-gate` read it.
- **Slug**: the PRD's parent directory name. Do not ask for a save path.

Selectors and state paths are read from code, never guessed. Each TC is classified by verification layer (unit / E2E / manual), and each TC without a unit test gets an implementation owner.

## Usage

```
/dev-pipeline:tc-extract <prd path> [--mode new|diff] [--pipeline <slug>]
```

- `--mode new` — the feature has no code yet.
- `--mode diff` — verify changed existing code.
- No mode → `new` when `git diff` is empty and none of the PRD's related files exist on disk, otherwise `diff`. Ask only when it is unclear.
- `--pipeline <slug>` — called by a pipeline router (`../auto-e2e-pipeline/references/shared-contract.md`, Node call convention). Skip the final confirmation and the next-step guidance and end with the gate summary (Step 4).

No PRD → take the feature scope and the ACs from the conversation and go on.

## Step 0 — Config

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config-load.mjs" --check
```

Missing or invalid → apply "Missing config" in the shared contract's User-facing output (`../auto-e2e-pipeline/references/shared-contract.md`), then re-run this step. Every path, command and capability below comes from the resolved config (`worksDir`, `language`, `locale`, `ui.*`, `unitTest.*`, `e2e.*`, `source.*`). Headings and field names follow `${CLAUDE_PLUGIN_ROOT}/kit/artifact-labels.mjs` for `locale`; talk to the user in `language` and shape every message by the contract's User-facing output (`../auto-e2e-pipeline/references/shared-contract.md`). Two capability facts matter now:
- `ui.stateBridge` is `null` → the `State` checkpoint type is unavailable. Propose no State rows; say so once in the summary.
- `unitTest.excludedAreas[]` is quoted verbatim when classifying the unit layer.

## Step 1 — Code surface

**diff mode**
- Base branch: `git symbolic-ref refs/remotes/origin/HEAD`; on failure the first of main → master → develop that exists.
- Changed files: `git diff <base>...HEAD --name-only` + `git diff HEAD --name-only`. Drop style-only files, config files and spec files.
- Run the `dev-pipeline:ui-selector-extractor` agent on the changed UI and state files to get real selectors, state paths and branch conditions. Pass the absolute file paths, the repo root, the resolved `ui.*` and the PRD scope only; the extraction rules live in the agent (contract: `${CLAUDE_PLUGIN_ROOT}/references/agents-io.md`).

**new mode** — there are no changed files. The question becomes "what will exist, and which existing file sets the convention for each?" The only deterministic source of conventions for code that does not exist yet is the sibling files on disk.
- **Planned paths**: find the nearest existing sibling in the same directory family as the PRD's files, and the test file next to it (per `unitTest.testNaming`).
- **Existing interpreters of the input fields**: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/field-consumers.mjs" <field>...` with the payload field names the PRD takes. If `parsers` already split or interpret the same field, do not design a new parser — reuse that code or follow its conversion (code tables and the like). Each interpreter reports the slots it reads as `segments`. For every new branch that takes the field, write the followed interpreter and whether each of its slots is used or dropped in the `## Input field interpretation` table (tc-format). Taking only some slots (the id but not the type code) makes the same input mean different things per path. Siblings alone miss interpreters in other directories.
- **Sibling branches at the insertion point**: when the feature adds a branch to an existing switch, if-chain or handler map, read every sibling branch there. Write what they all do (entry-path splits, the query they pass, guards) in the `Sibling convention` column. Unless the PRD explicitly covers it, the new branch follows it too. Not following it is raised as a `convention departure` in Step 4.
- **Shared flags the changed files toggle**: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/flag-effects.mjs" <file>...` on the existing files in `## Implementation surface`. Each result gets a row in `## Flag side effects` (tc-format). If the design keeps the flag true longer or releases it later, put the restore of what other files wrote meanwhile into the design and a unit TC.
- `field-consumers` / `flag-effects` printing `{ "error": "no-targets" }` is an error, never a pass: `source.roots` matched no source file or a given path does not exist. Fix the config or the paths.
- **Registration**: check `ui.registrationFiles` (barrels, registries, route tables). A new module missing there fails at runtime.
- **Mocks needed**: grep the sibling and its test for mock imports and helpers.
- When the feature attaches to an existing screen, run `dev-pipeline:ui-selector-extractor` on the sibling and the parent page to get the container's real hooks. Skip it for pure-logic features.
- The result is the `## Implementation surface` table at the end of the file. Existing interpreters to reuse go in the `Sibling convention` column.

**Existing spec overlap** (both modes): run the `dev-pipeline:spec-scanner` agent with `e2e.specsDir` and the feature scope, in the same message as the extractor. Mark full or partial overlaps on the TC as `merge with <spec>` / `extend <spec>`.

## Step 2 — Write the TCs

**Principles**
- Every AC has a TC.
- Cover each of: interface response branches (ok, each error code, empty, timeout), the UI scenario's screen states, code branches, regression of adjacent existing behaviour.
- Merge identical checkpoints.
- **Checkpoint selectors and state paths are the real values from Step 1.**
  - In new mode they are predictions from sibling conventions: suffix them `(new)` and put `> Predicted selectors for new implementation — verify after implementing` in `#### Notes`.
  - A value you could not confirm stays `[verify: …]`.
- Checkpoint types and condition forms are exactly those in tc-format (`#### Checkpoints`). The spec assembler rejects anything else.
- Entry paths use the tc-format DSL. **Never a fixed repeat count** — always a state-based loop.

**E2E suitability and basis**
- `manual` when it needs: a real device only, pixel or visual comparison (colour, font, layout by eye), live third-party data / payment / DRM, animation timing judged by eye, multi-device sessions.
  - Host messages can often be injected and host requests observed in dev (prd-format, Platform Interface). Such TCs are not device-only; re-judge when the PRD's `Reproducible in E2E` column says otherwise.
- `e2e` needs a one-line `E2E basis`. Only four bases are valid: focus or navigation result, rendered DOM or layer state, an observed host request, a page transition / reload / session-restore round trip.
- A basis that is really a branch decision, a computed value or an input/output contract makes the TC a unit target. One spec is one app boot; piling such TCs into E2E makes the suite too slow to run.

**Verification layer (`Unit target`)** — judged independently of E2E suitability; all four combinations are valid and a TC is never split.
- **Unit**: pure function input/output, state action transitions, server/domain modules and utilities, component render and props branches a shallow mount can observe.
- **Not unit** (`(none)`): everything in `unitTest.excludedAreas[]` (quote it), routing round trips, session restore, behaviour that needs a real host callback.
- **Test file path**: next to the module per `unitTest.testNaming`. It must match a `unitTest.testFileGlobs` entry and none of `unitTest.excludedFilePatterns`, or the runner never collects it.
- With a path, write `#### Unit checkpoints` with hand-computed literal expectations.

**Implementation owners** — new mode only. Every TC whose `Unit target` is `(none)` gets a row in `## Implementation owners`. Verification layer and implementation responsibility differ: e2e-test only writes specs, so a TC with no owner here is implemented by nobody.

```markdown
## Implementation owners

| TC | Owner | Reason |
|----|-------|--------|
| TC-11 | implement | wiring — fetch the remaining count on entry and render it |
| TC-17 | existing | the shared template already does this — regression check only |
| TC-24 | split PROJ-999 | entry path not reachable yet |
```

To propose `existing` for a TC with `(new)` surface, cite the file that already does it in the reason.

## Step 3 — Save and check

Save to `<worksDir>/<slug>/tc.md` (`mkdir -p` first), then:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/coverage-gate.mjs" --prd <worksDir>/<slug>/prd.md --tc <worksDir>/<slug>/tc.md --lint
```

- Read `ok` first. `ok: false` → the run failed (`no-ac`, `no-tc`, `no-related-ac` — usually a format or locale mismatch). Quiet output is not success.
- **`uncovered`** (ACs with no TC): add a TC. If the AC is out of scope, propose it in `## AC exclusions` (`| AC-NN | reason |`) and list it as a pending decision.
- **`lint.errors`**: fix and re-run until empty. `no-targets` means `source.roots` matched no source file or a listed file does not exist; fix the config or the paths, never read it as a pass.

## Step 4 — Confirm

Show:
- summary table: `| TC | Name | Type | Priority | E2E suitability | Unit (UCP count) | Owner | Overlap |`
- pending decisions:
  - the unit / E2E / manual classification — a focus-, render- or host-dependent TC carrying UCPs is caught here
  - proposed implementation owners
  - proposals to depart from sibling convention, marked `convention departure`, with the sibling code location and the PRD item that supports it, if any. Only `stated` PRD items count as support
  - proposed AC exclusions
  - `[verify: …]` items — except those sibling convention answers. When an `inferred` branch in the PRD's `## Open Questions` is handled the same way by the sibling branches, design it by convention and leave one line: `settled by convention: <item> — <sibling location>`. The human can reverse it at G2
  - overlapping specs
- the `coverage-gate` result (`lint.errors` when not empty, or `error` when `ok` is false)

With `--pipeline`, print this as the gate summary and stop; G2 is the router's. Standalone, confirm with one `AskUserQuestion`: `Confirm all` / `Enter corrections` / `Show a TC in full`. On confirmation, end with the one next action for the mode, alone in a code block:
- new mode → `/dev-pipeline:tdd-implement <worksDir>/<slug>/tc.md`, even with zero unit TCs: that only means all of the implementation is on the screen side
- diff mode → `/dev-pipeline:e2e-test <worksDir>/<slug>/tc.md`

**Priority**
- High: core flow, maps an AC directly, failure blocks the feature
- Medium: secondary behaviour, error handling
- Low: regression, boundary, fine tuning

**Type**: `happy path` / `error handling` / `ui` / `boundary` / `regression`

## Related

- `dev-pipeline:prd-extract` — produces the input PRD ([prd-format.md](../prd-extract/references/prd-format.md))
- `dev-pipeline:tdd-implement`, `dev-pipeline:e2e-test` — consumers
- `${CLAUDE_PLUGIN_ROOT}/references/agents-io.md` — agent contracts
