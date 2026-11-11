# dev-pipeline

Take a feature from scattered requirements to verified code, one reviewed stage at a time:

```
/dev-pipeline:auto-dev-pipeline   PRD ─G1→ TC ─G2→ PLAN ─G3a→ IMPL ─G3→ E2E ─G4    (code does not exist yet)
/dev-pipeline:auto-e2e-pipeline   PRD ─G1→ TC ─G2→ E2E ─G3                          (code already exists)
                                  G = scripts check the artifact, then a human approves before the next node
```

Every artifact is a file in your repo (`prd.md`, `tc.md`, `<slug>-plan.md`, `*.spec.js`, `e2e-report.md`), so you can stop after any gate and resume in a new session. A PRD written outside the pipeline can be imported: pass its path, it is checked for format and enters at G1.

## Why

- **Grounded, not guessed** — test cases quote selectors and state paths read from your source; new-feature mode borrows conventions from the nearest sibling file instead of inventing them.
- **Evidence, not claims** — TDD runs through a red-gate script that records RED before GREEN in a ledger; a task without a recorded failing test cannot be marked done.
- **Model-independent quality gates** — each gate runs deterministic checks first (`coverage-gate` for PRD / TC / plan, `red-gate --all` and `surface-gate` after implementation) and asks a human only what a script cannot decide. Spec skeletons come from a deterministic assembler, rules are checked by a linter, state paths are probed against the running app, and generated specs are executed and repaired for up to five iterations.
- **Rule-based verdicts and one result report** — E2E verdicts are rule-based (no LLM, no API key). Each batch ends with a result report (`e2e-report.html` + `e2e-report.md`) showing a review recommendation, AC coverage and per-checkpoint frames. A mock that answered no request fails its spec file as `mock-unused`, so a missed glob cannot pass.
- **Framework-agnostic** — nothing in the plugin knows your framework. Project facts (paths, commands, an optional state bridge, interaction mode) live in one config file created by `/dev-pipeline:init`.

## Install

```
/plugin marketplace add gyofeel/claude-dev-pipeline
/plugin install dev-pipeline@claude-dev-pipeline
```

Requires the `superpowers` plugin for the TDD stage (`/plugin install superpowers@claude-plugins-official`) and Playwright in the target project for the E2E stage.

## Getting started

1. Install the plugin (above).
2. Run `/dev-pipeline:init`. It asks your language first, then walks you through the rest one step at a time: config, the E2E kit, and your first feature.
3. The one command to remember, first time or stuck / 처음이든 막혔든: `/dev-pipeline:init`. With a config in place it shows your settings and asks what to do next, including resuming work in progress.

Each stage can also run alone: `/dev-pipeline:prd-extract`, `/dev-pipeline:tc-extract <prd.md>`, `/dev-pipeline:tdd-implement <tc.md>`, `/dev-pipeline:e2e-test <tc.md | description>`.

## What's inside

```
skills/            auto-e2e-pipeline · auto-dev-pipeline · prd-extract · tc-extract · tdd-implement · e2e-test · init · e2e-init
                   style-extract
agents/            ui-selector-extractor · spec-scanner · fixture-advisor · screen-context · navigation-advisor
                   verification-advisor · spec-writer · spec-reviewer · spec-runtime-validator
scripts/           config-load · coverage-gate · red-gate · surface-gate · field-consumers · flag-effects
                   spec-template (assembler) · spec-lint · nav-plan-schema · state-probe · commit-msg-check · e2e-init
                   lib/source-scan · style/ (resolve-layer · collect · plan-context)
kit/               runtime copied into your project by e2e-init: fixture + cp() checkpoints, api mocker with hit counts,
                   runtime collector, rule-based judge, archive reporter + result report, diagnostics, default adapter
references/        config schema · adapter contract · navigation plan schema · agent I/O contracts
examples/          a full config and a keyboard-navigation adapter from the plugin's origin project (a remote-control TV app)
tests/             node --test suites for kit and scripts, and an example app run end to end with Playwright
```

## Configuration in one minute

`.agents/pipeline.config.json` — minimal:

```json
{ "$schema": "dev-pipeline/1", "commands": { "unitTest": "npx vitest run" } }
```

Languages: `language` (`"en"` default, or `"ko"`) is what people read: conversation, questions, guidance and the report UI; `locale` (follows `language` when unset) sets PRD / TC / plan headings and the labels the checks match. Source scanning (`red-gate`, `field-consumers`, `flag-effects`) reads `source.roots`, `source.extensions` and `source.aliases` (default: tsconfig/jsconfig `paths`).

Optional switches (all default off): `ui.stateBridge` enables State checkpoints and the runtime probe; `e2e.interaction: "keyboard"` routes navigation through your adapter's `findAndEnter`; `e2e.softTrack` turns assertions that depend on an unavailable runtime into recorded-but-non-failing checks; `approvalGates[]` adds project-specific human approvals to the implementation gate; `e2e.bootFixtures` lists the URL globs your app needs to boot so specs that mock them run isolated from the real API; `e2e.judge.backendErrorPatterns` names console errors that report a backend response (excluded under fixtures, failures against the real API). Full schema: `references/config-schema.md`.

## Developer style (optional)

`/dev-pipeline:style-extract` reads your commits from before you started using AI tools and writes `.agents/styles/<name>.md`: how you tend to write each development layer (UI, state, data access, …), with real diff excerpts and reasons. The first run also drafts the project's layer catalog (`.agents/layers/`), which the whole team shares. `tdd-implement` then points every plan task at your style file and the task's layers as context, never as rules: gates, the pipeline contract and project rules still win, and existing files follow the surrounding code first. No style file, no change. Settings: the `style` section of the config.

## Adapter

Generated specs call your app only through `e2e.adapter.js` (`waitForAppReady`, `press`, `locator`, `findAndEnter`, `snapshotState`). Pointer apps need no changes — the kit default clicks. Keyboard-driven apps implement `findAndEnter`; see `examples/adapters/`. Contract: `references/adapter-contract.md`.

## Upgrading

See [CHANGELOG.md](CHANGELOG.md). 0.4.0 changes the pipeline structure, artifact headings and the E2E kit; run `/dev-pipeline:e2e-init --upgrade` and follow the migration list there.

## Developing the plugin

```bash
npm install --prefix tests/e2e-example     # Playwright for the example-app suite (once)
(cd tests/e2e-example && npx playwright install chromium)
node --test 'tests/**/*.test.mjs'
node scripts/selfcheck.mjs && node kit/selfcheck.mjs
```

The example-app suite fails with an install hint, rather than skipping, when its Playwright is missing.

## License

MIT
