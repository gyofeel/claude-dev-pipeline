# dev-pipeline

Take a feature from scattered requirements to verified code, one reviewed stage at a time:

```
/dev-pipeline:auto-e2e-pipeline   PRD ─G─▶ test cases ─G─▶ Playwright specs          (code already exists)
/dev-pipeline:auto-dev-pipeline   PRD ─G─▶ test cases ─G─▶ TDD implementation ─G─▶ Playwright specs   (code does not exist yet)
                                  G = a human reviews the artifact and approves before the next stage
```

Every artifact is a file in your repo (`prd.md`, `tc.md`, `<slug>-plan.md`, `*.spec.js`), so you can stop after any gate and resume in a new session.

## Why

- **Grounded, not guessed** — test cases quote selectors and state paths read from your source; new-feature mode borrows conventions from the nearest sibling file instead of inventing them.
- **Evidence, not claims** — TDD runs through a red-gate script that records RED before GREEN in a ledger; a task without a recorded failing test cannot be marked done.
- **Model-independent quality gates** — spec skeletons come from a deterministic assembler, rules are checked by a linter, state paths are probed against the running app, and generated specs are executed and repaired for up to five iterations.
- **Framework-agnostic** — nothing in the plugin knows your framework. Project facts (paths, commands, an optional state bridge, interaction mode) live in one config file created by `/dev-pipeline:init`.

## Install

```
/plugin marketplace add gyofeel/claude-dev-pipeline
/plugin install dev-pipeline@claude-dev-pipeline
```

Requires the `superpowers` plugin for the TDD stage (`/plugin install superpowers@claude-plugins-official`) and Playwright in the target project for the E2E stage.

## Getting started

```
/dev-pipeline:init          # detects your toolchain, asks a few questions, writes .agents/pipeline.config.json
/dev-pipeline:e2e-init      # (E2E only) copies the runtime kit and scaffolds e2e/e2e.adapter.js + playwright.config.js
/dev-pipeline:auto-e2e-pipeline PROJ-1234        # or auto-dev-pipeline; the issue key is optional and read from the branch name
```

Each stage can also run alone: `/dev-pipeline:prd-extract`, `/dev-pipeline:tc-extract <prd.md>`, `/dev-pipeline:tdd-implement <tc.md>`, `/dev-pipeline:e2e-test <tc.md | description>`.

## What's inside

```
skills/            auto-e2e-pipeline · auto-dev-pipeline · prd-extract · tc-extract · tdd-implement · e2e-test · init · e2e-init
agents/            ui-selector-extractor · spec-scanner · fixture-advisor · screen-context · navigation-advisor
                   verification-advisor · spec-writer · spec-reviewer · spec-runtime-validator
scripts/           config-load · spec-template (assembler) · spec-lint · nav-plan-schema · state-probe · red-gate
kit/               runtime copied into your project by e2e-init: api mocker, runtime collector, AI analyzer (fetch-only,
                   OpenAI / Anthropic / none), report dashboard, diagnostics, default adapter
references/        config schema · adapter contract · navigation plan schema · agent I/O contracts
examples/          a full config and a keyboard-navigation adapter from the plugin's origin project (a remote-control TV app)
```

## Configuration in one minute

`.agents/pipeline.config.json` — minimal:

```json
{ "$schema": "dev-pipeline/1", "commands": { "unitTest": "npx vitest run" } }
```

Optional switches (all default off): `ui.stateBridge` enables State checkpoints and the runtime probe; `e2e.interaction: "keyboard"` routes navigation through your adapter's `findAndEnter`; `e2e.softTrack` turns assertions that depend on an unavailable runtime into recorded-but-non-failing checks; `approvalGates[]` adds project-specific human approvals to the implementation gate. Full schema: `references/config-schema.md`.

## Adapter

Generated specs call your app only through `e2e.adapter.js` (`waitForAppReady`, `press`, `locator`, `findAndEnter`, `snapshotState`). Pointer apps need no changes — the kit default clicks. Keyboard-driven apps implement `findAndEnter`; see `examples/adapters/`. Contract: `references/adapter-contract.md`.

## License

MIT
