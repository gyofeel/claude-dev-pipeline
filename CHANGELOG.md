# Changelog

## 0.4.0

Pipeline rebuilt as nodes and gates, rule-based E2E verdicts with a result report, and artifacts in English or Korean. **Breaking**: no compatibility layer; follow "Migrating from 0.3" below. Kit version 0.2.0.

### Breaking changes

- **Nodes and gates.** `PRD ─G1→ TC ─G2→ PLAN ─G3a→ IMPL ─G3→ E2E ─G4`. Every gate runs deterministic checks first (`coverage-gate --lint` for PRD / TC / plan, `red-gate --all`, `surface-gate`) and reopens the node instead of asking a human while errors remain. Each node ends with the command to resume in a new session. In `state.json` the implementation is two stages, `tdd-plan` and `tdd-impl`.
- **Artifact headings follow `locale`.** PRD, TC and plan headings, fixed values and the labels the checks look for come from `kit/artifact-labels.mjs` for the configured `locale` (`en` default, or `ko`). The checks accept only the configured locale; 0.3 artifacts with other headings fail the lint.
- **AI verdict removed.** `services/ai-analyzer.js`, `prompts/` and `selfcheck-analyzer.mjs` are gone, and so is `E2E_SKIP_AI`. Verdicts come from `services/judge.js` (rule-based, `PASS` / `FAIL` only; no `WARNING`), and every run is archived with `e2e-report.html` (plus `e2e-report.md` for a full feature run). Open the latest with `node <kitDir>/report/open.mjs`; `E2E_ARCHIVE=0` skips archiving.
- **Spec format.** Specs import `test` / `expect` from the kit, declare `test.use({ e2e })` and record checkpoints with `cp()`; the fixture judges each test. The assembler ignores the old inputs `acceptableStatuses`, `acceptanceCriteria` and `liveData`.
- **Retired checkpoint condition forms** stop the assembler with `unknown checkpoint condition`: `count(N)`, `length(N)`, `hasClass('…')`, `noConsoleErrors`, and Focus `matches('<css>')` / `hasText('…')`. Write `toHaveCount(N)`, `toHaveLength(N)`, `toHaveClass(/…/)`, `isEmpty`, `includes('…')`.
- **Unused mocks fail.** A mock glob that answered no request in any test of its spec file (per Playwright project) fails every test in that file with the failure kind `mock-unused`, and the archive reporter then makes `playwright test` exit non-zero even though Playwright passed the tests — also with `E2E_ARCHIVE=0`. Runs filtered by `--grep` or `file:line` skip this check.
- **Service workers blocked.** The Playwright config template sets `serviceWorkers: 'block'` (a worker can answer before `page.route` and bypass mocks) and `trace: 'on'` (report frames), and registers the archive reporter last.
- **red-gate CLI.** The ledger `red-evidence.jsonl` now sits next to the plan (`<worksDir>/<slug>/`), not under `.superpowers/sdd/`. `--project <name>` is optional (no project filter when omitted); `--phase char` records characterization tasks. `--all` runs every project.
- **Config.** `e2e.ai` is removed (`config-load --check` warns while it is present). `commands.unitTest` / `commands.e2eRun` set to null (no runner, no Playwright) now load with a warning instead of an error.
- **Report locale split.** tc.md is always read with the top-level `locale`; the report text follows `language`. A tc.md whose TC blocks have none of the expected field labels, a spec file that failed to load, a passed test without a runtime verdict, a feature directory without tc.md and a TC whose spec exists but maps to no test are all raised in the conclusion instead of reading as "Approvable".
- **Stricter checks.** `e2e-init check-kit-dir` refuses a kit directory that contains any configured path (works, archive, style, catalog, …), that resolves through a symlink onto one, or that exists with files but no `VERSION`. `red-gate --all` that collected zero tests is `NOT_COLLECTED`, never `OK_GREEN`. The assembler refuses a TC with neither checkpoints nor a test body (`<tcName>: no checkpoints`).

### Added

- **Guided setup.** `/dev-pipeline:init` asks your language first, explains each setting by what it changes for you, installs the E2E kit itself, and ends by asking what to do next, so you never type a chain of commands. Run it again any time: it shows your settings and offers the next step (new feature, verify, resume work in progress, install or upgrade the E2E kit, change settings). Every message says where you are and ends with one next step.
- **Two language settings.** `language` is what you read: conversation, questions, guidance and the E2E report. `locale` is the language of PRD, TC and plan headings; it follows `language`, and init asks about it only when your existing documents use the other one.
- Config keys: `language` (conversation, questions, guidance and report UI; default `en`), `locale` (artifact headings and check labels; follows `language` when unset), `e2e.report.loopThreshold` (3), `e2e.judge.backendErrorPatterns` (`[]`), `e2e.bootFixtures` (URL globs the app needs to boot; a spec mocking one runs isolated), `e2e.archiveDir` (null → `<dirname(resultsJson)>/archive`), `source.roots` (`["src"]`), `source.extensions`, `source.aliases` (null → tsconfig/jsconfig `paths`).
- External PRD import: pass a `prd.md` path that has no state file to either pipeline; it is format-checked (fix list only, never auto-edited) and enters at G1.
- Scripts: `field-consumers`, `flag-effects`, `lib/source-scan` (scan targets from `source.*`; zero targets is an error, never a pass), `e2e-init` (kit-directory safety check before replacing the kit; writes `playwright.config.js` from the template), `commit-msg-check` (tdd-implement dry-runs the project's commit-msg hook before the first commit and drops the session trailer if the hook rejects it).
- Checkpoint types `URL` (pathname / search / href), `Popup` (windows opened, first window's address) and `Observe` (short-lived elements sampled over a window).
- Batch grouping: TCs that share one entry assemble into one spec file (`cases[]`, one `describe` per TC, file name `tc<NN>-<NN>-<kebab>.spec.js`).
- `prd-extract` drafts the PRD from all the material at once, lints it with `coverage-gate --prd --lint`, and asks only about gaps and contradictions (`references/interview-prompts.md` is removed).
- `e2e-init gitignore` adds `<worksDir>/**/e2e-loops.json`, the results directory and `test-results/` to `.gitignore`. Default `source.extensions` also covers `.svelte`, `.mjs`, `.cjs`. A fixture that answers with an error status on purpose no longer counts as an API error in `real-api` mode.
- Kit: `fixture.js`, `report/`, `artifact-labels.mjs`, `utils/{checkpoint,runtime-filter,api-usage,archive-reporter}.mjs`, `utils/watch-helper.js` (Observe checkpoints for short-lived elements), per-glob mock hit counts.
- Example app with an end-to-end Playwright regression under `tests/e2e-example/`.
- `state.json` records `baseCommit` when a run starts, and `surface-gate` finds the base itself (`--state`, else merge-base with origin/HEAD, main, master or develop) and reports it, so G3 works whatever the default branch is called. The E2E node offers to create fixtures a TC names but nobody wrote, flags a unit runner that also collects the E2E specs, and lists uncommitted E2E files before finishing the branch.
- The assembler imports the diagnostics helpers only when the body calls them (unused imports failed project lint) and stops on an unquoted `hasText` argument. Every skill states the plugin root, since reference files and the Bash shell do not expand `${CLAUDE_PLUGIN_ROOT}`. `e2e-init gitignore` lists already-tracked report files (`stillTracked`). `report/open.mjs` no longer hangs when piped. Fixtures are documented as JSON only.

Unchanged: developer style injection from 0.3.0 (`style-extract`, the `style` config section); `tdd-implement` now reads the style file at PLAN step 4.

### Migrating from 0.3

1. Config (`.agents/pipeline.config.json`):
   - delete `e2e.ai`;
   - add `language` (and `locale` if artifact headings should use another language);
   - set `source.roots` to your source directories (the default `["src"]` finds nothing in, say, a Nuxt `app/` tree, and the scan then errors);
   - set `source.aliases` when tsconfig/jsconfig `paths` do not describe your aliases (e.g. Nuxt: `{ "~/": "app/", "@/": "" }`);
   - list your boot API globs in `e2e.bootFixtures`;
   - remove `--project` from `unitTest.runnerArgs` (red-gate takes it per test; `--all` must reach every project).
   Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/config-load.mjs" --check`.
2. Kit: `/dev-pipeline:e2e-init --upgrade`. It refuses a `e2e.kitDir` that holds anything but the kit, then replaces the kit (old-only files are deleted) and never edits your Playwright config; it prints the `serviceWorkers: 'block'`, `trace: 'on'` and archive-reporter snippets your config lacks. An app that cannot boot with its service worker blocked needs the worker (or its mock layer) off in test mode.
3. Specs: there is no compatibility layer for kit 0.1 specs (`afterEach` + `analyze`). Regenerate them from their tc.md with `/dev-pipeline:e2e-test` (the assembler); rewrite TC rows that use retired condition forms first.
4. Artifacts: rerun `coverage-gate --lint` on PRD / TC / plan files you keep; fix headings it reports. TC files also meet new content rules: an `E2E basis` for every `e2e` TC, `## Implementation owners` for TCs without a unit test (new mode), a `Sibling convention` column in `## Implementation surface` (and every non-new row's file must exist), `## Entry branches` when sibling branches split on an entry flag, `## Flag side effects` for writes gated on a flag the design keeps on longer, and `## Input field interpretation` for input fields other code also reads.
5. Runs in progress: finish them on 0.3, or restart on 0.4 from the artifact path (`/dev-pipeline:auto-dev-pipeline <tc.md>`); a 0.3 `state.json` has no `tdd-plan` / `tdd-impl` stages to resume from.
6. Old ledgers under `.superpowers/sdd/<plan>/red-evidence.jsonl` are no longer read; plans written for 0.3 need new red-gate lines (new `--plan` location).

## 0.3.0

- Developer style injection: `style-extract` builds a per-developer style file and the project's layer catalog; `tdd-implement` passes them to implementers as context.
