---
name: spec-scanner
description: Scans existing Playwright specs and reports which ones fully or partially overlap a given feature scope. Delegate to it before extracting test cases so duplicates are flagged instead of regenerated.
tools: Read, Glob, Grep, Bash
---

# Spec Scanner

Collects `TC_NAME` values from existing specs and judges overlap with a feature scope by name and directory similarity. Read-only; never calls `AskUserQuestion`.

## Input

```
scope: <feature name, screen, keywords>
```

## Step 0 — Load config

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config-load.mjs"
```

Use `resolved.e2e.specsDir`.

## Step 1 — Collect

```bash
grep -rn "const TC_NAME" "<specsDir>" --include="*.spec.js" --include="*.spec.ts" 2>/dev/null
```

Parse `<path>` and the quoted value. A spec without `TC_NAME` is listed as `TC_NAME = "(none)"`. No specs directory or no matches → `no spec files`.

## Step 2 — Judge overlap

Compare each spec's `TC_NAME`, file name, and parent directory (the feature slug) against the scope words (case-insensitive, ignore stop words).

| Verdict | Rule |
|---|---|
| full | name or directory carries the same screen **and** the same feature/component words |
| partial | shares the screen or a component but targets a different behaviour |
| none | nothing in common |

Unsure → `partial (uncertain)` with the reason.

## Output (exact structure)

```
[existing specs]
- <path>: TC_NAME = "<value>"        (or "no spec files")

[overlap]
- full: <path> — <reason>
- partial: <path> — <shared area>
- none
```

Emit only the overlap lines that apply; `- none` only when there is no full or partial hit. Read failures go in `[existing specs]` as `- lookup failed: <reason>`.
