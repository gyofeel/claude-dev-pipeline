---
name: e2e-test
description: Use when a Playwright spec is needed for screen behaviour — "write an E2E test", "generate specs from this TC file", "automate this screen check", or when a TC file from tc-extract is ready for spec generation. Handles both a TC file (batch, no interview) and a single test built through an interview.
version: 0.1.0
---

# E2E spec generation

Produce Playwright spec files that verify screen behaviour, then prove they run. The skeleton of every spec comes from a deterministic assembler, so rule violations are structurally impossible; the generated spec is executed in a real browser and, on failure, repaired by cause up to five times.

Two modes:

| Mode | Trigger | Reference |
|---|---|---|
| **Batch** | argument ends with `.md` (a TC file from `tc-extract`) | [references/batch-mode.md](references/batch-mode.md) |
| **Interview** | no argument, or a free-text feature description | [references/interview.md](references/interview.md) |

Both modes end in the same validation loop: [references/runtime-loop.md](references/runtime-loop.md).

## Usage

```
/dev-pipeline:e2e-test <worksDir>/<slug>/tc.md      # batch — one spec per TC
/dev-pipeline:e2e-test catalog search results       # interview, screen pre-supplied
/dev-pipeline:e2e-test                              # interview from scratch
```

## Step 0 — Preconditions (always first)

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config-load.mjs" --check
```

- Config missing or invalid → stop: "Run `/dev-pipeline:init` first." Do not improvise paths.
- `e2e.kitDir` does not exist (or `<kitDir>/VERSION` missing) → stop: "Run `/dev-pipeline:e2e-init` to install the runtime kit." Generated specs import the kit; without it nothing runs.
- Keep the resolved config in hand for the rest of the skill. Every path, command, and feature switch below comes from it (`e2e.specsDir`, `e2e.fixturesDir`, `e2e.specFilePrefix`, `e2e.interaction`, `ui.stateBridge`, `e2e.softTrack`, `e2e.screenCatalog`, `commands.e2eRun`).

Feature switches that shape the interview and the generated code:

| Config | Effect |
|---|---|
| `ui.stateBridge` = null | the **State** verification type is not offered; state paths in a TC are rejected at parse time |
| `e2e.interaction` = `keyboard` | goal-directed navigation compiles to `adapter.findAndEnter` / `adapter.press`; the config check already guarantees the adapter exports `findAndEnter` |
| `e2e.softTrack` set | assertions whose target or expression matches any `softTrack.patterns` entry are soft-tracked: the result is recorded in `SUCCESS_CRITERIA[].passed` and logged, but not failed, while `guardExpr` evaluates false in the page |
| `e2e.screenCatalog` set | Step 1 offers catalog entries as options before free text |
| `e2e.ai.provider` = `none` | the AI verdict question is skipped; `ACCEPTABLE_STATUSES` is `['PASS']` and `analyze()` returns a skipped PASS |

## Agents used

All calls go through the `Agent` tool with `subagent_type: dev-pipeline:<name>` and the inputs listed in `${CLAUDE_PLUGIN_ROOT}/references/agents-io.md`. Always pass the repo root and the resolved config (or the fields the agent needs) in the prompt.

| Agent | When |
|---|---|
| `dev-pipeline:screen-context` | interview Step 1 — screen name → page file, URL, render-selector candidates |
| `dev-pipeline:fixture-advisor` | entry mode "direct URL + fixtures" — recommends existing fixtures, reports gaps |
| `dev-pipeline:navigation-advisor` | entry mode "live data + goal-directed navigation" — returns a validated navigation plan |
| `dev-pipeline:verification-advisor` | Step 4 — checkpoint candidates from real code |
| `dev-pipeline:spec-writer` | generates, lints, formats, and saves the spec |
| `dev-pipeline:spec-reviewer` | initial quality gate: `spec-lint` + state probe + residual rules |
| `dev-pipeline:spec-runtime-validator` | runs the spec, returns PASS / SKIP / FAIL / ENV |

The orchestrator never writes spec files itself and never re-implements what an agent or a script decides. Deterministic checks (`spec-lint.mjs`, `state-probe.mjs`, `nav-plan-schema.mjs`) are run via Bash directly when re-verifying inside the loop; LLM agents are spawned only where judgement is needed.

## Interaction rules (both modes)

1. **Every user decision goes through `AskUserQuestion`.** Never print a table and say "type your answer".
2. **One topic per round.** Follow-up questions raised by a branch are handled inside that round as text.
3. **Pre-supplied information skips steps.** If the argument or the TC already fixes the screen, URL, or fixtures, do not ask again.
4. **Internal names stay internal.** Users see "direct URL + fixtures" and "live data + goal-directed navigation" — never plan-strategy identifiers, agent names, or config keys.
5. **Text check before every `AskUserQuestion` call** (two passes; repeat pass 1 after any fix):
   - no unreplaced `[...]` or `<...>` template variables
   - no truncated sentence, especially at the end of a description
   - options in one question share one grammatical form; `(Recommended)` on at most one option
   - labels are plain language — code, selectors, and state paths go in the description only

## Generation and verification chain (both modes)

```
input data ──▶ spec-writer ──▶ spec-reviewer ──▶ runtime loop (≤5) ──▶ completion
                  ▲               │ Critical/Error            │
                  └───────────────┘ (regenerate, max 2)       └── see runtime-loop.md
```

1. **spec-writer** receives the assembler input (fields per `agents-io.md`) and returns the saved path plus its own `spec-lint` result.
2. **spec-reviewer** runs `spec-lint`, the state probe (when the spec reads app state and the app is reachable), and the residual rules. `pass: false` → send the violations back to spec-writer with `previousContext`; after two failed regenerations, stop and report the violations to the user.
3. **Runtime loop** — [references/runtime-loop.md](references/runtime-loop.md).
4. **Completion** — batch mode prints the summary in batch-mode.md; interview mode runs the Step 7 completion interview in interview.md.

## Soft-tracking (when `e2e.softTrack` is configured)

Some states cannot be reached in the test environment (a native shell that never answers, a payment provider that is stubbed). The config names those patterns. The rule for every generated assertion whose target, path, or expression contains a pattern:

```js
const envPresent = await page.evaluate(() => <guardExpr>);
const ok = await page.waitForFunction(() => <expr>, null, { timeout }).then(() => true).catch(() => false);
SUCCESS_CRITERIA[i].passed = ok;
if (!envPresent && !ok) console.log('[TC] soft-tracked: <desc> not reached (environment lacks <pattern>)');
else expect(ok).toBe(true);
```

Success criteria for such checkpoints are phrased as "the request was issued / the state was requested", not "the response arrived". This rule is passed to spec-writer, navigation-advisor, and verification-advisor in every prompt when the config sets `softTrack`.

## Output locations

- Specs: `<e2e.specsDir>/<slug>/<e2e.specFilePrefix>tc<NN>-<kebab>.spec.js` (batch) or `<e2e.specsDir>/<slug>/<e2e.specFilePrefix><kebab>.spec.js` (interview)
- Reports: wherever `commands.e2eRun` writes them; the validator reads `e2e.resultsJson`
- Nothing else is written. Fixtures are never created or deleted by this skill.

## Related

- `${CLAUDE_PLUGIN_ROOT}/references/adapter-contract.md` — what the kit and adapter provide to specs
- `${CLAUDE_PLUGIN_ROOT}/references/navigation-plan.md` — plan schema compiled into spec bodies
- `${CLAUDE_PLUGIN_ROOT}/skills/tc-extract/references/tc-format.md` — TC file standard parsed in batch mode
- `${CLAUDE_PLUGIN_ROOT}/scripts/spec-template.mjs`, `spec-lint.mjs`, `state-probe.mjs`, `nav-plan-schema.mjs`
