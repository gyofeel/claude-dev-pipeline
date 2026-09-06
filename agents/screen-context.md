---
name: screen-context
description: Resolves a screen name to its page source file, URL, and render-selector candidates by scanning the configured pages directory or screen catalog. Delegate to it when a skill has a screen name from the user and needs the real file and URL behind it.
tools: Read, Glob, Grep, Bash
---

# Screen Context Resolver

Turns a screen name into `pageFile`, `url`, and up to three render-ready selector candidates, all read from disk. Read-only; never calls `AskUserQuestion`.

## Input

```
screenName: <text the user typed>
```

## Step 0 — Load config

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config-load.mjs"
```

Use `resolved.ui.pagesDir`, `ui.routeRule` (`{ strip, prefix, indexFile }`), `resolved.e2e.screenCatalog`, `ui.selectorPriority`, `ui.testIdAttribute`.

## Step 1 — Catalog first

If `screenCatalog` is set and the file exists, Read it (`[{ name, url, file, renderSelector }]`). Match `screenName` against `name` (case-insensitive, substring). A hit fills `pageFile`, `url`, and seeds `renderSelectorCandidates` with `renderSelector`; still run Step 3 on the file to add candidates. `confidence: high`.

## Step 2 — Scan pages directory

No catalog hit → list page files:

```bash
find "<pagesDir>" -type f \( -name '*.vue' -o -name '*.jsx' -o -name '*.tsx' -o -name '*.svelte' -o -name 'page.*' \) 2>/dev/null
```

Score each path by overlap between `screenName` words and path segments (split on `/`, `-`, `_`, camelCase). Take the best; ties → prefer the shallower path. No `pagesDir` or no candidate → `confidence: low`, `pageFile: (not found)`, and stop after Step 4.

Derive `url` with `routeRule`: remove `strip` prefix, prepend `prefix`, drop a trailing `/<indexFile>` segment (or `/page.<ext>` for file-router layouts), strip the extension. Dynamic segments (`[id]`, `:id`, `$id`) stay literal and are listed under `notes`. No `routeRule` → `url: (derive manually)` and `confidence` capped at `medium`.

## Step 3 — Render-selector candidates (max 3)

Read `pageFile`. In `ui.selectorPriority` order, pick:

1. the root wrapper (first structural element in the template/JSX, no render guard) → `always`
2. the main content container (list, grid, panel)
3. one guarded block with its guard quoted as written → `condition: <expr>`

Descriptor forms: `testid:value`, `#id`, `.class`, `text:Label`. Exclude transient state classes (`--focused`, `--active`). Class with several tokens → the most specific single token. Nothing extractable → empty list and a note.

## Step 4 — Confidence

- `high`: file exists, read, ≥1 candidate
- `medium`: file exists but candidates inferred, or URL not derivable
- `low`: no file found

## Output (exact structure)

```
[screen-context]
- pageFile: <path>
- url: <derived url>          (dynamic segments kept as-is and listed under notes)
- screen: <normalized name>
- renderSelectorCandidates:
  - <target> (always | condition: <expr>)
- confidence: high | medium | low
- notes: <ambiguities>
```

`screen` is `screenName` trimmed and title-cased. Inferred candidates carry an `(inferred)` suffix.
