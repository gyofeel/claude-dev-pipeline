# Task checkbox contract (every task, identical shape)

SDD's implementer prompt lives in a read-only plugin cache and cannot be edited. The only channels SDD **guarantees** to deliver are `## Global Constraints` and **each task's checkbox steps**. So the gate travels inside the plan, and the implementer's report carries the gate JSON verbatim.

Placeholders: `<worksDir>`, `<slug>`, `<scope>` from config / pipeline state; `<abs test>` is the absolute path of the `Unit target`.

````markdown
### Task N: [TC-NN] <name>

**Files:**
- Create: <implementation file path>
- Test:   <Unit target, verbatim from tc.md>

**Interfaces:**
- Produces: `<function signature>`
- Consumes: `<module#export>`

- [ ] Write the failing test — `it('UCP-NN: <description>')` (real code below)

```javascript
// Complete test code. No placeholders.
```

- [ ] `node "${CLAUDE_PLUGIN_ROOT}/scripts/red-gate.mjs" --phase red --plan <worksDir>/<slug>/<slug>-plan.md --task N --file <abs test> --test "UCP-NN: <description>"`
      → confirm `{"ok":true,"failureClass":"OK_RED"}`. Any other class: follow failure-routing.md.
      **Do not write production code first.**

- [ ] Minimal implementation (real code below)

```javascript
// Complete implementation. Only enough to pass the test.
```

- [ ] `node "${CLAUDE_PLUGIN_ROOT}/scripts/red-gate.mjs" --phase green --plan <worksDir>/<slug>/<slug>-plan.md --task N --file <abs test> --test "UCP-NN: <description>"`
      → confirm `{"ok":true,"collateral":{"newFailures":[]}}`

- [ ] `<commands.format> <changed files>` (only if `commands.format` is set) && `git add -A`
- [ ] `git commit -m "test(<scope>): TC-NN UCP-NN <summary> — RED→GREEN"`
````

Rules:

- `--file` must be **absolute**; relative paths resolve against the runner's root, not the repo.
- The `--test` string must equal the `it()` name character for character — it is red-gate's target filter.
- Formatting runs **before every commit** because SDD commits per task and per fix round; a final "normalize once" pass never happens.
- **Never `--no-verify`.** A blocked pre-commit hook is routed, not bypassed (see failure-routing.md).
