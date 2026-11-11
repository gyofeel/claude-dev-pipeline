---
name: e2e-init
description: Use when a project needs the E2E runtime kit installed or upgraded before generating Playwright specs — first-time E2E setup after `/dev-pipeline:init`, when `e2e-test` reports a missing kit or adapter, or when the plugin's kit version is newer than the project's copy (`--upgrade`).
---

# e2e-init — install the runtime kit and adapter

Generated specs import runtime code (mocking, collection, rule-based verdict, result report, diagnostics). That code must live in the project so CI runs without the plugin. This skill copies it from the plugin and scaffolds the project adapter. Contract: [adapter-contract.md](../../references/adapter-contract.md).

Arguments: `--upgrade` (replace an existing kit after showing a diff).

## Step 1 — Load config

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config-load.mjs" --check && node "${CLAUDE_PLUGIN_ROOT}/scripts/config-load.mjs"
```

Missing or invalid → stop: "Run `/dev-pipeline:init` first." Read from the resolved JSON: `e2e.kitDir`, `e2e.adapterModule`, `e2e.specsDir`, `e2e.fixturesDir`, `e2e.resultsJson`, `e2e.baseUrl`, `e2e.healthUrlPath`, `e2e.interaction`, `commands.dev`, `commands.e2eRun`. Show any `warnings[]` (an `e2e.ai` key left over from 0.3 is one: tell the user to delete it).

`commands.e2eRun` null → warn that Playwright was not detected; continue (the kit can be installed ahead of the dependency).

## Step 2 — Plan the changes and check collisions

```bash
ROOT=$(git rev-parse --show-toplevel)
PLUGIN_KIT="${CLAUDE_PLUGIN_ROOT}/kit"
cat "$PLUGIN_KIT/VERSION"
[ -d "$ROOT/<kitDir>" ] && cat "$ROOT/<kitDir>/VERSION" 2>/dev/null || echo NO_KIT
ls "$ROOT/<adapterModule>" 2>/dev/null || echo NO_ADAPTER
ls "$ROOT"/playwright.config.* 2>/dev/null || echo NO_PW_CONFIG
cd "$ROOT" && node "${CLAUDE_PLUGIN_ROOT}/scripts/e2e-init.mjs" check-kit-dir
```

`check-kit-dir` → `ok: false` (kitDir, symlinks resolved, is the repo root, outside the repo, contains any configured path — `worksDir`, specs, fixtures, results, archive, adapter, style or catalog files, `.agents` — or already exists with files but no `VERSION`) → show `errors[]` and stop: the kit directory is deleted on upgrade, so it must hold nothing but the kit. Ask the user to change `e2e.kitDir`.

Build the list:

| Target | Source | Action |
|---|---|---|
| `<kitDir>/` | `$PLUGIN_KIT/` — the whole directory (`index.js`, `fixture.js`, `config-loader.js`, `artifact-labels.mjs`, `report/`, `services/`, `utils/`, `package.json`, `selfcheck.mjs`, `README.md`, `VERSION`) minus `adapter.template.js` and `playwright.config.template.js` | create, or replace in `--upgrade` |
| `<adapterModule>` | `$PLUGIN_KIT/utils/adapter.template.js` | create only if absent — never overwritten |
| `playwright.config.js` | `$PLUGIN_KIT/playwright.config.template.js` | create only if no `playwright.config.*` exists (Step 3a); an existing one is only checked (Step 3b) |
| `<fixturesDir>/`, `<specsDir>/`, `dirname(<resultsJson>)/` | — | `mkdir -p` |

Print the table with the action per row. Then:

- Kit exists, no `--upgrade` → say the versions and stop unless the user passed `--upgrade`. Do not touch the kit.
- Kit exists with `--upgrade` → `diff -rq "$ROOT/<kitDir>" "$PLUGIN_KIT" --exclude=adapter.template.js --exclude=playwright.config.template.js` and show a summary (files added / changed / removed). `Only in $ROOT/<kitDir>` lines are files the new kit no longer has (from kit 0.1: `services/ai-analyzer.js`, `prompts/`, `selfcheck-analyzer.mjs`); replacing deletes them. Then `AskUserQuestion`:

**Question**: "Replace the project's kit with the plugin version?"
- header: `Kit upgrade`
- description: `<old version> → <new version>`, changed file list
- options:
  - `Replace the kit` — files only in the old kit are deleted; the adapter and Playwright config are left untouched
  - `Cancel`

Anything else in the table that already exists is skipped and reported; nothing outside the table is written.

## Step 3 — Apply

```bash
rm -rf "$ROOT/<kitDir>"   # --upgrade only: after the Replace answer, and only with check-kit-dir ok: true
mkdir -p "$ROOT/<kitDir>" "$ROOT/<fixturesDir>" "$ROOT/<specsDir>" "$(dirname "$ROOT/<resultsJson>")"
cp -R "$PLUGIN_KIT"/. "$ROOT/<kitDir>/"
rm -f "$ROOT/<kitDir>/utils/adapter.template.js" "$ROOT/<kitDir>/playwright.config.template.js"
[ -f "$ROOT/<adapterModule>" ] || cp "$PLUGIN_KIT/utils/adapter.template.js" "$ROOT/<adapterModule>"
```

Keep the run outputs out of git (idempotent; prints the lines it added):

```bash
cd "$ROOT" && node "${CLAUDE_PLUGIN_ROOT}/scripts/e2e-init.mjs" gitignore
```

It adds `<worksDir>/**/e2e-loops.json`, `dirname(<resultsJson>)/` (live reports and the default archive) and `test-results/`. `e2e-report.md` stays tracked.

Fix the adapter's kit import path if `<adapterModule>` and `<kitDir>` are not siblings: compute the relative path from the adapter's directory to `<kitDir>/index.js` and rewrite the import line.

### Step 3a — New Playwright config (only when no `playwright.config.*` exists)

Do not substitute placeholders by hand; the script writes `playwright.config.js` from the template and the config (`commands.dev` as a JSON string, the `webServer` block dropped when it is null) and refuses to overwrite:

```bash
cd "$ROOT" && node "${CLAUDE_PLUGIN_ROOT}/scripts/e2e-init.mjs" write-playwright-config
```

`ok: false` → show `errors[]` and stop.

### Step 3b — Existing Playwright config

Never edit it. Check it and print what is missing:

```bash
cd "$ROOT" && F=$(ls playwright.config.* | head -1)
grep -qE "serviceWorkers: *['\"]block" "$F" || echo MISSING_SW
grep -q "archive-reporter" "$F" || echo MISSING_ARCHIVE
grep -qE "trace: *['\"]on['\"]" "$F" || echo MISSING_TRACE
```

For each `MISSING_*`, print its snippet and the one-line reason:

| Missing | Snippet | Reason |
|---|---|---|
| `MISSING_SW` | `use: { serviceWorkers: 'block' }` | a service worker can answer requests before `page.route` sees them; the mocks then go unused and the spec file fails as `mock-unused` |
| `MISSING_ARCHIVE` | `['./<kitDir>/utils/archive-reporter.mjs']` as the **last** `reporter` entry, after `html` and `json` | it archives each run and writes `e2e-report.html`; it copies what the other reporters wrote, so it must come last |
| `MISSING_TRACE` | `use: { trace: 'on' }` | the report shows one frame per checkpoint, read from the trace |

An app that cannot boot without its service worker fails at boot once workers are blocked; turning the worker (or its mock layer) off in test mode is the project's call.

## Step 4 — Dependencies (report only, never install)

```bash
node -e "const p=require('$ROOT/package.json');console.log(p.devDependencies?.['@playwright/test']||p.dependencies?.['@playwright/test']||'MISSING')"
```

`MISSING` → print the install command for the detected package manager (`pnpm add -D @playwright/test` / `npm i -D @playwright/test` / …) and `npx playwright install chromium`. Present → print only the browser hint: "If Playwright was just installed or upgraded, run `npx playwright install chromium` once."

## Step 5 — Verify the kit loads

```bash
cd "$ROOT" && node -e "import('./<kitDir>/index.js').then(m=>console.log('kit ok', m.KIT_VERSION)).catch(e=>{console.error(e.message);process.exit(1)})"
```

Fails while Step 4 printed `MISSING` → expected: the kit imports `@playwright/test`. Report "kit installed; it loads once Playwright is installed" and continue to Step 6. Fails otherwise → show the error and stop; do not claim success.

## Step 6 — Report

```
E2E kit installed
  kit       <kitDir>/  (v<version>)
  adapter   <adapterModule>  (<created | kept>)
  config    playwright.config.js  (<created | kept — N snippets to add>)
  dirs      <fixturesDir>/  <specsDir>/

Next: /dev-pipeline:e2e-test  or  /dev-pipeline:auto-e2e-pipeline
```

After an upgrade from kit 0.1, add one line: "Read the plugin's CHANGELOG.md (0.4.0) for config keys and regenerated specs."

When `e2e.interaction` is `keyboard`, append:

```
Keyboard interaction is configured. The adapter must implement findAndEnter(page, target)
before any spec with a navigation plan can run — see ${CLAUDE_PLUGIN_ROOT}/examples/adapters/.
```

## Rules

- Never overwrite `<adapterModule>` or an existing Playwright config; the user's edits live there. Print snippets instead.
- Never run package installs or browser downloads; print the commands.
- Before every `AskUserQuestion`, re-read labels and descriptions: no `[...]` placeholders, no truncated sentences, plain-word labels.
