# Interview mode — one spec through questions

Minimum path is three rounds (screen → interaction → summary). Every `AskUserQuestion` follows the text check in SKILL.md. Steps marked `[optional]` are skipped with defaults unless the user raised the topic; anything already given in the argument skips its step.

| Step | Tool | Notes |
|---|---|---|
| 1 screen | `AskUserQuestion` or free text | catalog options when `e2e.screenCatalog` is set |
| 1.5 test name | text | |
| 2 entry mode | `AskUserQuestion` | fixtures vs live data |
| 2-A fixtures | `fixture-advisor` + `AskUserQuestion` | direct URL mode only |
| 2-B navigation plan | `navigation-advisor` + schema check + 2 × `AskUserQuestion` | live data mode only |
| 3a start URL | `AskUserQuestion` | |
| 3b interaction steps | `AskUserQuestion` + text | direct URL mode |
| 3c render-ready condition | `AskUserQuestion` | |
| 4 verification types | `AskUserQuestion` multiSelect | |
| 4-1.5 candidates | `verification-advisor` | |
| 4-2 pick checkpoints | `AskUserQuestion` multiSelect (+ text loop) | |
| 4.5 success criteria | `AskUserQuestion` `[optional]` | |
| 4.7 notes | `AskUserQuestion` `[optional]` | |
| 5+6 verdict + extras | `AskUserQuestion` × 2 | verdict question skipped when `ai.provider` = none |
| summary | `AskUserQuestion` | |
| 7 completion | `AskUserQuestion` (after runtime PASS) | |

## Step 1 — Screen

If `e2e.screenCatalog` is configured, read it and ask:

**Question**: "Which screen is under test?"
- header: `Screen`
- options: up to 4 catalog entries by name (description: url · file), then the user can type another name via Other.

Without a catalog, print: "Which screen or feature is under test? Name it as you would to a teammate (e.g. `search results`, `checkout address form`)." and wait for text.

Then `Agent(dev-pipeline:screen-context)` with the name. Confirm in one line: "`<name>` → `<pageFile>` (url `<url>`). Correct?" — the user corrects via text. `confidence: low` → say which parts are guesses.

The resolved screen name is the `screen` value passed to `analyze()` and to every agent.

## Step 1.5 — Test name (text)

"Name the test. It becomes the spec file name (`<e2e.specFilePrefix><kebab>.spec.js`) and the describe title."

## Step 2 — Entry mode → `AskUserQuestion`

Explain the trade-off in the description, in these words:

- **Direct URL + fixtures** — open the target page directly and pin API responses to saved fixtures. Verifies **app logic only** (rendering, state transitions, flow). Backend and asset availability are out of scope; unmatched requests are stubbed so image 404s cannot fail the test. Deterministic, CI-safe. Fixtures must be real captured data to avoid reference errors.
- **Live data + goal-directed navigation** — run against live backend data and navigate to the target by describing it. Detects backend errors (4xx/5xx are meaningful). Fits pages whose data keeps changing. Tag `@live-data`, keep out of CI.

**Question**: "How should the test reach the target page?"
- header: `Entry mode`
- options:
  - `Direct URL + fixtures` — deterministic, app logic only
  - `Live data + goal-directed navigation` — live backend, backend errors detected

Selection guidance (internal): dynamic/personalised/real-time pages → live data; deterministic UI logic (rendering, flows, focus) → fixtures. Never show plan identifiers or agent names.

### 2-A — Direct URL + fixtures → `fixture-advisor` → `AskUserQuestion`

`Agent(dev-pipeline:fixture-advisor)` with the screen (and endpoints if the user mentioned any).

**Question**: "These API mocks are recommended for `<screen>`. How should we proceed?"
- header: `API mocks`
- options built from the result:
  - `Use the recommendation (Recommended)` — list in description; when the advisor reports a `skeleton` or `gap`, drop `(Recommended)` and add the warning "fixture `<file>` is empty/placeholder — the app will take default paths"
  - `Add or replace fixtures` — file name + URL pattern as text
  - `No mocks, live API` — effectively switches to live data mode without navigation plan
  - `Add an error scenario` — one endpoint answered with 4xx/5xx (text)

Related existing specs from the advisor go into the description as "see also: `<path>`".

### 2-B — Live data + goal-directed navigation → `navigation-advisor` → 2 × `AskUserQuestion`

1. Print: "Describe what the test should reach — the content or page, in one sentence. Example: `the first movie card whose genre is Action`, `the settings tab that shows the billing form`." Wait for text.
2. `Agent(dev-pipeline:navigation-advisor)` with `scenario`, `screen`, `pageFile`, `interaction` = `e2e.interaction`, `previousContext: null`.
3. **Schema gate**: save the returned plan to a scratch file and run `node "${CLAUDE_PLUGIN_ROOT}/scripts/nav-plan-schema.mjs" <file>`. `valid: false` → re-call the advisor with `errors[]` in `previousContext`; never show an invalid plan to the user.
4. **Plan confirmation**:
   **Question**: "Proceed with this navigation plan?"
   - header: `Navigation plan`
   - description: start URL · each step in plain words (targets by their `by`/`value`) · post-entry condition (or "arrival only") · advisor notes; `confidence: low` adds "needs a check against the code"; `existingPattern` adds "similar spec: `<path>`"
   - options: `Use this plan (Recommended)` / `Edit the plan` (JSON as text, re-validated) / `Fail instead of skip when the target is not found`
5. **Step-list confirmation** — translate the plan into the exact sequence the browser will execute:
   ```
   1. open <startUrl>, wait until the app is ready
   2. wait for <selector/expr> (≤ N ms)
   3. click <target>
   4. find and enter <target> — skip the test if not found
   5. confirm arrival: <postEnterCondition or 'URL changed'>
   ```
   **Question**: "Run these steps as listed?"
   - header: `Steps`
   - options: `Yes, generate the spec (Recommended)` / `Adjust timeouts or loop limit` (text) / `Change a target` (text → advisor re-run)

The confirmed plan is passed to spec-writer as `navigationPlan`; `startUrl` from the plan overrides Step 3a when present. The generated spec's first line is `// @live-data — depends on live backend data`.

## Step 3a — Start URL → `AskUserQuestion`

**Question**: "Where does the test start?"
- header: `Start URL`
- options: the screen-context URL first, catalog URL if any, `/`, `Pass — use /`. Other for a custom path.

Skipped when the navigation plan already fixed `startUrl`.

## Step 3b — Interaction steps → `AskUserQuestion` (+ text) — direct URL mode only

**Question**: "Are interactions needed after the page loads?"
- header: `Interactions`
- options: `Describe them` / `Analyse a screenshot or design link` / `None — check rendering only`

`Describe them`: print the DSL cheat-sheet (`click(<target>)`, `fill(<target>, 'text')`, `press('Enter')`, `waitFor: <expr|css> / { timeout }`, `loop press('ArrowDown') × max N: <expr> → break`) and wait for text. Targets prefer `testid:` / `role:` / `text:`; bare CSS is accepted.

`Analyse a screenshot or design link`: read the attachment (a Figma link only when a Figma MCP tool is available in this session; otherwise ask for a screenshot), propose the interaction sequence, and confirm it as text.

The sequence is converted into plan steps exactly as batch-mode.md's DSL table describes.

## Step 3c — Render-ready condition → `AskUserQuestion`

**Question**: "What tells us the screen has fully rendered?"
- header: `Render-ready`
- options: up to 3 `renderSelectorCandidates` from screen-context (label: plain description; description: the selector and its condition), then `Pass — app ready only` (`adapter.waitForAppReady` without a selector). Other: custom CSS or a JS expression.

## Step 4 — Checkpoints (2 rounds + add loop)

### Round 1 — types → `AskUserQuestion` multiSelect

**Question**: "What should the test verify?"
- header: `Verification types`
- options: `DOM` (element visible/hidden/text) · `Focus` (which element/area holds focus) · `State` (**only when `ui.stateBridge` is set**) · `Runtime only` (no console errors + AI verdict)

`Runtime only` alone → skip 1.5 and 2, `verifications = []`.

### Round 1.5 — `verification-advisor`

`Agent(dev-pipeline:verification-advisor)` with `screen`, `pageFile`, `selectedTypes`, and a one-line entry summary.

### Round 2 — pick → `AskUserQuestion` multiSelect

**Question**: "Select the checkpoints to include."
- header: `Checkpoints`
- options: up to 4 per type from the advisor, label `[DOM] <plain description> → visible`, description with the descriptor and the code reason; plus `Add my own`.
- `confidence: low` → description adds "confirm against the code"; `existingPattern` → "similar spec: `<path>`".

Selected items → `verifications[]` (`cp-01`, `cp-02`, … in selection order):

```
"[DOM] testid:card-title → visible"         → { type:'DOM', target:{by:'testid',value:'card-title'}, condition:'visible' }
"[DOM] .title → hasText('Inception')"       → { type:'DOM', target:{by:'css',value:'.title'}, condition:"hasText('Inception')" }
"[Focus] activeElement matches('.search')"  → { type:'Focus', target:'activeElement', condition:"matches('.search')" }
"[State] catalog.items → length(12)"        → { type:'State', path:'catalog.items', condition:'length(12)' }
```

`Add my own` → text prompt with the three formats (`<target> → <condition>`, `activeElement → matches('<css>')`, `<store>.<path> → <condition>`), then `AskUserQuestion`: `Add another` / `Done (N checkpoints)`.

## Step 4.5 — Success criteria → `AskUserQuestion` `[optional]`

**Question**: "How should 'success' be described for the AI verdict?"
- header: `Success criteria`
- options: `Generate from the checkpoints (Recommended)` / `Add a one-line scenario` (text → also passed as `acceptanceCriteria`) / `Write it myself` (text) / `Pass — none`

Auto template: `"After entering <screen>, <checkpoints in plain words joined with 'and'>."` When `e2e.softTrack` applies to a checkpoint, phrase it as "the request is issued", not "the response arrives".

## Step 4.7 — Notes → `AskUserQuestion` `[optional]`

**Question**: "Any caveats for this test?"
- header: `Notes`
- options: `None (Recommended)` / `Depends on specific fixture data` / `Some checks cannot complete in this environment` (soft-track reminder) / `Write a note` (text)

Notes land in the spec header comment.

## Step 5+6 — Verdict and extras (one round, two questions)

**Question 1** (skipped when `e2e.ai.provider` is `none`): "AI verdict threshold?"
- header: `Verdict`
- options: `Allow WARNING (Recommended)` → `['PASS','WARNING']` / `PASS only` → `['PASS']`

**Question 2**: "Change any extra settings?" — multiSelect
- header: `Extras`
- options: `Defaults (Recommended)` (screenshot always, no console whitelist) / `Screenshot on failure only` / `Add console-error patterns to ignore` (text, one per line → `CONSOLE_ERROR_WHITELIST`)

## Summary → `AskUserQuestion`

**Question**: "Generate the spec with these settings?"
- header: `Summary`
- description:
  ```
  file        <e2e.specsDir>/<slug>/<prefix><kebab>.spec.js
  test name   <name>
  screen      <screen>
  entry       direct URL + fixtures | live data + navigation (@live-data)
  fixtures    <list or none>
  start URL   <url>
  steps       <one line>
  checkpoints <n>: [DOM] … (cp-01) / [Focus] … (cp-02) / …
  success     <text or none>
  verdict     <statuses>
  whitelist   <patterns or none>
  notes       <text or none>
  ```
- options: `Generate` / `Change something` (text) / `Start over`

`<slug>` for interview mode = kebab-case of the screen name unless the user gave a slug in the argument.

## Generation

Call `Agent(dev-pipeline:spec-writer)` with the assembled input, then `Agent(dev-pipeline:spec-reviewer)`, then the runtime loop — exactly as SKILL.md's chain describes.

## Step 7 — Completion interview (after runtime PASS)

**Question**: "Does the generated test do what you intended?"
- header: `Completion`
- options:
  - `Done` — print the file path and finish
  - `Refine` — text: what to change. Re-call spec-writer with it as `previousContext`; when the change concerns navigation, re-call navigation-advisor first. Re-verify (`spec-lint` via Bash; state probe only if State paths changed). Re-enter the runtime loop with `iteration = 1`. On PASS, return to this question.
  - `Discard` — second confirmation below

**Discard confirmation**: "Delete the file generated in this session? Target: `<outputPath>`"
- header: `Delete`
- options: `Delete` — remove `<outputPath>`; remove `<e2e.specsDir>/<slug>/` only if it is now empty; never touch fixtures or other specs / `Keep the file`

Deletion is limited to the `outputPath` this session created.
