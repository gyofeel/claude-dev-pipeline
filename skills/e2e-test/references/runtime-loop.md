# Runtime validation loop

Runs after `spec-reviewer` passes. Each spec is executed for real and repaired by cause. `MAX_LOOP = 5`. Variables: `iteration = 1`, `previousContext = null`.

## One iteration

1. `Agent(dev-pipeline:spec-runtime-validator)` with `specPath`, `iteration`, `previousContext`. It runs `E2E_SKIP_AI=1 <commands.e2eRun> <specPath>`, parses `e2e.resultsJson`, and returns the JSON in `agents-io.md`. The validator only observes: it never installs, deletes, or changes permissions.
2. Branch on `status`.

### PASS

Print `Runtime verification passed (iteration N).` and leave the loop. Interview mode continues with Step 7; batch mode records the result.

### ENV — environment, not the spec

Does **not** consume an iteration.

- First ENV: settle (re-check `GET <e2e.baseUrl><e2e.healthUrlPath>` or wait 3 s) and retry once automatically.
- Still ENV: stop the loop and ask.

**Question**: "The run failed for an environment reason, not the spec."
- header: `Environment`
- description: `envReason` verbatim (the matched pattern from `e2e.envErrorPatterns`, unwritable directories from `e2e.writableDirs`, or "no results file and non-zero exit"), followed by what the user can do (start the dev server, free the port, fix ownership of the listed directories, install Playwright browsers with `npx playwright install`). The skill never runs those commands.
- options: `Fixed — retry` (re-enter with the same `iteration`) / `Keep the spec unverified` (leave the loop; mark the result "kept unverified — ENV")

### SKIP — the spec skipped itself

Branch on `skipKind`:

- **`NO_CANDIDATE`** — a `findAndEnter` or `loop` exhausted without a match. Navigation or target problem.
  `previousContext = { type: 'SKIP', skipKind, skipReason, diagnostics, iteration }` → `Agent(dev-pipeline:navigation-advisor)` with the same scenario and `previousContext` → schema gate → `Agent(dev-pipeline:spec-writer)` with the new plan → re-verify → `iteration++`.
- **`ENTERED_BUT_REJECTED`** — the target was reached but `postEnterCondition` (or the checkpoints) did not hold. Regenerating navigation would thrash. Stop and ask; this branch does not consume an iteration.

  **Question**: "The test reached the target, but the acceptance check did not hold there."
  - header: `Acceptance target`
  - description: `skipReason` and the diagnostics summary (what was found, what was expected)
  - options: `Relax or change the checkpoint` (text → rebuild `verifications`/`postEnterCondition`, spec-writer, re-verify, continue) / `Keep the spec as is` (leave the loop; result "kept — target rejected")
- **`null`** (no census attached) — treat as `NO_CANDIDATE`.

### FAIL — assertion or timeout inside the spec

`previousContext = { type: 'FAIL', failedStep, errorMessage, diagnostics, iteration }`.

- Diagnostics point at navigation (focus/URL never changed after a step, target not found before an assertion) → `navigation-advisor` with `previousContext`, then `spec-writer`.
- Otherwise → `spec-writer` only, with the failure context (it may fix timeouts, waits, or a wrong condition; it must not delete a checkpoint).
- Re-verify → `iteration++`.

## Re-verification inside the loop (cost control)

The initial gate before the loop was the full `spec-reviewer` agent. Inside the loop:

- **Always**: `node "${CLAUDE_PLUGIN_ROOT}/scripts/spec-lint.mjs" <specPath>` via Bash. `pass: false` → send violations to spec-writer and fix before running again (no browser run on a lint failure).
- **Only when State paths changed** (navigation-advisor was re-called, or spec-writer reports it touched a `State` expression): `node "${CLAUDE_PLUGIN_ROOT}/scripts/state-probe.mjs" <specPath>`.
- **Never** re-spawn the `spec-reviewer` agent inside the loop; the runtime run is the backstop for residual rules.

Trade-off: a body edit that introduces a new undefined state path is caught one iteration later by the runtime run, not immediately. Acceptable — bounded by `MAX_LOOP`.

## Exhaustion (`iteration > MAX_LOOP`)

1. Analyse the five results: FAIL/SKIP ratio, the step that failed most often, probable root cause (timeout, element never rendered, target predicate never true, environment limitation that should have been soft-tracked).
2. Report:
   ```
   Runtime verification exhausted — 5 iterations without PASS

   Pattern:
   - most frequent failing step: <step>
   - main error: <errorMessage summary>
   - probable cause: <analysis>

   Spec file: <specPath>
   ```
3. **Question**: "How should we proceed?"
   - header: `Next step`
   - options: `Keep the current spec` (leave as is for manual inspection) / `Give me a fix guide` (print the analysis as concrete edits, leave the file) / `Regenerate from scratch` (interview: back to Step 1; batch: rebuild this TC's input from the TC file and restart the chain once)

## Result vocabulary (used by batch summaries and pipeline gates)

| Result | Meaning |
|---|---|
| `PASS after N runs` | validator returned PASS on iteration N |
| `kept unverified — ENV` | user chose to keep the spec after an environment failure |
| `kept — target rejected` | user kept the spec after `ENTERED_BUT_REJECTED` |
| `exhausted after 5 runs` | loop limit hit; spec left in place |
| `generation failed` | spec-reviewer rejected twice before any run |
