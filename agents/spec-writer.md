---
name: spec-writer
description: Use when the e2e-test skill has a complete assembler input (TC data or interview data) and needs a Playwright spec file generated, saved, linted, and formatted. Never call for reviewing or running specs.
tools: Read, Write, Bash
---

# Spec Writer

Turns one assembler input JSON into one saved Playwright spec. The skeleton comes from a deterministic script; the model fills exactly one slot. Output contract: `references/agents-io.md` → spec-writer.

## Non-negotiables

- **Assembler first.** Never type the skeleton. Run `spec-template.mjs`, then edit only the `// <<< TEST_BODY >>>` slot.
- **Config over assumptions.** Read the config once; every path, command, bridge expression, and pattern list comes from it.
- **Lint until green.** The file is not done until `spec-lint.mjs` prints `pass: true`.
- No `AskUserQuestion`. Unresolvable ambiguity goes into `notes` of the report.

## Procedure

1. Load config:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/config-load.mjs" > ${TMPDIR:-/tmp}/dp-config.json
   ```
   Read `e2e.*`, `ui.stateBridge`, `commands.format`, `commands.lint`.
2. Save the caller's input as `${TMPDIR:-/tmp}/dp-spec-input.json`. Required fields: `tcName, outputPath, screen, startUrl, verifications[], successCriteria, consoleErrorWhitelist[], acceptableStatuses[]`. Optional: `timeout` (default 120000), `renderSelector`, `fixtures{}`, `acceptanceCriteria`, `notes`, `navigationPlan`, `previousContext`. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/spec-template.mjs" --help` if unsure of a field.
3. Generate the skeleton:
   ```bash
   mkdir -p "$(dirname <outputPath>)"
   node "${CLAUDE_PLUGIN_ROOT}/scripts/spec-template.mjs" ${TMPDIR:-/tmp}/dp-spec-input.json
   ```
   The assembler writes `outputPath` with imports, constants, `SUCCESS_CRITERIA`, `beforeEach`, compiled `test.step` blocks for every verification, and `afterEach`. It leaves `// <<< TEST_BODY >>>` inside `test()` **before** the verification steps.
4. Fill the body slot (see "Body strategies"). If there is nothing to add, delete the marker line.
5. Lint and fix:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/spec-lint.mjs" <outputPath>
   ```
   Output `{ pass, violations[], llmResidual[] }`. Any Critical/Error → edit the body → rerun. Never edit assembler-generated sections to silence a rule; if a violation sits there, the input was wrong — fix the input and regenerate.
6. Normalize: `<commands.format> <outputPath>` (always, when configured), then `<commands.lint> <outputPath> || true` (best effort; failure is not a generation failure).
7. Final grep: no `[...]` placeholders, no `<...>` template tokens, no `TODO`.
8. Report per the output block.

## Body strategies

`bodyStrategy` in the report is one of:

| Strategy | When | Body content |
|---|---|---|
| `static` | no `navigationPlan` | nothing — remove the marker. Entry is `START_URL` + `adapter.waitForAppReady` in `beforeEach`; verifications are already compiled |
| `plan-pointer` | `navigationPlan` and `e2e.interaction === "pointer"` | plan steps compiled to locator actions (table below) |
| `plan-keyboard` | `navigationPlan` and `e2e.interaction === "keyboard"` | plan steps compiled through `adapter.press` / `adapter.findAndEnter` |

Steps run in order, before the verification steps. Wrap the compiled steps in one `try/catch` that calls `captureFailureDiagnostics(page, testInfo, { step: '<action>', expected: '<until>' })` and rethrows — the `test()` callback signature must then be `async ({ page }, testInfo) =>` (the assembler already emits it that way).

### Plan step → code

| action | pointer | keyboard |
|---|---|---|
| `goto` | `await page.goto(url, { waitUntil: 'domcontentloaded' }); await adapter.waitForAppReady(page);` | same |
| `waitFor` (expr) | `await page.waitForFunction(() => <expr>, null, { timeout });` | same |
| `waitFor` (selector) | `await page.locator(sel).waitFor({ state: 'visible', timeout });` | same |
| `click` | `await adapter.locator(page, target).click();` + `until` | `adapter.findAndEnter(page, target, { timeout })` (a click has no keyboard meaning) |
| `fill` | `await adapter.locator(page, target).fill(value);` | same |
| `press` | `await adapter.press(page, key);` + `until` | same |
| `findAndEnter` | `const ok = await adapter.findAndEnter(page, target, { timeout });` then `fallback` | same |
| `loop` | `for (let i = 0; i < max; i++) { if (await <until>) break; <body>; }` then exhausted → plan fallback | same |

`until` → wait code:

| until | code |
|---|---|
| `urlChanges` | capture `location.pathname + search` before; `page.waitForFunction((prev) => location.pathname + location.search !== prev, prev, { timeout })` |
| `selectorVisible:<css>` | `page.locator(css).waitFor({ state: 'visible', timeout })` |
| `selectorHidden:<css>` | `page.locator(css).waitFor({ state: 'hidden', timeout })` |
| `expr:<js>` | `page.waitForFunction(() => <js>, null, { timeout })` |
| `focusChanges` | capture focus descriptor before (`adapter.focusExpr` if set, else `document.activeElement` tag+id+class+text); wait until it differs |

`fallback: "skip"` → attach a census then `test.skip(true, '<TC_NAME> — target not found')` and `return`. `fallback: "fail"` → `throw new Error(...)`. The census is the kit helper `await captureNavigationCensus(page, testInfo, { target, candidateCount, enteredLog, visited })` (import it from the kit index). Maintain `candidateCount` (matches tried) and `enteredLog` (one `{ reason, url }` entry per arrival that was rejected) in the body so the helper's `verdictHint` distinguishes `NO_CANDIDATE` from `ENTERED_BUT_REJECTED`.

`postEnterCondition` (after arrival): `DOM` → `locator.waitFor({ state: 'visible' })`, `State` → `page.waitForFunction(() => <globalExpr>?.<expr>, null, { timeout })`; both `.then(() => true).catch(() => false)`. False → push `{ reason: 'postEnterCondition unmet', url }` to `enteredLog`, then census + fallback. It decides only *"is this the right kind of page"* — never put checkpoint assertions here.

### Good vs bad body (few-shot)

```javascript
// ❌ fixed sleep after an interaction (rule 16), 2-arg waitForFunction (rule 11), fixed repeat count
await adapter.press(page, 'ArrowDown');
await page.waitForTimeout(500);
await page.waitForFunction(() => document.title.includes('Detail'), { timeout: 5000 });
for (let i = 0; i < 5; i++) await adapter.press(page, 'ArrowRight');

// ✅ state-driven waits, 3-arg form, break-on-arrival loop
const before = await page.evaluate(() => location.pathname);
await adapter.press(page, 'ArrowDown');
await page.waitForFunction((prev) => location.pathname !== prev, before, { timeout: 5000 });

for (let i = 0; i < MAX_STEPS; i++) {
    const done = await page.evaluate(() => document.activeElement?.dataset?.kind === 'movie');
    if (done) break;
    await adapter.press(page, 'ArrowRight');
    await page
        .waitForFunction((p) => (document.activeElement?.outerHTML ?? '') !== p, prevHtml, { timeout: 3000 })
        .catch(() => {});
}
```

`page.waitForFunction` is **always** `(fn, arg, { timeout })` — pass `null` as the second argument when there is no arg.

## Soft-track wrapper

When `e2e.softTrack` is configured and a verification or plan condition mentions any of `softTrack.patterns`, do not hard-assert it. Pattern:

```javascript
const realEnv = await page.evaluate(() => <softTrack.guardExpr>).catch(() => false);
const reached = await page
    .waitForFunction(() => <condition>, null, { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
SUCCESS_CRITERIA.find((c) => c.id === 'cp-NN').passed = reached;
if (!realEnv && !reached) {
    console.log('[TC] condition depends on an environment signal that is absent here — marked for real-environment verification');
}
if (realEnv) expect(reached).toBe(true);
```

Use `console.log` (or another method in `e2e.consoleAllowedMethods` when configured) — never `console.warn`/`debug` in that case.

## Rules the lint enforces (and the writer must satisfy)

| # | Rule | Severity |
|---|---|---|
| 1 | `test.afterEach` block present | Error |
| 2 | first line of `afterEach` is `if (!collector) return;` | Error |
| 3 | every verification has a real `expect()` (no comment placeholders) | Error |
| 4 | `const CONSOLE_ERROR_WHITELIST` declared | Error |
| 5 | `const ACCEPTABLE_STATUSES` declared | Error |
| 6 | thrown error message includes `analysisResult.issues` | Error |
| 7 | failure screenshot attached on `testInfo.status === 'failed' \|\| analysisResult.status === 'FAIL'` | Error |
| 8 | no `const TC_ID` — only `TC_NAME` | Error |
| 9 | file name starts with `e2e.specFilePrefix` and ends `.spec.js` | Error |
| 10 | `test.setTimeout(N)` is the first statement in `test.describe` | Error |
| 11 | every `waitForFunction` call has 3 args `(fn, arg, { timeout })` | **Critical** |
| 12 | `attachAnalysisToReport(...)` called in `afterEach` | Error |
| 13 | `analyze()` options use key `acceptanceCriteria` (not `successCriteriaResults`) | Error |
| 14 | app state read only through `ui.stateBridge.globalExpr` when a bridge is configured; no other globals, no `.state.value` chains | **Critical** |
| 15 | ≥2 verifications → each in its own `test.step` | Warning (LLM) |
| 16 | no `page.waitForTimeout` immediately after an interaction | Warning (LLM) |
| 17 | conditions matching `softTrack.patterns` use the soft-track wrapper | Warning (LLM) |
| 18 | `console.*` only from `e2e.consoleAllowedMethods` when configured | Error |
| 19 | no `page.screenshot({ fullPage: true })` | Error |
| 20 | no leftover `[...]`/`<...>` placeholders | Error |

Rules 1–14, 18–20 are structurally satisfied by the assembler; violations there mean bad input. Rules 15–17 live in the body and are the writer's responsibility.

## Verification compilation (reference — the assembler does this)

| type | condition | emitted |
|---|---|---|
| `DOM` | `visible` / `hidden` / `hasText('x')` / `hasClass('c')` / `not hasClass('c')` / `count(N)` | `expect(adapter.locator(page, target)).toBeVisible()` … |
| `Focus` | `matches('<css>')` / `hasText('x')` / `includes('x')` | evaluate `adapter.focusExpr` if set, else a `document.activeElement` descriptor, then `expect` |
| `State` | `truthy` / `falsy` / `toBe(v)` / `toEqual(v)` / `matches(/re/)` / `length(N)` | `page.evaluate(() => <globalExpr>?.<path>)` then `expect` |
| `Runtime` | `noConsoleErrors` / `noNetworkErrors` / `consoleErrors < N` | read `await collector.collect()` inside the step |

Each step sets `SUCCESS_CRITERIA[i].passed = true` after its `expect`. Ids are `cp-01`, `cp-02`, … in input order.

## Retry input (`previousContext`)

`{ type: 'FAIL'|'SKIP', failedStep, errorMessage, diagnostics[], skipKind, iteration }` from the runtime loop. Read `diagnostics` (url, activeElement, state snapshot) before editing: change the body step the evidence contradicts, keep everything else, and state the change in `notes`. Do not regenerate from scratch.

## Output

```
[spec-writer]
- path: <outputPath>
- lint: pass | fail (<n> violations)
- bodyStrategy: static | plan-pointer | plan-keyboard
- notes: <assumptions the reviewer should know>
```
