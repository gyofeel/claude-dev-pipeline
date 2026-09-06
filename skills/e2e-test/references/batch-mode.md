# Batch mode — TC file → one spec per TC

Trigger: the argument ends with `.md`. No interview; every field comes from the TC file, which follows `${CLAUDE_PLUGIN_ROOT}/skills/tc-extract/references/tc-format.md`. Field names and `####` headers below are parse keys — match them exactly.

## B-Step 1 — Read and parse the TC file

Read the file. Extract:

**File level**
- feature name from `# <Feature name> Test Cases`
- slug: parent directory name of the TC file (e.g. `<worksDir>/home-filter/tc.md` → `home-filter`); fallback: kebab-case of the feature name; last resort: ask
- `> **Implementation mode**: new` present → checkpoints are predictions; note it in the summary
- every `### TC-NN:` header

**Per TC — `#### Metadata` table**

| Field | → assembler input |
|---|---|
| **TC ID** | id (`TC-01`) |
| **Spec file** | output file name (`(none)` → unit-only, skip with note) |
| **E2E suitability** | `manual` → skip, listed as "skipped (manual review)" |
| **Screen** | `screen` |
| **Start URL** | `startUrl` |
| **Fixtures** | `fixtures` route map — file names resolved under `e2e.fixturesDir`; `(none — live API)` → `{}` |
| **AI verdict** | `PASS only` → `['PASS']`, `WARNING allowed` → `['PASS','WARNING']` |
| **Console error whitelist** | `(none)` → `[]`, else split on commas |

**Per TC — sub-sections**

| `####` section | → |
|---|---|
| `Preconditions` | `**API mock**: <pattern> → <file>` bullets merged into `fixtures` |
| `Entry path` | navigation plan `steps[]` (DSL mapping below) |
| `Render-ready condition` | `renderSelector` (waitFor selector) or `readyExpr` (waitFor expr) or nothing (app ready only) |
| `Checkpoints` | `verifications[]` (mapping below) |
| `Success criteria` | blockquote text, `> ` stripped, joined → `successCriteria` |
| `Expected results` | header comment |
| `Notes` | `notes` (JSDoc comment) |

### Entry-path DSL → plan steps

| DSL | step |
|---|---|
| `goto('<url>')` | `{ action: 'goto', url }` (only when different from Start URL) |
| `waitForAppReady()` | nothing — the skeleton always calls `adapter.waitForAppReady` |
| `click(<target>)` | `{ action: 'click', target }` |
| `fill(<target>, '<text>')` | `{ action: 'fill', target, value }` |
| `press('<KEY>')` | `{ action: 'press', key }` |
| `waitFor: <expr or css> / { timeout: N }` | `{ action: 'waitFor', expr\|selector, timeout }` |
| `loop press('<KEY>') × max N: <expr> → break` | `{ action: 'loop', max: N, body: [{ action: 'press', key }], until: 'expr:<expr>' }` |
| `findAndEnter(<target>)` | `{ action: 'findAndEnter', target, until: 'urlChanges', fallback: 'skip' }` |

Target strings: bare CSS → `{ by: 'css' }`; `testid:x` → `{ by: 'testid', value: 'x' }`; `role:button[Save]` → `{ by: 'role', value: 'button', name: 'Save' }`; `text:Save` → `{ by: 'text' }`. A fixed repeat count without a condition is a format violation — report it and ask for the intended condition instead of generating a blind loop.

When the entry path contains only `goto`/`waitForAppReady`, `navigationPlan` is `null` and the body is the compiled verifications alone.

### Checkpoints → verifications

Each row → `{ id: 'cp-NN', type, target|path, condition, desc }` with `id` lower-cased. `Type` must be one of `DOM` / `Focus` / `State` / `Runtime`; any other value is a parse error (report, do not guess). `State` rows when `ui.stateBridge` is null → parse error: "State checkpoints need `ui.stateBridge` in the config". Entries marked `[verify: …]` are listed in B-Step 2's description so the user can drop or fix them before generation.

## B-Step 2 — Scope → `AskUserQuestion`

**Question**: "TC file read. Which TCs should become specs?"
- header: `Batch scope`
- description: parsed TC list (id · name · type · priority · e2e/manual/unit-only), plus any parse warnings and `[verify: …]` entries
- options:
  - `All e2e TCs`
  - `High priority only`
  - `Pick TCs` — ids as text (`TC-01, TC-03`)
  - `Switch to interview mode` — abandon batch

## B-Step 3 — Output directory → `AskUserQuestion`

Directory: `<e2e.specsDir>/<slug>/`. File name: the TC's **Spec file** value; if empty, `<e2e.specFilePrefix>tc<NN>-<kebab(name)>.spec.js`.

**Question**: "Confirm the output directory."
- header: `Output directory`
- description: the full path
- options: `Use this path` / `Rename` (text)

If the directory already exists, add the existing file list to the description and options `Overwrite matching files` / `Skip TCs whose file exists` / `Rename`. Never overwrite silently.

## B-Step 4 — Generate each TC

For every selected TC, in order:

1. Build the assembler input (fields per `agents-io.md` → spec-writer): `tcName` = the `### TC-NN: <name>` header text, `outputPath`, `screen`, `startUrl`, `timeout` (default 120000), `renderSelector`/`readyExpr`, `fixtures`, `verifications`, `successCriteria`, `notes`, `consoleErrorWhitelist`, `acceptableStatuses`, `navigationPlan`. When the plan is non-null, validate it first: write it to a scratch file and run `node "${CLAUDE_PLUGIN_ROOT}/scripts/nav-plan-schema.mjs" <file>`; `valid: false` → fix the mapping (it is a parser error, not a user question) and re-run.
2. `Agent(dev-pipeline:spec-writer)`.
3. `Agent(dev-pipeline:spec-reviewer)` with `verifications`. Critical/Error → spec-writer again with the violations as `previousContext` (max 2); still failing → record "generation failed" for this TC and continue with the next.
4. Runtime loop per `runtime-loop.md`. Batch mode has no Step 7; the loop's terminal state (PASS / kept-unverified / exhausted) is recorded for the summary.

Specs are written by spec-writer only; the orchestrator never writes them.

## B-Step 5 — Summary

```
Batch generation complete

Directory: <e2e.specsDir>/<slug>/
Generated (N):
  ✓ <file>  — TC-01: <name>   [PASS after 1 run]
  ✓ <file>  — TC-02: <name>   [PASS after 3 runs]
  ⚠ <file>  — TC-04: <name>   [kept unverified — ENV]
  ✗ TC-05: <name>              [exhausted after 5 runs — see report above]
Skipped:
  ⊘ TC-03: <name>  — manual review
  ⊘ TC-06: <name>  — unit-only (no spec file)

Run:
  <commands.e2eRun> <e2e.specsDir>/<slug>/
```

When the TC file was produced in new-implementation mode, add one line: "Checkpoints were predicted before implementation; any `NO_CANDIDATE`/undefined-path result above most likely means the TC's checkpoint table needs updating to the real values."

## Notes

- **Missing entry details**: when a TC has no entry path beyond `goto`, generate the spec with the render-ready wait only; do not invent interactions. Say so in the spec header comment.
- **Fixtures**: only files that exist under `e2e.fixturesDir` are mapped. A missing file → `route.fulfill` inline stub `{}` with a `// TODO fixture missing: <name>` comment, and the gap is listed in the summary.
- **Live API TCs** (`(none — live API)`) get `// @live-data — depends on live backend data` as the first line of the spec.
