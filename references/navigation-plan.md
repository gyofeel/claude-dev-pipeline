# Navigation plan — interaction-agnostic schema

A navigation plan is how the `navigation-advisor` agent hands "how to reach the target state" to `spec-writer`. It is a JSON object validated by `scripts/nav-plan-schema.mjs` before any user confirmation or code generation. The schema says nothing about pointers, keyboards, or any product; `spec-writer` compiles it through the project adapter.

```jsonc
{
  "startUrl": "/catalog",                 // absolute path or full URL; null → the TC's start URL
  "steps": [
    { "action": "waitFor", "expr": "document.querySelector('[data-testid=list]') !== null", "timeout": 15000 },
    { "action": "waitFor", "selector": "[data-testid=list]", "timeout": 15000 },
    { "action": "click",   "target": { "by": "role", "value": "tab", "name": "Movies" } },
    { "action": "fill",    "target": { "by": "testid", "value": "search-input" }, "value": "inception" },
    { "action": "press",   "key": "Enter", "until": "urlChanges", "timeout": 5000 },
    { "action": "findAndEnter",
      "target": { "by": "text", "value": "Inception" },
      "until": "selectorVisible:[data-testid=detail-title]",
      "timeout": 10000,
      "fallback": "skip" },
    { "action": "loop", "max": 10, "body": [ { "action": "press", "key": "ArrowDown" } ],
      "until": "expr:document.activeElement?.dataset?.kind === 'movie'" }
  ],
  "postEnterCondition": { "type": "State", "expr": "detail.item?.id != null", "timeout": 8000 },
  "notes": "Movies tab lazy-loads; wait for list before selecting."
}
```

## Actions

| action | fields | compiled to |
|---|---|---|
| `goto` | `url` | `page.goto(url, { waitUntil: 'domcontentloaded' })` + `adapter.waitForAppReady` |
| `waitFor` | one of `expr` (JS boolean) / `selector` (CSS); `timeout` | `page.waitForFunction(() => expr, null, { timeout })` / `locator.waitFor({ state: 'visible' })` |
| `click` | `target`; optional `until`, `timeout` | `adapter.locator(page, target).click()` then `until` wait |
| `fill` | `target`, `value` | `locator.fill(value)` |
| `press` | `key`; optional `until`, `timeout`, `repeat` | `adapter.press(page, key)` then `until` wait |
| `findAndEnter` | `target`, `until`, `timeout`, `fallback` (`skip`\|`fail`) | `adapter.findAndEnter(page, target, { timeout })`; false → `test.skip` or throw per `fallback` |
| `loop` | `max`, `body[]`, `until` | for-loop running `body`, breaking when `until` holds; exhausting `max` → `fallback` of the enclosing plan (`skip`) |

`until` values: `urlChanges` · `selectorVisible:<css>` · `selectorHidden:<css>` · `expr:<js boolean>` · `focusChanges` (compares `adapter.focusExpr` or `document.activeElement` before/after).

## Target descriptor

See `references/adapter-contract.md` — `{ by: testid|role|text|css|predicate, value, name?, nth? }`. `predicate` additionally needs `source` (a state path such as `catalog.items`) and requires `ui.stateBridge`; pointer projects cannot use it.

## postEnterCondition

`null` → arriving (per `until`) is success. Otherwise `{ type: "DOM", selector, timeout }` or `{ type: "State", expr, timeout }`. It decides **whether the reached page is the intended kind of target**. It must not contain acceptance checks — those live in the TC's checkpoints (`verifications[]`) and are asserted after arrival. Mixing them makes "found but acceptance unmet" look like "not found" and produces false SKIPs.

## Validation (nav-plan-schema.mjs)

- every step has a known `action` and the required fields for it
- no `<…>` placeholders or `[...]` template tokens anywhere
- `until` matches the allowed forms
- `predicate` targets only when `ui.stateBridge` is set; `findAndEnter` only when `e2e.interaction` is `pointer` or the adapter exports `findAndEnter`
- `timeout` values are integers ≥ 500
- `loop.max` ≤ 50

Output: `{ "valid": true }` or `{ "valid": false, "errors": ["steps[2].target.by — unknown value 'xpath'"] }`.

## How the advisor fills it

1. Read the target page/component sources from `ui.pagesDir`/`ui.componentsDir` (plus the screen catalog if configured) to find stable hooks in `ui.selectorPriority` order.
2. Translate the user's scenario sentence into steps. Prefer `click`/`findAndEnter` with `testid`/`role`/`text` targets; use `css` only when no semantic hook exists and say so in `notes`.
3. Keep `postEnterCondition` to "is this the right kind of page", nothing else.
4. Run the validator; fix every error before returning.
