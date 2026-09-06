# Shared pipeline contract — gates, slug, state file

Both orchestrators (`auto-e2e-pipeline`, `auto-dev-pipeline`) follow this document. Defining it twice causes drift; do not copy it.

Paths come from `.agents/pipeline.config.json` (`worksDir`, `e2e.specsDir`, `branchPrefix`, `issueKeyPattern`). Below, `<worksDir>` etc. stand for the resolved values.

## Gate contract (every G)

A stage transition passes through exactly one `AskUserQuestion`. Its `description` carries three things:

1. **Artifact path** — full path so the user can open it
2. **Key metrics** — counts produced by the stage (each gate defines its metric line)
3. **Review checklist, 2–3 lines** — only what a human must actually look at; never "review everything"

Options (4; the last gate has 3):

| Option | Action |
|---|---|
| `Artifact reviewed — continue` | mark the stage `done` + `confirmedAt` in the state file, invoke the next skill |
| `Re-run this stage` | take correction text, re-invoke the **same skill** (overwrites the artifact), return to the same gate |
| `Continue in a new session` | save state, print the resume command, **stop** |
| `Stop here` | save state, list artifacts produced so far, stop |

The last gate offers `Done` / `Re-run this stage` / `Stop here`.

> Why "new session": the sub-skill bodies are long. Running all stages in one context degrades later stages. Every artifact is a file, so nothing is lost by splitting.

### Gate text rules

Before calling `AskUserQuestion`, re-read every question, label, and description:

- no unreplaced `[...]` template variables
- no truncated sentences (especially at the end of descriptions)
- labels are plain language — no raw code, selectors, or state paths (put those in the description)
- options within one question share one grammatical form; `(Recommended)` appears on at most one option

## Slug

A **slug** is the short identifier of one feature. It names the work directory and joins every artifact.

```
slug = PROJ-1234-home-block-filter
├─ <worksDir>/PROJ-1234-home-block-filter/        work directory
│   ├─ prd.md                                     requirements
│   ├─ tc.md                                      test cases
│   ├─ PROJ-1234-home-block-filter-plan.md        implementation plan
│   └─ state.json                                 progress (gitignored)
├─ .superpowers/sdd/PROJ-1234-home-block-filter-plan/   SDD workspace (superpowers)
├─ <e2e.specsDir>/PROJ-1234-home-block-filter/    E2E specs
└─ branch: <branchPrefix>PROJ-1234-home-block-filter
```

File names inside the work directory are fixed (`prd.md`, `tc.md`, `state.json`), so **the slug is read from the parent directory name.** Only the plan keeps the slug in its file name, because superpowers SDD names its workspace after the plan's basename (a plain `plan.md` would make every feature share `.superpowers/sdd/plan/`).

Without a state file, artifacts are located by this layout to infer the resume point. **Therefore a colliding slug silently overwrites someone else's work** — hence the pre-emption check below.

### Format

```
<issue-key>-<feature-kebab>     e.g. PROJ-1234-home-block-filter
<feature-kebab>                 e.g. home-block-filter   (no ticket)
```

- issue key matches `issueKeyPattern` (default `[A-Z]+-\d+`)
- feature part is lowercase kebab-case ASCII: it becomes a directory and branch name

### Getting the issue key — first hit wins, never ask twice

1. **From `$ARGUMENTS`** — `/dev-pipeline:auto-e2e-pipeline PROJ-1234 home block filter`
2. **From the current branch** — `git branch --show-current`, match `issueKeyPattern` (works with `PROJ-1234`, `feature/PROJ-1234-x`, `feat/PROJ-1234-x`)
3. **Otherwise ask once** at slug confirmation (below)

### Slug confirmation — once, right before the PRD is saved

The slug needs the feature name, and the feature name is settled by the `prd-extract` interview. So the confirmation point is **immediately before PRD save**, exactly once.

**Question**: "Confirm the slug for this work. Artifact names are derived from it."
- header: `Slug`
- description: preview
  ```
  Proposed slug: PROJ-1234-home-block-filter
    work dir   <worksDir>/PROJ-1234-home-block-filter/
      prd.md · tc.md
    branch     <branchPrefix>PROJ-1234-home-block-filter
  ```
- options:
  - `Use this slug`
  - `Enter a slug` — free text; if it violates the format, show a corrected proposal and confirm again
  - `Continue without an issue key` — slug = feature part only

> Never force an issue key. Spikes, defect reproductions, and personal experiments legitimately have none; forcing one produces fake keys and erodes the rule.

### Early collision check — before the interview (Step 0)

Once an issue key is known, scan for work already started on the same ticket, before spending interview time:

```bash
ls -d <worksDir>/${ISSUE}-* 2>/dev/null
git branch -a --list "*${ISSUE}*"
```

A hit routes to the resume flow (0-c). No issue key → skip.

### Pre-emption check — right after slug confirmation

```bash
ls -d <worksDir>/${SLUG} 2>/dev/null
ls <worksDir>/${SLUG}/ 2>/dev/null
ls -d <e2e.specsDir>/${SLUG} 2>/dev/null
git branch -a --list "*${SLUG}*"
```

Any hit → stop and ask:

**Question**: "Artifacts with this slug already exist. How should we proceed?"
- header: `Slug collision`
- description: found files/branches with their last-modified times
- options:
  - `Resume that work` — it is mine; go to the Step 0 resume flow
  - `Start fresh with another slug` — take a new slug as text
  - `Stop` — may belong to someone else; check before re-running

### Passing the slug to sub-skills

The orchestrator passes the confirmed slug explicitly on every sub-skill call (`/dev-pipeline:prd-extract --slug <slug> …`, `/dev-pipeline:tc-extract <prd path>`, `/dev-pipeline:e2e-test <tc path>`). `tc-extract` and `e2e-test` also derive it from the input file's parent directory, so the explicit value and the derived one must agree; the orchestrator checks this before the gate.

## State file

Path: `<worksDir>/<slug>/state.json` — add `**/state.json` under `worksDir` to `.gitignore` (the `init` skill does this).

```json
{
  "pipeline": "auto-e2e-pipeline",
  "slug": "PROJ-1234-home-block-filter",
  "issue": "PROJ-1234",
  "createdAt": "2026-08-27T07:00:00.000Z",
  "options": [],
  "stages": [
    { "name": "prd-extract", "status": "done",    "artifact": "<worksDir>/PROJ-1234-home-block-filter/prd.md", "confirmedAt": "2026-08-27T07:20:00.000Z" },
    { "name": "tc-extract",  "status": "done",    "artifact": "<worksDir>/PROJ-1234-home-block-filter/tc.md",  "confirmedAt": "2026-08-27T07:40:00.000Z" },
    { "name": "e2e-test",    "status": "pending", "artifact": null, "confirmedAt": null }
  ],
  "next": "e2e-test"
}
```

- `status`: `pending` / `running` / `done` / `skipped`. `skipped` is a **deliberate user choice**, never a failure; record `skipReason` (e.g. `"-no-e2e option"`).
- `options`: option strings given at launch (`[]` if none). Restored on resume; options given at resume time override.
- A stage becomes `done` **only when its gate passes**. A sub-skill having written a file is not `done`; the user's review is the definition of completion.
- `artifact` values are repo-relative paths as written on disk (not `<worksDir>` placeholders).
- `slug` equals the work directory name. When derived from an input path, use the **parent directory name**, not the file name.
- `issue`: issue key or `null`. Derived from the slug prefix; stored so resume needs no re-parsing.
- Create the directory if missing: `mkdir -p <worksDir>/<slug>`.

The state file is a convenience, **not the single source of truth**. If it is missing, infer the resume point from which artifacts exist (`prd.md` → start at the TC stage, `tc.md` → start at the next stage, `<slug>-plan.md` → implementation began; also read `.superpowers/sdd/<slug>-plan/progress.md` and never re-run tasks marked complete).
