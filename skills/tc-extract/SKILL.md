---
name: tc-extract
description: Use when a PRD (or a feature description) needs to become concrete, verifiable test cases before writing specs or implementation — including when the code does not exist yet. Triggers on "extract test cases", "TC from this PRD", "what should we verify", "test case list", or when /dev-pipeline:prd-extract has just saved a PRD.
---

# TC extract

Turns a PRD into a TC file that two downstream skills share: `/dev-pipeline:e2e-test` (batch spec generation) and `/dev-pipeline:tdd-implement` (unit targets). Selectors and state paths are **read from code, never guessed**; each TC is classified by verification layer (unit / e2e / manual).

Output format: [references/tc-format.md](references/tc-format.md) — section names and metadata fields there are parse keys. Keep them exact.

## Usage

```
/dev-pipeline:tc-extract <prd path>
/dev-pipeline:tc-extract              # asks for the PRD path
```

The orchestrators pass the PRD path and a `slug`; when called that way, the slug they pass wins over anything derived here.

## Step 0 — Load config [automatic]

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config-load.mjs" --check
```

Missing or invalid → stop: "Run `/dev-pipeline:init` first." Keep the resolved JSON; every path, command, and capability below comes from it (`worksDir`, `ui.*`, `unitTest.*`, `e2e.*`). Note two capability flags now:

- `ui.stateBridge` — `null` means the **State** checkpoint type is unavailable in this project. Do not propose State rows; say so once in Step 3.5.
- `unitTest.excludedAreas[]` — quoted verbatim in Step 4b-2.

## Flow

```
Phase 1  PRD load        : Step 1 → 1.5
Phase 2  Code analysis   : Step 2 (files) → [2-G surface scan, new-implementation only]
                           → [Agent A ‖ Agent B] → Step 3.5 (merged confirm)
Phase 3  TC extraction   : Step 4b → 4b-2 → 4c → 4d → 5
```

Every confirmation is an `AskUserQuestion` — never a text table followed by "please answer". After each analysis, summarise what was understood and get confirmation before moving on. Gate text rules: no unreplaced `[...]`, no truncated lines, labels in plain language (code goes in descriptions).

---

## Phase 1 — PRD load

### Step 1 — Read the PRD [automatic]

Read the path from `$ARGUMENTS`. Missing file → ask for the correct path. Non-standard format → read what is parseable and flag it in Step 1.5.

### Step 1.5 — Confirm understanding → `AskUserQuestion`

Description summary:

```
📄 PRD as understood:
- Feature: …            - Scope: <screen > component>
- Requirements: 1. … 2. …
- Acceptance criteria: AC-01 … / AC-02 …
- Server interface: yes (N endpoints) / none / passed
- Platform interface: yes (N events) / none / passed     ← only when platformInterface.enabled
- UI scenarios: yes (N states) / none / passed
- Design guide: yes / none / passed
- Exceptions: …
```

- header: `PRD check`
- options: `Correct — analyse the code` / `Use a different PRD file` (text) / `Continue without a PRD` (use conversation context; if thin, collect scope + AC as text, then go to Step 2)

---

## Phase 2 — Code analysis

### Step 2 — Detect changed files → automatic, then `AskUserQuestion`

Run in order:

```bash
# ① base branch
git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@'
# fallback: first existing of main, master, develop
# ② changed files
git diff <base>...HEAD --name-only
git diff HEAD --name-only          # staged + unstaged
```

③ Filter out (list them separately, do not analyse): style-only files, comment/typo-only diffs, config files, test/spec files.

**Question**: "Confirm the files to analyse."
- header: `Analysis scope`
- description: base branch + filtered list + excluded list
- options:
  - `Use the detected files`
  - `Specify files` — paths as text
  - `Include the filtered files too`
  - `No files — PRD only` — skip code analysis, go straight to Phase 3
  - `New implementation — no code yet` — skip diff analysis, run **Step 2-G**

> Mark `New implementation — no code yet` as `(Recommended)` when the diff is empty **and** none of the PRD's related-file paths exist on disk. Still run ①②③ — their emptiness is the evidence for that recommendation.

After `Use the detected files` / `Specify files` / `Include…`: spawn **Agent A and Agent B in one message** (parallel), then go to Step 3.5. After `No files — PRD only`: skip to Phase 3. After `New implementation`: do Step 2-G, then Step 3.5.

### Step 2-G — Surface scan (new implementation only)

There are no changed files. The question becomes *"which files will exist, and which existing file sets the convention for each?"* The only deterministic source of living conventions is a **sibling file on disk** — find the nearest one instead of guessing. Collect this yourself with Read/Glob (payload is small):

| Item | How |
|---|---|
| Planned paths | PRD related files + server interface section + user confirmation |
| Nearest sibling | Glob the same directory family; pick the closest existing peer |
| Sibling test | the sibling's colocated test per `unitTest.testNaming` (the template the implementer copies) |
| Registration | only if the project has an explicit registration point (barrel/index, module registry, route table). Check `ui.pagesDir`/`ui.stateStoreDir` for an `index.*`; if unsure, ask once |
| Mocks needed | grep the sibling and its test for mock imports/helpers |
| Test path | colocated per `unitTest.testNaming`; must match a `unitTest.testFileGlobs` entry and none of `excludedFilePatterns` |

Agent calls in this mode:

- **Agent A** — only when the new feature attaches to an **existing screen**. Targets: the sibling file + the parent page, so the container's real hooks/state paths can fill CP rows. Pure-logic features (new util/store/server module): skip A.
- **Agent B** — always. Overlap detection matters *more* for new features (someone may already cover that screen).

The result becomes the `[implementation surface]` block in Step 3.5 and the `## Implementation surface` section at the end of the TC file.

### Agent A — `dev-pipeline:ui-selector-extractor` [spawned right after Step 2]

Prompt: repo root (absolute), resolved config `ui.*`, absolute file list, `scopeHint` = feature scope + target component from Step 1.5. Contract: `references/agents-io.md`. Extraction rules and return format live in the agent — do not repeat them.

### Agent B — `dev-pipeline:spec-scanner` [spawned in the same message]

Prompt: repo root, resolved `e2e.specsDir`, `scope` = feature name + screen + keywords from Step 1.5.

### Step 3.5 — Merged analysis confirmation → `AskUserQuestion`

```
🔍 Code analysis (A) + existing-spec overlap (B):

[changed components]      - <file>: <summary>
[DOM hook candidates]     - `<target>` — <condition>
[state path candidates]   - `<store>.<field>` — <type>      (omitted: stateBridge not configured)
[branch conditions]       - `<expr>` in <file>:<line>
[implementation surface]  (new implementation only)
[existing-spec overlap]   - full: … / partial: … / none
[uncertain]               - …
```

- header: `Analysis check`
- options: `Correct — generate TCs` / `Fix selectors or paths` (text) / `Add context` (business rules, backend conditions) / `Analyse more files` (text → re-run Agent A)

---

## Phase 3 — TC extraction

### Step 4b — E2E suitability [automatic]

`e2e` when the outcome is observable through DOM, focus, state (if bridged), or runtime signals; the environment is reproducible with fixtures; results are deterministic.

`manual` when it needs: a real device only, pixel/visual comparison (colour, font, layout by eye), live third-party data / payment / DRM, animation timing or easing, or multi-device sessions.

Result → metadata row **E2E suitability**; `manual` TCs also go to `## Manual review items`.

### Step 4b-2 — Unit layer (`Unit target`) [independent judgement]

Orthogonal to 4b; all four combinations are valid and **a TC is never split**.

Unit-able → `Unit target` = a test file path: pure functions (transform, compute, parse, decide), state actions/getters, server/domain modules and utilities, component render/props branches that a shallow mount can observe.

Not unit-able → `(none)`: everything in `unitTest.excludedAreas[]` (quote it verbatim), routing round-trips and session restore, and behaviour that needs a real platform callback.

Path rule: colocate with the module per `unitTest.testNaming`; the path must fall under `unitTest.testFileGlobs` and avoid `excludedFilePatterns`, otherwise the runner never collects it.

> This is the highest-impact judgement in the pipeline and it cannot be automated: with no code yet there is nothing for a script to read, and a keyword heuristic becomes a gate that gets gamed. The user confirms it in Step 4d.

### Step 4c — Draft TCs

From PRD + Phase 2 results + 4b/4b-2, generate TCs by these principles:

1. **AC 1:1** — one TC per AC minimum; no ACs → derive from requirements
2. **Interface coverage** — one TC per response branch (ok, each error code, empty, timeout)
3. **UI flow coverage** — one per screen state in the PRD
4. **Code branch coverage** — guards / computed flags from Agent A
5. **Regression** — adjacent existing behaviour of changed components
6. **Dedupe** — merge identical checkpoints; apply Agent B overlap notes (`regression — merge with <spec>` / `extend or merge`)
7. **Suitability** — 4b result
8. **Unit layer** — 4b-2 result; when a path is set, write `#### Unit checkpoints` with hand-computed literal expectations and `Target` = `<import specifier>#<export>` from the surface scan
9. **New-implementation markers** — `## Implementation surface` at the end; each TC's `#### Notes` gets `> Predicted selectors for new implementation — verify after implementing`; predicted values carry `(new)`

Checkpoint rows use values Agent A actually read. When analysis was skipped (`No files`), infer from the PRD (design-guide hooks, API fields) and existing specs under `e2e.specsDir`, and mark anything unconfirmed `[verify: selector not found]` / `[verify: state path not found]` for Step 4d.

Entry paths use the DSL from tc-format.md (`goto`, `waitForAppReady`, `click`, `fill`, `press`, `waitFor`, `loop … × max N: <expr> → break`, `findAndEnter`). **Never a fixed repeat count** — always a state-based loop.

### Step 4d — Summary → detail loop → `AskUserQuestion`

Print the summary table, then ask:

```
📋 TC draft (N)

| TC ID | Name | Type | Priority | CP | E2E | Unit | Overlap |
|-------|------|------|----------|----|-----|------|---------|
| TC-01 | … | happy path | High | 8 | e2e | UCP 3 | — |
| TC-03 | … | ui | Low | 3 | manual | UCP 2 | — |
| TC-04 | … | regression | Low | 5 | e2e | — | ⚠️ partial: <spec> |

Manual review: TC-03 (unit-verified)
Unit targets: TC-01, TC-03 → /dev-pipeline:tdd-implement
```

> The `Unit` column is where the user catches a wrong 4b-2 call — a focus/render/platform-dependent TC showing `UCP N` should be flipped here.

- header: `TC review`
- options: `Show a TC in full` (id as text → print all sub-sections → back to this question) / `Confirm all — write the file` / `Add, edit, or drop TCs` (text → apply → re-show) / `Start over`

### Step 5 — Save → `AskUserQuestion`

File name is fixed (`tc.md`); the thing confirmed is the **work directory (slug)**.

Slug precedence: 1) slug passed by the caller; 2) if the PRD path is `<worksDir>/<slug>/prd.md`, inherit that parent directory; 3) kebab-case of the feature name. Saving elsewhere breaks the pipeline — later stages read the slug from the parent directory.

**Question**: "Save the TC file. Confirm the path."
- header: `Save TC`
- description: `<worksDir>/<slug>/tc.md` · TC-01…TC-NN (N) · manual N
- options: `Save here` / `Change slug` (text; directory under `worksDir`) / `Back to the TC review`

`mkdir -p <worksDir>/<slug>` then write. Priority/type definitions: tc-format.md.

---

## Handoff message

**Existing code:**

```
✅ TCs extracted: <worksDir>/<slug>/tc.md   (N TCs)

Next — generate E2E specs in batch
/dev-pipeline:e2e-test <worksDir>/<slug>/tc.md
→ one spec per e2e TC in <e2e.specsDir>/<slug>/, no interview
```

**New implementation** (`> **Implementation mode**: new`):

```
✅ TCs extracted (new implementation): <worksDir>/<slug>/tc.md
   unit N · e2e M · manual K

Next — TDD implementation
/dev-pipeline:tdd-implement <worksDir>/<slug>/tc.md
→ implements the N unit-target TCs test-first, then hands off to e2e-test
```

If unit targets = 0: "No unit-target TCs — normal for this repository's testable boundary. Go straight to `/dev-pipeline:e2e-test`."

## Related

- `/dev-pipeline:prd-extract` — produces the input PRD ([prd-format.md](../prd-extract/references/prd-format.md))
- `/dev-pipeline:e2e-test`, `/dev-pipeline:tdd-implement` — consumers
- `${CLAUDE_PLUGIN_ROOT}/references/agents-io.md` — agent contracts
