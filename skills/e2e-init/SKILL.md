---
name: e2e-init
description: Use when a project needs the E2E runtime kit installed or upgraded before generating Playwright specs — first-time E2E setup after `/dev-pipeline:init`, when `e2e-test` reports a missing kit or adapter, or when the plugin's kit version is newer than the project's copy (`--upgrade`).
---

# e2e-init — install the runtime kit and adapter

Generated specs import runtime code (mocking, collection, AI verdict, reporting, diagnostics). That code must live in the project so CI runs without the plugin. This skill copies it from the plugin and scaffolds the project adapter. Contract: [adapter-contract.md](../../references/adapter-contract.md).

Arguments: `--upgrade` (replace an existing kit after showing a diff).

## Step 1 — Load config

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config-load.mjs" --check && node "${CLAUDE_PLUGIN_ROOT}/scripts/config-load.mjs"
```

Missing or invalid → stop: "Run `/dev-pipeline:init` first." Read from the resolved JSON: `e2e.kitDir`, `e2e.adapterModule`, `e2e.specsDir`, `e2e.fixturesDir`, `e2e.resultsJson`, `e2e.baseUrl`, `e2e.interaction`, `commands.dev`, `commands.e2eRun`.

`commands.e2eRun` null → warn that Playwright was not detected; continue (the kit can be installed ahead of the dependency).

## Step 2 — Plan the changes and check collisions

```bash
ROOT=$(git rev-parse --show-toplevel)
PLUGIN_KIT="${CLAUDE_PLUGIN_ROOT}/kit"
cat "$PLUGIN_KIT/VERSION"
[ -d "$ROOT/<kitDir>" ] && cat "$ROOT/<kitDir>/VERSION" 2>/dev/null || echo NO_KIT
ls "$ROOT/<adapterModule>" 2>/dev/null || echo NO_ADAPTER
ls "$ROOT"/playwright.config.* 2>/dev/null || echo NO_PW_CONFIG
```

Build the list:

| Target | Source | Action |
|---|---|---|
| `<kitDir>/` | `$PLUGIN_KIT/` (`cp -R`, excluding `adapter.template.js` and `playwright.config.template.js`) | create, or replace in `--upgrade` |
| `<adapterModule>` | `$PLUGIN_KIT/utils/adapter.template.js` | create only if absent — never overwritten |
| `playwright.config.js` | `$PLUGIN_KIT/playwright.config.template.js` | create only if no `playwright.config.*` exists |
| `<fixturesDir>/`, `<specsDir>/`, `dirname(<resultsJson>)/` | — | `mkdir -p` |

Print the table with the action per row. Then:

- Kit exists, no `--upgrade` → say the versions and stop unless the user passed `--upgrade`. Do not touch the kit.
- Kit exists with `--upgrade` → `diff -r "$ROOT/<kitDir>" "$PLUGIN_KIT" --exclude=adapter.template.js --exclude=playwright.config.template.js` and show a summary (files added / changed / removed). Then `AskUserQuestion`:

**Question**: "Replace the project's kit with the plugin version?"
- header: `Kit upgrade`
- description: `<old version> → <new version>`, changed file list
- options:
  - `Replace the kit` — the adapter and Playwright config are left untouched
  - `Cancel`

Anything else in the table that already exists is skipped and reported; nothing outside the table is written.

## Step 3 — Apply

```bash
mkdir -p "$ROOT/<kitDir>" "$ROOT/<fixturesDir>" "$ROOT/<specsDir>" "$(dirname "$ROOT/<resultsJson>")"
cp -R "$PLUGIN_KIT"/. "$ROOT/<kitDir>/"
rm -f "$ROOT/<kitDir>/utils/adapter.template.js" "$ROOT/<kitDir>/playwright.config.template.js"
[ -f "$ROOT/<adapterModule>" ] || cp "$PLUGIN_KIT/utils/adapter.template.js" "$ROOT/<adapterModule>"
```

Playwright config (only when none exists): copy the template and substitute its placeholders with config values — `baseURL` ← `e2e.baseUrl`, `testDir` ← `e2e.specsDir`, json reporter `outputFile` ← `e2e.resultsJson`, `webServer.command` ← `commands.dev` (drop the `webServer` block when `commands.dev` is null). Grep the result for leftover `__` placeholders before moving on.

Fix the adapter's kit import path if `<adapterModule>` and `<kitDir>` are not siblings: compute the relative path from the adapter's directory to `<kitDir>/index.js` and rewrite the import line.

## Step 4 — Dependencies (report only, never install)

```bash
node -e "const p=require('$ROOT/package.json');console.log(p.devDependencies?.['@playwright/test']||p.dependencies?.['@playwright/test']||'MISSING')"
```

`MISSING` → print the install command for the detected package manager (`pnpm add -D @playwright/test` / `npm i -D @playwright/test` / …) and `npx playwright install chromium`. Present → print only the browser hint: "If Playwright was just installed or upgraded, run `npx playwright install chromium` once."

## Step 5 — Verify the kit loads

```bash
cd "$ROOT" && node -e "import('./<kitDir>/index.js').then(m=>console.log('kit ok', m.KIT_VERSION)).catch(e=>{console.error(e.message);process.exit(1)})"
```

Fails → show the error and stop; do not claim success.

## Step 6 — Report

```
E2E kit installed
  kit       <kitDir>/  (v<version>)
  adapter   <adapterModule>  (<created | kept>)
  config    playwright.config.js  (<created | kept existing>)
  dirs      <fixturesDir>/  <specsDir>/

Next: /dev-pipeline:e2e-test  or  /dev-pipeline:auto-e2e-pipeline
```

When `e2e.interaction` is `keyboard`, append:

```
Keyboard interaction is configured. The adapter must implement findAndEnter(page, target)
before any spec with a navigation plan can run — see ${CLAUDE_PLUGIN_ROOT}/examples/adapters/.
```

## Rules

- Never overwrite `<adapterModule>` or an existing Playwright config; the user's edits live there.
- Never run package installs or browser downloads; print the commands.
- Before every `AskUserQuestion`, re-read labels and descriptions: no `[...]` placeholders, no truncated sentences, plain-word labels.
