# Task template (every task, identical shape)

SDD's implementer prompt lives in a read-only plugin cache. The only channels SDD **guarantees** to deliver are `## Global Constraints` and **each task's checkbox steps**, so the gate travels inside the plan and the implementer's report carries the gate JSON verbatim.

Placeholders: `<worksDir>`, `<slug>` from config and the input path; `<plan>` = `<worksDir>/<slug>/<slug>-plan.md`; `<test>` = the TC's `Unit target`. Labels (`Task`, characterization, RED exempt) follow `kit/artifact-labels.mjs` for the configured `locale`.

````markdown
### Task N: [TC-NN] <name>

**Files:**
- Create: <new file>            ← only paths that do not exist yet
- Modify: <existing file>       ← only paths that already exist
- Test:   <Unit target, verbatim from tc.md>

**Interfaces:**
- Produces: `<new export name and signature>`   ← the names listed here define this task
- Consumes: `<module#export>`

- [ ] Write the failing test — `it('UCP-NN: <description>')`, at least one `expect` per UCP row. When tasks append to the same test file, a helper or mock constant goes in with the first task that uses it (one placed earlier is an unused variable and the lint hook blocks the commit). An assertion that already passes on the unchanged code ("does not navigate", `not.toThrow`) can never be RED — gather those in a characterization task (`--phase char`)

```javascript
// complete test code
```

- [ ] `node "${CLAUDE_PLUGIN_ROOT}/scripts/red-gate.mjs" --phase red --plan <plan> --task N --file "$PWD/<test>" --test "UCP-NN: <description>"` → `OK_RED` (one line per UCP: `--test` must select exactly one test)
- [ ] Implement — satisfy the test above and the Interfaces. Required behaviour: <the requirement in sentences>
- [ ] `node "${CLAUDE_PLUGIN_ROOT}/scripts/red-gate.mjs" --phase green --plan <plan> --task N --file "$PWD/<test>" --test "UCP-NN: <description>"` → `OK_GREEN` (same arguments as the red line, not abbreviated: the plan lint checks every line)
- [ ] `<commands.format> <changed files>` (when set) `&& git add <changed files>` → `git commit -F .superpowers/sdd/<plan-basename>/commit-msg-task-N.txt`
- [ ] Report: `upstream conflict: none | <what differs from the PRD / TC>` · `style: surrounding | author — <reason>` when the task has a `Read context` step · `source deviation: none | <location — reason>` for a screen with a publishing source
````

Add `--project <name>` to both red-gate lines only when the runner has several projects and `unitTest.runnerArgs` does not already select the one that collects `<test>`. Omitted, no project filter is sent.

## Rules

- **No implementation code in the plan.** The test is the specification. With implementation code in the plan, the implementer copies it and skips RED. writing-plans' "no placeholders" is met by the test code and the `Produces` signatures.
- **Binding TCs to tasks**
  - TCs on the same module and the same test file may share a task. Write each id in its own brackets: `[TC-03][TC-04]`. The comma form `[TC-03, TC-04]` is not counted as ownership, and a bare `TC-NN` counts only as a reference.
  - A test that the previous task's implementation alone would already pass belongs in that previous task; on its own it can never be RED.
- **Wiring tasks**: TCs without a unit test whose owner in tc.md `## Implementation owners` is `implement`.
  - Get RED from a component mount test, following the mount-test convention in `constraintsFile` / `unitTest.testNaming` (do not assume a framework). With no UCP, name it `it('TC-NN: <description>')`; that is the `--test` target.
  - Only what a mount test cannot observe (real focus movement, host round trips, routing round trips) gets `**RED exempt:** <reason>` and no red-gate steps. Its surface must show up as reachable at the final gate.
- **Characterization tasks** pin current behaviour before an existing file changes. Mark them `**characterization**` and record the pre-change GREEN with `--phase char`. red-gate refuses `char` on a task without the marker.
- **Publishing source**: when the PRD's `### Publishing source` lists a file for the screen, put this in the implement step verbatim: "Copy markup (tags, class combinations, visibility conditions) from the source `<file>`. Do not rewrite it. Report every place you differ as `source deviation: <location> — <reason>`."
- **Shared design goes before the first task.** The task brief is cut from the `### Task N` section only, so a `##` section between tasks attaches to the previous task's brief alone (the plan lint rejects it).
- `--file` is **absolute** (`"$PWD/<test>"`); a relative path resolves against the runner's root, not the repo. The `--test` string equals the `it()` name character for character.
- Formatting runs **before every commit**: SDD commits per task and per fix round, so a final "normalize once" pass never happens.
- **Never `--no-verify`, never `git add -A` / `git add .`.** A blocked hook is routed (failure-routing.md), not bypassed; working trees hold untracked credentials.
- **The controller writes the commit message file before dispatch.** The implementer commits with `-F` and never writes or edits the message — implementers were observed swapping the trailer for their own model name.
