---
name: style-extract
description: Use when a developer wants their own coding style (code shape, preferred patterns, design structure, and work habits if they want) written down from their commit history so /dev-pipeline:tdd-implement can pass it to implementers as context. Also builds the project's development-layer catalog the first time. Triggers on "extract my style", "make my style file", "my coding preferences", "/dev-pipeline:style-extract". With an existing style file it updates only what changed.
---

# Style extract

Builds one developer's style file from commit history plus a short confirmation. A style file holds **tendencies and context, not rules**. This skill judges nothing either: it writes "this person tends to write it this way", with evidence.

`/dev-pipeline:tdd-implement` reads the file at PLAN step 4 (style context) and points every plan task at the matching section.

## Usage

```
/dev-pipeline:style-extract [name]
```

## Files

| Path | Role |
|---|---|
| `<style.layersDir>/catalog.json` · `<id>.md` | The project's development layers and how each is written today (node 0 drafts them) |
| `${CLAUDE_PLUGIN_ROOT}/scripts/style/resolve-layer.mjs` | path → layer, catalog check |
| `${CLAUDE_PLUGIN_ROOT}/scripts/style/collect.mjs` | collect commits, drop noise, sample per layer |
| `<style.stylesDir>/.work/<name>/` | working files, never committed: `evidence.json`, `hypotheses.md`, `draft.md` |
| `<style.stylesDir>/<name>.md` | the result |

`style.*` comes from `.agents/pipeline.config.json` (see the plugin's `references/config-schema.md`). Read it once (a missing config → apply "Missing config" in the shared contract's User-facing output, `../auto-e2e-pipeline/references/shared-contract.md`, then read again):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config-load.mjs" --get style || node "${CLAUDE_PLUGIN_ROOT}/scripts/config-load.mjs" --defaults
```

No config is fine: the scripts fall back to the defaults. Add `<style.stylesDir>/.work/` to `.gitignore` if it is not there.

Talk to the developer in config `language` (`config-load.mjs --get language`; no config → the language they write in) and shape every message by the contract's User-facing output (`../auto-e2e-pipeline/references/shared-contract.md`).

## Flow

Each node ends with one artifact. The developer is asked in node 0 (only when the catalog is new) and node 5.

### 0. Catalog — only when `<style.layersDir>/catalog.json` is missing

1. Show the shape of the code:
   ```bash
   git ls-files | awk -F/ 'NF>2{print $(1)"/"$(2)} NF==2{print $(1)} NF==1{print "."}' | sort | uniq -c | sort -rn | head -40
   ```
2. Draft `catalog.json` and one doc per layer from [references/layer-menu.md](references/layer-menu.md). Read a few files per folder before assigning it; a folder name is a hint, not proof. Fill `## Methodology` with counts and example paths from the code.
3. Suggest `style.codeRoots` / `style.extraCodeFiles` when the code lives under a few roots, so tooling and docs folders do not flood the check. Write them to the config only with the developer's yes.
4. One `AskUserQuestion`: the layer list with one line each, and the folders whose assignment is a judgment call (at most 4 questions). This does not count toward node 5's budget.
5. `node "${CLAUDE_PLUGIN_ROOT}/scripts/style/resolve-layer.mjs" --check` until `errors` and `unmapped` are both empty: assign each unmapped file or add it to `excluded`.

The catalog is shared by every developer. Tell the developer to commit it, and that later runs reuse it.

### 1. Input

Decide four values. Not part of the question budget.

- **Emails**: default `git config user.email`. Ask once whether they also committed under other addresses (work and personal accounts).
- **Name**: the argument, or the part of the email before `@`.
- **AI adoption date**: the day they started using AI coding tools in earnest. `auto` when they do not know.
  - Only commits before this date count as their style. Later code is mixed with AI-written code.
  - Commit trailers cannot be trusted to separate AI-written commits; many teams strip them.
- **Lower bound**: commits before this date are ignored. Very old code may not reflect current taste. Show commits per year (`git log --no-merges --author=<email> --until=<adoption date> --format=%ad --date=format:%Y | sort | uniq -c`) and let them choose.

Ask all four in one `AskUserQuestion`. When `<style.stylesDir>/<name>.md` exists, its front matter (`emails`, `ai_cutoff`, `since`) are the defaults and the run is in **update mode**.

### 2. Collect

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/style/resolve-layer.mjs" --check
node "${CLAUDE_PLUGIN_ROOT}/scripts/style/collect.mjs" --emails <email,email> --until <adoption date|auto> \
  --since <lower bound> --out <style.stylesDir>/.work/<name>/evidence.json
```

- A failing `--check` stops the run: report it; the catalog comes first.
- `collect` takes seconds. Show its two output lines verbatim (totals, `mine/baseline` samples per layer). `totals.formatOnly` counts samples dropped because their diff was whitespace only, not format commits across history. `totals.noise` counts commits whose subject matched `style.noiseSubjects`.
- Malformed dates or counts exit 2. Read the message and fix the arguments.
- Evidence shape: `layers.<id>.mine` (their samples), `baseline` (other authors, same period), `afterCutoff` (their files changed after the adoption date). Each sample has a `kind`:
  - `others`: a diff on a file someone else created. Preference shows most clearly here.
  - `own`: a diff on a file they created.
  - `new`: a file they created.

### 3. Analyze

Read `evidence.json`, the layer docs, and the project rule files (`constraintsFile`, `CLAUDE.md`, `AGENTS.md` when present). Write `hypotheses.md`.

`evidence.json` runs to hundreds of KB. Read one layer at a time:

```bash
node -e 'const l=require(process.argv[2]).layers[process.argv[1]];for(const k of ["mine","baseline"])for(const s of l[k])console.log(`### ${k} ${s.kind} ${s.sha.slice(0,7)} ${s.date} ${s.file}\n${s.diff}\n`)' <layer id> <absolute path to evidence.json>
```

When context runs short, hand nodes 3–4 to one subagent and keep nodes 5–6. Compare a diff's `-` lines (before; someone else's when `kind` is `others`) with its `+` lines (theirs): that is where preference shows.

One hypothesis per tendency, per layer:
- one line: "tends to …"
- 2–3 evidence samples (7-char `sha` · file)
- a question type, when it is a question candidate

**Not hypotheses**
- Shapes the project rules or the formatter already enforce. Those are team rules, not taste.
- Tendencies that show equally in `baseline`. Those are team habits.
- Anything with a single sample.

**Question types** (priority order)
1. **Split**: evidence inside one layer points both ways.
2. **Unlike the team**: clearly differs from `baseline`. This is where the person shows.
3. **Against the rules**: the tendency contradicts the project rules or the runner's own instructions (e.g. a global `CLAUDE.md`). Rules stated now beat old habits. These never go into the style file; node 5 only shows them.
4. **Not in the code**: design philosophy, or whether some code was a compromise. Code alone cannot tell habit, belief and compromise apart.

When `mine` is empty in every layer (almost no commits before the adoption date), skip hypotheses and prepare type-4 questions only.

### 4. Draft

Write `draft.md` from the hypotheses in the format below. Question candidates go in too, marked.

### 5. Confirm → `AskUserQuestion` (once by default, twice at most)

**Do not ask item by item.** The draft already holds the skeleton. Ask only what people differ on and what is confusing.

- Pick **at most 4** candidates in priority order. The rest stay in the draft.
- One question = the hypothesis line + a 3–6 line excerpt of one sample.
  - Options: `Yes — intended` / `Compromise — I want something else` / `No`. Free text is always available.
  - Type 4 is an open question.
- In the same call's description:
  - the draft path, and "the other hypotheses are in the draft; tell me only what to change"
  - the tendencies left out for being against the rules
- Open a **second call** only when an answer raised a new question, e.g. `Compromise` without saying what they want instead.
- **Update mode**: instead of hypothesis questions, show only the sections that differ from the existing file and ask `Apply` / `Keep current` per section.

### 6. Write

Write `<style.stylesDir>/<name>.md` from the answers.
- `Yes`: keep.
- `Compromise`: write what they want instead. If they did not say, drop the hypothesis.
- `No`: drop.
- **Candidates not asked**: keep them with `(unconfirmed)` at the end of the line. Do not let them pass as confirmed. They become question candidates on the next update.
- Work habits the developer states (e.g. "ask before guessing") go into a free section as said.

Report: file path, sections per layer, number of `AskUserQuestion` calls, where the working files are. Commit only when the developer asks. End with one next action in plain words: the next `/dev-pipeline:tdd-implement` plan picks the file up on its own (it matches the developer's `git config user.email`).

## Style file format

````markdown
---
name: <name>
emails: [<email>, ...]
ai_cutoff: <YYYY-MM-DD>
since: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
---

# <name> style

## <layer id> — <layer name>

- <tendency in one line>. <reason in one line>
  ```javascript
  // 3–8 lines from a real diff
  ```

## <free section>
````

- Layer section headings keep the form `## <id> — <name>`; `plan-context` finds sections by the id before ` — `. Ids come from `catalog.json`.
- No evidence, no section.
- Content that belongs to no layer (work habits and the like) goes in free sections with any name. `tdd-implement` passes free sections to every task.
- Write tendencies ("tends to", "prefers"), not rules ("must", "never"). Give the reason.
- Do not copy the project rules into it.

## Not done here

- Asking about every hypothesis
- Committing `<style.stylesDir>/.work/`
- Editing the project rules. After node 0, the catalog and layer docs change only on the developer's request; when they look wrong, report it
- Using commits after the adoption date as evidence
