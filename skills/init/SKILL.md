---
name: init
description: Use when a project has no `.agents/pipeline.config.json` yet, when another dev-pipeline skill stops with "config missing", or when the user wants to change project facts the pipeline relies on (test command, spec directory, state bridge, interaction mode, AI provider).
---

# init — create or update the pipeline config

Every other skill in this plugin reads `.agents/pipeline.config.json` and refuses to guess paths or commands. This skill writes that file: it auto-detects what a repository reveals, asks only about things a repository cannot reveal, then validates.

Schema and every key: [config-schema.md](../../references/config-schema.md). Read it before writing the file.

## Step 1 — Locate repo and existing config

```bash
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
ls "$ROOT/.agents/pipeline.config.json" 2>/dev/null && echo CONFIG_EXISTS || echo CONFIG_MISSING
```

If it exists → `AskUserQuestion`:

**Question**: "A pipeline config already exists. What should happen to it?"
- header: `Existing config`
- options:
  - `Update — keep values, re-detect the rest` — merge: user-set keys win, detection fills gaps
  - `Start over — replace the file` — the old file is copied to `pipeline.config.json.bak` first
  - `Cancel`

## Step 2 — Auto-detect (no questions)

Read `package.json`, lockfiles, and the directory tree. Collect these; note the evidence for each so Step 3 can show it.

| Key | Detection |
|---|---|
| package manager | `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `bun.lockb` → bun, else npm |
| `unitTest.runner` | `vitest` in deps → vitest; `jest` → jest; neither → ask in Step 3 |
| `commands.unitTest` | first `scripts.*` whose value contains the runner **and** (`run` or `--run` or `--watch=false` or `ci`); else `npx vitest run` / `npx jest`. If every runner script is watch-mode, keep the fallback and flag it |
| `commands.unitTestList` | vitest → `npx vitest list --filesOnly` when vitest ≥ 3; else null |
| `commands.format` / `commands.lint` | `prettier` in deps → `npx prettier --write`; `eslint` in deps → `npx eslint --fix` |
| `commands.dev` | `scripts.dev` if present |
| `commands.e2eRun` | `@playwright/test` in deps → `npx playwright test`; else null with a note |
| `ui.framework` | vue/nuxt → vue; react/next/remix → react; svelte/@sveltejs → svelte; @angular/core → angular; else other |
| `ui.pagesDir` | first existing of `app/pages`, `src/pages`, `pages`, `src/app`, `src/routes`, `src/views`, `app/routes` |
| `ui.componentsDir` | first existing of `app/components`, `src/components`, `components` |
| `ui.stateStoreDir` | first existing of `app/store`, `app/stores`, `src/store`, `src/stores`, `store`, `stores` |
| `ui.testIdAttribute` | grep the pages/components dirs for `data-testid`, `data-test`, `data-cy`; take the most frequent, default `data-testid` |
| `e2e.specsDir` | existing `playwright.config.*` → its `testDir`; else `e2e/specs` |
| `e2e.resultsJson` | from the json reporter in `playwright.config.*` if present; else `e2e/reports/results.json` |
| `e2e.baseUrl` | `use.baseURL` in `playwright.config.*`; else `http://localhost:3000` |
| `unitTest.testFileGlobs` | from the runner config `include`/`testMatch` if readable; else the schema default |

Do not read the runner config files by executing them; grep for the keys.

## Step 3 — Show detection, ask the rest

Print the detected values as one grouped block (commands / unit tests / ui / e2e), each line with its evidence in parentheses. Then ask, in at most two `AskUserQuestion` rounds, only the items below. Skip a question when the existing config (update mode) already answers it.

**Round 1**

**Question**: "How does a user operate this app in tests?"
- header: `Interaction`
- options:
  - `Pointer — click, type, tap (Recommended)` — generated specs use Playwright locators and `click()`
  - `Keyboard only — arrow keys, Enter` — the project adapter must implement `findAndEnter`; see the examples directory in the plugin

**Question**: "Can tests read the app's state from the page?"
- header: `State bridge`
- options:
  - `No — DOM and runtime checks only (Recommended)` — the State checkpoint type stays off
  - `Yes — I will enter the expression` — a JS expression like `window.__APP_STATE__` evaluable in the page; the next prompt asks for it

**Question**: "Which AI provider should judge E2E runtime results?"
- header: `AI verdict`
- options:
  - `None (Recommended)` — verdict comes from assertions only
  - `OpenAI` — uses `OPENAI_API_KEY`
  - `Anthropic` — uses `ANTHROPIC_API_KEY`

**Round 2**

**Question**: "Where do the project coding rules live that implementers must follow verbatim?"
- header: `Constraints`
- options:
  - `Derive from CLAUDE.md or AGENTS.md (Recommended)` — a short list is proposed later and confirmed before use
  - `A file I will name` — path entered next
  - `None`

**Question**: "Are there states the test environment can never reach, so assertions on them must be soft?"
- header: `Soft-track`
- options:
  - `No (Recommended)`
  - `Yes — I will describe them` — next prompt collects a guard expression and pattern words

**Question**: "Are there code changes that always need explicit approval during implementation review?"
- header: `Approval gates`
- options:
  - `No (Recommended)`
  - `Yes — I will list them` — next prompt collects name + shell check per gate

For every `Yes — …` answer, ask for the value as plain text in the next turn.

If `unitTest.runner` was not detected, add one question: `vitest` / `jest` / `no unit tests` (then `commands.unitTest` becomes null and tdd-implement is unusable — say so).

## Step 4 — Write, validate, finish

1. Build the object: `"$schema": "dev-pipeline/1"` first, then only keys that differ from schema defaults plus every key the user answered. Keep the file short.
2. `mkdir -p "$ROOT/.agents"` and write `pipeline.config.json` (2-space indent).
3. Validate:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/config-load.mjs" --check
   ```
   On errors, fix and re-run. Do not print a success message while `--check` fails.
4. `.gitignore` — append these lines if absent (idempotent grep first):
   ```
   <worksDir>/**/state.json
   .superpowers/
   ```
5. Report:

```
Config written: .agents/pipeline.config.json
  unit: <runner> · <commands.unitTest>
  ui:   <framework> · pages <dir> · state bridge <yes/no>
  e2e:  <interaction> · specs <dir> · AI <provider>

Next
  /dev-pipeline:e2e-init            — install the E2E runtime kit (needed before e2e-test)
  /dev-pipeline:auto-e2e-pipeline   — verify an existing feature
  /dev-pipeline:auto-dev-pipeline   — build a new feature
```

Omit the `e2e-init` line when `commands.e2eRun` is null and say Playwright was not found instead.

## Rules

- Never run install commands. Print them.
- Never overwrite without the Step 1 answer; in update mode, keys the user set by hand win over detection.
- Before every `AskUserQuestion`, re-read labels and descriptions: no `[...]` placeholders, no truncated sentences, labels in plain words, `(Recommended)` on at most one option per question.
