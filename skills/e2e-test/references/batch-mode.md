# Batch mode — TC file → specs

Trigger: the argument is a `.md` TC file. No interview; every field comes from the TC file, which follows `${CLAUDE_PLUGIN_ROOT}/skills/tc-extract/references/tc-format.md`. Headings, bold field names and fixed values are parse keys and follow `${CLAUDE_PLUGIN_ROOT}/kit/artifact-labels.mjs` for config `locale`; this page shows the `en` labels (`ko` in brackets where it matters).

`--pipeline <slug>`: no questions in B-Step 3 except a directory collision, no closing question, and B-Step 7 ends with the gate summary.

## B-Step 1 — Read and parse the TC file

**File level**
- feature name from `# <Feature name> Test Cases`
- slug: `--pipeline <slug>` if given; else the TC file's parent directory name (`<worksDir>/list-filter/tc.md` → `list-filter`); else kebab-case of the feature name; last resort: ask
- `> **Implementation mode**: new` present → checkpoints were predicted before the code existed; note it in the summary
- every `### TC-NN:` header

**Per TC — `#### Metadata` table**

| Field | → assembler input |
|---|---|
| **TC ID** | the TC's id (`TC-01`); goes into the spec file name and the summary |
| **Spec file** | output file name; `(none)` → unit-only, skipped with a note |
| **E2E suitability** | `manual` → skipped, listed as "skipped (manual review)" |
| **Screen** | `screen` |
| **Start URL** | `startUrl` |
| **Fixtures** | cross-check only: every file listed here should have an `**API mock**` line in Preconditions. `(none — live API)` → `fixtures: {}` |
| **AI verdict** | not used — the verdict is rule-based PASS / FAIL |
| **Console error whitelist** | `(none)` → `[]`, else split on commas → `consoleErrorWhitelist` |

**Per TC — sub-sections**

| `####` section | → |
|---|---|
| `Preconditions` | each `**API mock**: <url glob> → <file>` line → one `fixtures` entry, glob copied verbatim (a glob for a query-string request ends with `*`) |
| `Entry path` | navigation plan `steps[]` (DSL table below) |
| `Render-ready condition` | `waitFor selector` → `renderSelector`; `waitFor expr` → `readyExpr`; `app ready only` → neither |
| `Checkpoints` | `verifications[]` (mapping below) |
| `Success criteria` | blockquote text, `> ` stripped, joined → `successCriteriaText` |
| `Expected results` | not passed; the checkpoints carry it |
| `Notes` | `notes` (header comment lines) |

Do not pass `isolate`. Whether the spec runs isolated is the assembler's decision from `e2e.bootFixtures`: a fixtures glob listed there → isolated (`testMode: 'fixture'`); none → real API (`testMode: 'real-api'`).

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

Plan targets: bare CSS → `{ by: 'css', value }`; `testid:x` → `{ by: 'testid', value: 'x' }`; `role:button[Save]` → `{ by: 'role', value: 'button', name: 'Save' }`; `text:Save` → `{ by: 'text', value: 'Save' }`. A fixed repeat count without a condition is a format violation — report it and ask for the intended condition instead of generating a blind loop.

When the entry path holds only `goto` / `waitForAppReady`, `navigationPlan` is `null` and `slotBody` is `''` (no interaction).

### Checkpoints → verifications

Each row, in table order, becomes one entry; the assembler numbers them `cp-01`, `cp-02`, … The Type column takes the seven types in the configured locale's labels (`tc.cp.*`): DOM · Focus (`포커스`) · State (`Store`) · Runtime (`런타임`) · URL · Popup (`팝업`) · Observe (`관측`). Any other value stops the assembler — report it as a parse error, do not guess.

| Type | Target / Path column → | Condition column → |
|---|---|---|
| DOM | `selector` (descriptor string as written: `.list-item`, `css:…`, `testid:…`, `role:…[…]`, `text:…`) | `condition` (empty → `visible`) |
| Focus | ignored (`focus`) | `condition` — `includes('…')`, a matcher call, or plain text (substring) |
| State | `path` (`<store>.<field>`) | `condition` |
| Runtime | `path` (`consoleErrors` / `networkErrors`) | `condition` — `isEmpty` or `filteredCount < N` |
| URL | `path` (`pathname` / `search` / `href`) | `condition` |
| Popup | `path` (`count` / `url`) | `condition` (`count` empty → `toBe(1)`) |
| Observe | `selector` (CSS) | `condition` — `peak <matcher>` / `texts hasText('…')` / `texts not hasText('…')` |

- `desc` = the Description cell verbatim. Keep any `[verify: …]` (`ko`: `[확인 필요: …]`) marker in it: the report picks those checkpoints out and shows their actual values for review.
- Description starts with `[before]` (`ko`: `[조작 전]`) → `before: true`; the assembler places the checkpoint ahead of the interaction. Never on an Observe row (the assembler stops).
- Observe description contains `observe Ns` (`ko`: `관측 N초`) → `window: N * 1000`; otherwise the assembler's 3 s window applies. A TC waits one window, read by all its Observe rows: the first Observe row's window (its `observe Ns`, else 3 s) wins, so put `observe Ns` on the first one.
- `e2e.softTrack` set and the row's target/path or the TC's Notes mention a `softTrack.patterns` entry → `soft: true`.
- A State row while `ui.stateBridge` is null → parse error: "State checkpoints need `ui.stateBridge` in the config".
- Conditions are copied as written. tc-format lists the accepted forms; anything else (including retired forms) stops the assembler with `unknown checkpoint condition`, which is a TC defect to report, not something to rewrite silently.

## B-Step 2 — Group TCs that share an entry (deterministic)

One spec file is one app boot per test. A file per TC can grow a feature to dozens of specs, so selected TCs are grouped by **entry key** = Start URL + the Preconditions API mocks + Entry path + Render-ready condition + Console error whitelist. Identical keys form one group; TCs whose whitelists differ stay in separate files (the whitelist constants are file-level).

- A group of two or more becomes **one file**: assembler input `cases: [{ tcName, verifications, successCriteriaText, slotBody?, screen? }, …]` with the shared fields (`startUrl`, `fixtures`, `renderSelector` / `readyExpr`, `consoleErrorWhitelist`, `timeout`) at the top level. File name `<e2e.specFilePrefix>tc<NN>-<NN>-<common-kebab>.spec.js` (first and last TC number). Each TC stays its own `test.describe`, so the report and `--grep "<TC name>"` still address it alone.
- TCs that share no key stay one file each.
- **More than 10 spec files for one feature → stop and report.** Re-check the TC file's `E2E basis` rows for TCs that belong in the unit layer first.

## B-Step 3 — Scope, groups and directory → one `AskUserQuestion`

Ask once, with up to three questions in the same call. Under `--pipeline`, ask none of them: generate every `e2e` TC, with the B-Step 2 groups as they are, into `<e2e.specsDir>/<slug>/`, and put the grouping in the gate summary. Only a directory collision (below) is asked.

1. **Scope** — "TC file read. Which TCs should become specs?"
   - header: `Batch scope`
   - description: parsed TC list (id · name · type · priority · e2e/manual/unit-only), plus parse warnings and `[verify: …]` entries
   - options: `All e2e TCs` / `High priority only` / `Pick TCs` (ids as text, `TC-01, TC-03`) / `Switch to interview mode`
2. **Groups** (omit when no group has two or more TCs) — "N TCs were grouped into M spec files."
   - header: `Spec grouping`
   - description: each group's TC list
   - options: `Use this grouping` / `One file per TC` / `Set groups myself` (text)
3. **Directory** — "Confirm the output directory."
   - header: `Output directory`
   - description: `<e2e.specsDir>/<slug>/`
   - options: `Use this path` / `Rename` (text)

File name: the TC's **Spec file** value; if empty, `<e2e.specFilePrefix>tc<NN>-<kebab(name)>.spec.js`.

**Directory collision** (asked in both modes): if the directory already exists, list its files and offer `Overwrite matching files` / `Skip TCs whose file exists` / `Rename`. Never overwrite silently.

## B-Step 4 — Generate and verify

1. **Build each input** (fields per `${CLAUDE_PLUGIN_ROOT}/references/agents-io.md` → spec-writer): `tcName` = the `### TC-NN: <name>` header text, `outputPath`, `screen`, `startUrl`, `timeout` (default 120000), `renderSelector` / `readyExpr`, `fixtures`, `verifications`, `successCriteriaText`, `notes`, `consoleErrorWhitelist`, `navigationPlan`, or `cases[]` for a group. When the plan is non-null, validate it first: write it to a scratch file and run `node "${CLAUDE_PLUGIN_ROOT}/scripts/nav-plan-schema.mjs" <file>`; `valid: false` → fix the mapping (a parser error, not a user question) and re-run.
2. **Write all specs at once**: one `Agent(dev-pipeline:spec-writer)` per file, all in one message. Each writer works only from its own input; it never reads the other specs of the batch.
3. **Static checks once for the whole batch**, after every writer returns:
   1. `node "${CLAUDE_PLUGIN_ROOT}/scripts/spec-lint.mjs" <spec>` for every spec in one Bash call. A spec with Critical/Error goes back to its spec-writer with the violations as `previousContext`.
   2. One `Agent(dev-pipeline:spec-reviewer)` with the list of spec paths and each spec's `verifications`. It returns one block per spec. Only specs with violations go back to spec-writer (max 2 rounds); still failing → record "generation failed" for that spec and continue.

   Calling the reviewer per spec costs two orchestrator turns each, and every turn re-reads the growing context; the residual rules are the same for every spec, so one pass judges them the same way.
4. **Runtime loop** per `runtime-loop.md`, one spec at a time (one dev server), in file order. When a spec leaves its loop (PASS, kept, exhausted), go to the next.

Specs are written by spec-writer only; the orchestrator never writes them.

## B-Step 5 — Generation summary

```
Batch generation complete

Directory: <e2e.specsDir>/<slug>/
Generated (N):
  ✓ <file>  — TC-01: <name>             [PASS after 1 run]
  ✓ <file>  — TC-02, TC-03: <name>      [PASS after 3 runs]
  ⚠ <file>  — TC-04: <name>             [kept unverified — ENV]
  ✗ <file>  — TC-05: <name>             [exhausted after 5 runs]
Skipped:
  ⊘ TC-06: <name>  — manual review
  ⊘ TC-07: <name>  — unit-only (no spec file)
```

When the TC file was produced in new-implementation mode, add one line: "Checkpoints were predicted before implementation; a `NO_CANDIDATE` SKIP or an empty actual value most likely means the TC's checkpoint table needs the real values."

## B-Step 6 — Final run and report

After every spec has left its runtime loop, run the whole feature directory once more with archiving on. This run is the source of the result report the gate reviews; loop runs (`E2E_ARCHIVE=0`) are not archived.

```bash
<commands.e2eRun> <e2e.specsDir>/<slug>/ --workers=1 > ${TMPDIR:-/tmp}/dp-pw-final-<slug>.txt 2>&1
grep "\[archive\]" ${TMPDIR:-/tmp}/dp-pw-final-<slug>.txt
```

- `E2E_ARCHIVE` must not be `0` in this shell; that is the only signal that skips the archive.
- Before running, check the port of `e2e.baseUrl` (`lsof -nP -iTCP:<port> -sTCP:LISTEN`). Playwright reuses a server that is already listening; if it was started from another checkout, the run tests the wrong code — stop and tell the user.
- `--workers=1`: specs on the real API booting in parallel can trip backend rate limits and fail flakily here after passing alone.
- Read the paths from the `[archive] report: <html> · <md>` line. The md is `<worksDir>/<slug>/e2e-report.md`; read its `- Conclusion:` (`ko`: `- 결론:`) line and its "Conclusion detail" items.
- The md is written only for an unfiltered run of the whole directory with a `tc.md` in `<worksDir>/<slug>/`. No `[archive] report:` line at all → the project's Playwright config lacks the json reporter or the archive reporter; say so and point to `/dev-pipeline:e2e-init --upgrade`.
- A spec that passed in its loop but fails here is a flakiness signal — report it as is.
- The exit code is not the verdict: the archive reporter makes the run exit non-zero when the report fails a test Playwright passed (a mock no test in the file used). Read the md either way.
- The human opens the report with `node <e2e.kitDir>/report/open.mjs`.

Re-running only this step (e.g. after gate decisions changed a TC or a spec) rebuilds the report; it does not touch `e2e-loops.json`.

## B-Step 7 — Close

Print the B-Step 5 summary with two more lines:

```
Report:     <html path>  (node <e2e.kitDir>/report/open.mjs)
Conclusion: <Conclusion value from e2e-report.md>
```

- **Standalone**: add the run command for later (`<commands.e2eRun> <e2e.specsDir>/<slug>/`) and finish.
- **`--pipeline`**: end with the gate summary instead (shared contract, node call convention) — artifact `<worksDir>/<slug>/e2e-report.md` · metrics (specs generated N · final run PASS N / FAIL N / SKIP N · skipped manual N · conclusion) · pending decisions (the report's "needs review" items: unmarked checkpoints, `[verify` values with their actuals, unmapped specs, loops ≥ `e2e.report.loopThreshold`, SKIPs, `DATA:` failures) · soft checkpoints, as a separate count: the conclusion does not list them, the HTML step list marks them "Recheck on device" · the grouping used. Ask nothing; the router's gate does.

## Notes

- **Missing entry details**: a TC with no entry path beyond `goto` gets the render-ready wait only; do not invent interactions. Say so in `notes`.
- **Fixture files**: map only files that exist under `e2e.fixturesDir`. A missing file → inline `{}` for that glob, a `notes` line `fixture missing: <file>`, and the gap in the summary. The spec then proves little for that endpoint; the report shows it.
- **Real-API TCs** (`(none — live API)`): no extra marker is needed; the assembler records `testMode: 'real-api'` and the judge treats API errors as failures in that mode.
