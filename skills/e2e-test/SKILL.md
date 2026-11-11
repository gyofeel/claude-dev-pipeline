---
name: e2e-test
description: Use when a Playwright spec is needed for screen behaviour — "write an E2E test", "generate specs from this TC file", "automate this screen check", or when a TC file from tc-extract is ready for spec generation. Handles both a TC file (batch, no interview) and a single test built through an interview.
version: 0.2.0
---

# E2E spec generation

Produce Playwright spec files that verify screen behaviour, then prove they run. The skeleton of every spec comes from a deterministic assembler, so rule violations are structurally impossible; the generated spec is executed in a real browser and, on failure, repaired by cause up to five times. The verdict is rule-based (the kit's judge), never an AI call.

## Modes

| Argument | Mode | Read |
|---|---|---|
| a `.md` TC file (from `tc-extract`) [`--pipeline <slug>`] | **Batch** — one spec per TC (or per group of TCs sharing an entry), no interview | [batch-mode.md](references/batch-mode.md) → [runtime-loop.md](references/runtime-loop.md) |
| none, or a free-text feature description | **Interview** — one spec through questions | [interview.md](references/interview.md) → [runtime-loop.md](references/runtime-loop.md) |

Pick the mode, then read only its references. Batch mode never uses the interview text.

```
/dev-pipeline:e2e-test <worksDir>/<slug>/tc.md                    # batch
/dev-pipeline:e2e-test <worksDir>/<slug>/tc.md --pipeline <slug>  # batch, called by a pipeline router
/dev-pipeline:e2e-test catalog search results                     # interview, screen pre-supplied
/dev-pipeline:e2e-test                                            # interview from scratch
```

`--pipeline <slug>` follows the node call convention in `${CLAUDE_PLUGIN_ROOT}/skills/auto-e2e-pipeline/references/shared-contract.md`: no scope or directory questions (the scope was settled at G2), output under `<e2e.specsDir>/<slug>/`, no closing question, and a gate summary at the end (batch-mode.md B-Step 7). The router's G3 (auto-e2e) / G4 (auto-dev) reads `<worksDir>/<slug>/e2e-report.md`, which the final run (B-Step 6) writes.

## Step 0 — Preconditions (always first)

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config-load.mjs" --check
```

- Config missing or invalid → stop: "Run `/dev-pipeline:init` first." Do not improvise paths.
- `e2e.kitDir` does not exist (or `<kitDir>/VERSION` missing) → stop: "Run `/dev-pipeline:e2e-init` to install the runtime kit." Generated specs import the kit; without it nothing runs.
- `cmp -s <kitDir>/VERSION "${CLAUDE_PLUGIN_ROOT}/kit/VERSION"` fails (the project's kit is another version) → stop: "Run `/dev-pipeline:e2e-init --upgrade`." The assembler writes imports for this plugin's kit.
- `commands.e2eRun` null (config-load warns) → stop: "Install Playwright and set `commands.e2eRun`." Nothing can run the specs.
- Keep the resolved config in hand for the rest of the skill. Every path, command, and feature switch below comes from it (`worksDir`, `locale`, `e2e.specsDir`, `e2e.fixturesDir`, `e2e.specFilePrefix`, `e2e.kitDir`, `e2e.bootFixtures`, `e2e.interaction`, `ui.stateBridge`, `e2e.softTrack`, `e2e.screenCatalog`, `commands.e2eRun`).
- Never run Playwright with `sudo`. A root-owned build, cache or report directory breaks every later run with `EACCES`; the fix is the user restoring ownership once, not a privileged re-run.

Feature switches that shape the questions and the generated code:

| Config | Effect |
|---|---|
| `ui.stateBridge` = null | the **State** checkpoint type is not offered; a State row in a TC stops the assembler |
| `ui.stateBridge.focusExpr` | the value Focus checkpoints read; unset → the focused element's opening tag |
| `e2e.interaction` = `keyboard` | navigation steps compile to `adapter.press` / `adapter.findAndEnter`; the config check already guarantees the adapter exports `findAndEnter` |
| `e2e.bootFixtures` | URL globs the app needs to boot. A spec whose fixtures map lists one of them runs isolated (unmatched data requests stubbed, `testMode: 'fixture'`); otherwise it runs against the real API (`testMode: 'real-api'`). The assembler decides; callers never pass `isolate` |
| `e2e.softTrack` set | checkpoints whose target, path or TC notes match a `softTrack.patterns` entry get `soft: true` → `cp(…, { soft: true })`: a failure is recorded on the checkpoint and logged, and the test does not fail. The report does not raise it in the conclusion; the HTML step list marks it "Recheck on device" |
| `e2e.screenCatalog` set | interview Step 1 offers catalog entries before free text |

## Agents used

All calls go through the `Agent` tool with `subagent_type: dev-pipeline:<name>` and the inputs listed in `${CLAUDE_PLUGIN_ROOT}/references/agents-io.md`. Always pass the repo root and the resolved config (or the fields the agent needs) in the prompt.

| Agent | When |
|---|---|
| `dev-pipeline:screen-context` | interview Step 1 — screen name → page file, URL, render-selector candidates |
| `dev-pipeline:fixture-advisor` | entry mode "direct URL + fixtures" — recommends existing fixtures, reports gaps |
| `dev-pipeline:navigation-advisor` | entry mode "live data + goal-directed navigation" — returns a validated navigation plan |
| `dev-pipeline:verification-advisor` | interview Step 4 — checkpoint candidates from real code |
| `dev-pipeline:spec-writer` | assembles, lints, formats, and saves one spec (one call per spec; batch calls run in parallel) |
| `dev-pipeline:spec-reviewer` | initial quality gate: `spec-lint` + state probe + residual rules (batch: one call for all specs) |
| `dev-pipeline:spec-runtime-validator` | runs one spec, returns PASS / SKIP / FAIL / ENV with the failure kind |

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
   - non-ASCII text written literally, never as `\uXXXX` escapes

## Generation and verification chain (both modes)

```
input data ──▶ spec-writer ──▶ spec-reviewer ──▶ runtime loop (≤5) ──▶ completion
                  ▲               │ Critical/Error            │
                  └───────────────┘ (regenerate, max 2)       └── see runtime-loop.md
```

1. **spec-writer** receives the assembler input (fields per `agents-io.md`) and returns the saved path plus its own `spec-lint` result.
2. **spec-reviewer** runs `spec-lint`, the state probe (when the spec reads app state and the app is reachable), and the residual rules. `pass: false` → send the violations back to spec-writer with `previousContext`; after two failed regenerations, stop and report the violations.
3. **Runtime loop** — [references/runtime-loop.md](references/runtime-loop.md). Loop runs set `E2E_ARCHIVE=0`, so they never land in the report archive.
4. **Completion** — batch mode: summary, final run and report (batch-mode.md B-Step 5–7). Interview mode: Step 7 completion interview (interview.md).

## What a generated spec looks like

The assembler (`${CLAUDE_PLUGIN_ROOT}/scripts/spec-template.mjs`) stamps the whole file: kit imports on one line from `<e2e.kitDir>/index.js` (`test`, `expect`, `mockAll`, `captureFailureDiagnostics`, `captureNavigationCensus` always; `runtimeErrors` with a Runtime checkpoint; `readWatch`, `watchSelectors` with an Observe checkpoint), plus the adapter, `TC_NAME` / `START_URL` / whitelists / `SUCCESS_CRITERIA`, `test.use({ e2e: { … } })`, `test.setTimeout`, a `beforeEach` with `mockAll(page, fixtures, { isolate })` → `page.goto` → `adapter.waitForAppReady`, and one `await cp('cp-NN', …)` per checkpoint. The kit fixture owns the collector, the rule-based verdict, `verdict.json`, the screenshot, and failing the test on a FAIL verdict — specs have no `afterEach`. spec-writer fills only the interaction slot (`slotBody`).

## Output locations

- Specs: `<e2e.specsDir>/<slug>/<e2e.specFilePrefix>tc<NN>-<kebab>.spec.js` (batch; a bundle is `tc<NN>-<NN>-<kebab>`) or `<e2e.specsDir>/<slug>/<e2e.specFilePrefix><kebab>.spec.js` (interview)
- Result report (batch): the final run's archive `<archiveDir>/<YYMMDD>/<tag>-<NN>/e2e-report.html` (`tag` = the spec file name when one spec file ran, the feature directory name when several from one directory ran, else `run`) (open with `node <e2e.kitDir>/report/open.mjs`) and `<worksDir>/<slug>/e2e-report.md`
- Loop record (batch): `<worksDir>/<slug>/e2e-loops.json` (gitignored)
- Nothing else is written. Fixtures are never created or deleted by this skill.

## Related

- `${CLAUDE_PLUGIN_ROOT}/references/adapter-contract.md` — what the kit and adapter provide to specs
- `${CLAUDE_PLUGIN_ROOT}/references/navigation-plan.md` — plan schema compiled into spec bodies
- `${CLAUDE_PLUGIN_ROOT}/skills/tc-extract/references/tc-format.md` — TC file standard parsed in batch mode
- `${CLAUDE_PLUGIN_ROOT}/scripts/spec-template.mjs`, `spec-lint.mjs`, `state-probe.mjs`, `nav-plan-schema.mjs`
