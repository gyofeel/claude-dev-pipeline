---
name: prd-extract
description: Use when a feature's requirements are scattered across tickets, Figma, interface specs, or verbal descriptions and need to be consolidated into one PRD before any code or test work starts. Also the first stage of the auto-dev-pipeline and auto-e2e-pipeline, and the way to rework a PRD that failed its lint or was sent back at the PRD gate. Triggers on "write a PRD", "organize requirements", "extract the spec", "fix this PRD", or starting feature work without a written spec.
---

# PRD extraction

```
collect material (once) → draft → coverage-gate --prd --lint → ask only blanks and contradictions ⟲ → save
```

The artifact is `<worksDir>/<slug>/prd.md`. Its format is [references/prd-format.md](references/prd-format.md) — `tc-extract` and `coverage-gate` parse it, so read it before drafting. The feature name, the target screen and the acceptance criteria must be settled before the save completes.

## Usage

```
/dev-pipeline:prd-extract [feature name | issue key] [--pipeline [<slug>]]
/dev-pipeline:prd-extract <existing PRD .md> [--pipeline <slug>]      # revise mode
```

- `--pipeline` → called by a pipeline router (`../auto-e2e-pipeline/references/shared-contract.md`, Node call convention). Do not ask for a save path, skip the final confirmation and the next-step guidance, and end with the gate summary (Step 5). `--pipeline` alone means a new run: propose the slug. `--pipeline <slug>` with an existing `<worksDir>/<slug>/prd.md` is a G1 re-run: revise mode on that file, with the correction the router passes.
- An existing `.md` path as the argument → **revise mode** (below).

## Step 0 — Config and resume

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config-load.mjs"
```

Missing config → stop: "No `.agents/pipeline.config.json`. Run `/dev-pipeline:init` first." Keep `worksDir`, `language`, `locale`, `issueKeyPattern`, `platformInterface`, `e2e.fixturesDir`, `e2e.specsDir`, `ui.selectorPriority`.

Talk to the user in `language` and shape every message by the contract's User-facing output (`../auto-e2e-pipeline/references/shared-contract.md`).

Headings and fixed values are written with the labels of config `locale` (`${CLAUDE_PLUGIN_ROOT}/kit/artifact-labels.mjs`). A PRD written with the other locale's headings fails the lint as `no-ac`.

If the session scratchpad holds `prd-extract-*.wip.json`, ask once: `Continue` / `Start over`. The WIP holds the collected material, the draft path and the open-question queue. Overwrite it after every question round; delete it once the PRD is saved.

## Revise mode

For a PRD that failed `coverage-gate --prd --lint` (the router's external-PRD import stops with a fix list) or was sent back at G1.

1. Read the file. It is the draft; its content is material marked as stated. Do not rewrite sections nobody asked to change.
2. Run the lint on it (Step 3 command). Together with the correction the user or the router gave, `lint.errors` is the work list. `lint.warnings` are shown, not forced.
3. Headings in the other locale → rename them to the config locale's labels (same keys in `artifact-labels.mjs`). Content stays.
4. Fix what the material answers; route the rest through Step 4.
5. Save to the same path. Revise mode never moves the file: an import places it under `<worksDir>` at G1. With `--pipeline <slug>` the path is already `<worksDir>/<slug>/prd.md`.

Then Step 5.

## Step 1 — Collect material, once

One `AskUserQuestion` (multiSelect) for what exists, then have the user paste or attach all of it in the next message:
- ticket · feature description
- server interface spec
- `<platformInterface.label>` interface spec — only when `platformInterface.enabled`
- Figma · screenshots (UI scenarios, design)
- publishing source (source-of-truth markup) paths

Areas not selected are written as `—` in the PRD header `Coverage` field. Skip the question when the conversation already holds the material.

**What to take from each kind of material**
- Server spec: new or changed endpoints and methods, required request parameters and response fields, error codes and their response shape, boundary cases (empty list, paging, timeout), endpoints to mock as fixtures.
- Platform spec: events and callbacks, when they fire, the data handed to the web app, platform differences, and how E2E can reproduce each one (prd-format, Platform Interface).
- Figma · screenshots: screen states, entry conditions, visible elements, transition triggers, hooks in `ui.selectorPriority` order (test ids first), items that need visual review.

**Large material**
- Text over ~400 lines: save it to the scratchpad and keep only excerpts in context. Put its path under `## Sources`.
- Read Figma through the Figma MCP when available (else a page fetch or the screenshots). With many screens, hand it to a `general-purpose` subagent and take back only the list above.

## Step 2 — Draft

Split the material into slots and fill each; never summarize a source as a whole. Every slot carries a confidence marker:
- `stated` — written in the source
- `inferred` — deduced from context
- `?unclear` — not parsed, or ambiguous

Required slots: feature name (`# <name> PRD`), target screen (`> **Scope**:`), acceptance criteria. ACs missing from the source are derived from the requirements and marked `inferred` in the `AC provenance` table.

**When an interface spec is the input**
- List every interface it defines in `### Spec I/F cross-check`, each with its requirement or a handling (`out of scope: <reason>`). An interface dropped while copying the spec into the PRD is invisible to every later check, because downstream treats the PRD as the baseline.
- Every copied spec value (URL, key or signature basis, field name) carries its source (file · page or sheet · section).
- When the spec lists both a proxy URL and a target URL, name the one the web client calls.

**With a publishing source**, fill `### Publishing source` per screen and state. Implementation copies markup from it. A matching stylesheet does not help when the markup differs, and no automated check catches that.

**Fixture mapping**: call the `dev-pipeline:fixture-advisor` agent with the endpoint list and the target screen, and mark each row `✅ exists` / `🆕 needed` against `e2e.fixturesDir`.

## Step 3 — Lint the draft

Write the draft to the scratchpad (`<scratchpad>/prd-extract-<feature-kebab>.draft.md`, named from the feature, not the slug settled in Step 5) and lint it there. In revise mode, lint the file itself.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/coverage-gate.mjs" --prd <draft path> --lint
```

Read `ok` first. `ok: false` → the run failed (`error` says why); never treat it as clean. Then `lint.errors`: fix from the material what you can before asking anything; the rest goes to the next question round. `no-ac` means no `**AC-NN**` line under the config locale's acceptance-criteria heading.

## Step 4 — Ask only blanks and contradictions

An open item is asked only if it passes all three gates, in order:
1. **Does it block a required slot or a lint error?** No → record it in `## Open Questions`; do not ask.
2. **Does the material already answer it?** Yes → resolve it and note the evidence (source · frame · section).
3. **Can this user answer it?** If it belongs to product, platform or server owners, record it in `## Open Questions` with that owner as the follow-up. Asking the user yields nothing.

Bundle what passes into one `AskUserQuestion` call, at most 4 questions. After each round update the draft and lint again. Never re-ask an issue already answered, however it is worded. Items left as `Pass` or `?unclear` are carried into `## Open Questions`, never dropped.

## Step 5 — Save and report

1. **Slug** (new PRD only): `<issue key>-<feature-kebab>` or `<feature-kebab>`; the issue key matches `issueKeyPattern`, taken from the argument, then the current branch name. Run the pre-emption check right before saving and handle a hit as the contract says (Slug):
   ```bash
   ls -d <worksDir>/<slug> <e2e.specsDir>/<slug> 2>/dev/null; git branch -a --list "*<slug>*"
   ```
2. Save only a draft whose last lint read `ok: true` with empty `lint.errors`: `mkdir -p <worksDir>/<slug>` and write `<worksDir>/<slug>/prd.md` (revise mode: the same path). Delete the WIP. Errors nobody here can answer → do not save; report them with the draft path.
3. Show:
   - path
   - metrics: AC count · requirement count · coverage (server / platform / UI / design) · spec I/F cross-check (unmatched count) · publishing source present or not · open-question count
   - pending decisions: the `## Open Questions` items that may block the next stage
   - `lint.warnings`

With `--pipeline` this is the gate summary and G1 is the router's. Standalone, confirm once with `AskUserQuestion` (`Confirm` / `Needs corrections` → revise mode on the saved file), then end with the one next action, alone in a code block: `/dev-pipeline:tc-extract <worksDir>/<slug>/prd.md`.

## Text rules for every AskUserQuestion

- no unreplaced `[...]` placeholders, no truncated descriptions
- labels in plain language; code, selectors and paths go in the description
- non-ASCII text written literally, never as `\uXXXX` escapes
- `(Recommended)` on at most one option, and only with a basis named in the description
