---
name: prd-extract
description: Use when a feature's requirements are scattered across tickets, Figma, interface specs, or verbal descriptions and need to be consolidated into one PRD before any code or test work starts. Also the first stage of the auto-dev-pipeline and auto-e2e-pipeline. Triggers on "write a PRD", "organize requirements", "extract the spec", or starting feature work without a written spec.
---

# PRD Extraction

Collect functional requirements, external interfaces, UI scenarios, and design guidance through a slot-based interview, then emit a **PRD file** whose format `tc-extract` parses 1:1. Format: [references/prd-format.md](references/prd-format.md). Interview prompt texts: [references/interview-prompts.md](references/interview-prompts.md).

```
/dev-pipeline:prd-extract [feature name]
```

## Step 0 — Config and resume

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config-load.mjs"
```

Missing config → stop: "No `.agents/pipeline.config.json`. Run `/dev-pipeline:init` first." Keep `worksDir`, `platformInterface`, `e2e.fixturesDir`, `ui.selectorPriority`.

Then look for `prd-extract-*.wip.json` in the session scratchpad. If one exists → `AskUserQuestion`:

**Question**: "An unfinished PRD interview was found. Continue it?"
- header: `Resume`
- description: feature name, last completed step, saved time
- options: `Continue from the last step` / `Start over (discard the draft)`

> **Every interview step uses the `AskUserQuestion` tool.** Never print a table and say "fill this in". After each input, summarize what was understood and get confirmation before moving on.

## Collection state

The interview fills **one state object**. Do not summarize pasted material as a whole; decompose it into slots and fill each independently. Step 6 renders the PRD deterministically from this object.

```jsonc
{
  "feature": {
    "name": "",                // required
    "targetScreen": "",        // required — screen > component
    "requirements": [],        // required
    "acceptanceCriteria": [],  // required — derive from requirements if absent
    "exceptions": [],
    "relatedApi": []
  },
  "serverInterface": null,     // object | "pass" | null
  "platformInterface": null,   // only collected when config platformInterface.enabled
  "uiScenario": null,
  "designGuide": null,
  "sources": [],               // original material paths/links
  "openQuestions": []          // see Question rules
}
```

Every slot value carries a confidence marker:

| Marker | Meaning | Handling |
|---|---|---|
| `stated` | explicit in the source | collapsed as reference in confirmation rounds |
| `inferred` | deduced from context | surfaced only when it passes the three gates |
| `unclear` | parse failed / ambiguous | blocks progress if the slot is required; otherwise deferred |

**Required gate**: `name`, `targetScreen`, `acceptanceCriteria` must not be `unclear`/missing before leaving Step 1.5. Optional slots roll into `openQuestions`.

**Draft save**: after each `.5` confirmation round, overwrite `<scratchpad>/prd-extract-<feature-slug>.wip.json` with the whole state. Delete it when Step 6 saves the PRD.

## Question rules

The goal is PRD accuracy, not question count. These rules apply to every `.5` round and every extra question in between.

Each `openQuestions[]` entry:

```jsonc
{ "id": "OQ-03", "slot": "uiScenario", "question": "…",
  "blocksRequired": false, "answerer": "user | product | platform | server",
  "resolvableBy": ["figma", "serverSpec"], "status": "pending | ask | resolved | deferred", "resolution": null }
```

**Three gates — only what passes all three is asked:**

1. Blocks a required slot? `false` → `deferred`; record in `## Open Questions`, do not ask.
2. Could material not yet received answer it? `resolvableBy` non-empty → `pending`; re-judge after that material arrives.
3. Is this user the answerer? `answerer !== "user"` → `deferred` with the follow-up owner noted. Asking the user yields nothing.

Gate 1 hits are asked immediately regardless of gates 2–3. **Max 3 asks per round; ≤10 extra questions per interview** (required-slot blockers excluded). Overflow → `deferred`.

**Resolution check on every new material** (Steps 2–5): before summarizing, compare all `pending` items against it. Answer found → `resolved` + evidence (file/frame/section), no question. Otherwise, if `resolvableBy` is exhausted → gate 3 → `ask` or `deferred`. Right before the final confirmation round (usually Step 5.5, or before Step 6 if skipped), settle every remaining `pending`. That is the last chance to ask.

**Never ask twice**: search the queue before forming a question; same slot + same issue already answered/resolved → use it. On resume, read the queue from the draft first. "Ask me everything" from the user does not lift gate 3 — show the deferred items as a "to confirm with product/platform" list instead.

**Round display**: only `ask` items under "Needs confirmation now"; `pending` as a one-line count with the material that would resolve them; `deferred` not shown (it appears in the PRD).

## Source preservation

- Pasted tickets/specs are kept after slot decomposition: store the text or its path in `sources[]` → PRD `## Sources`.
- Material over ~400 lines: save to the session scratchpad instead of holding it in context; keep only slot excerpts. Only then consider delegating the parse to a `general-purpose` subagent — below that size, parsing in the main context is cheaper than the round trip.

## Phase 1 — Requirement collection

### Step 1 — Feature information → `AskUserQuestion`

**Question**: "Which feature should we write the spec for?"
- header: `Feature`
- options:
  - `Paste a ticket` — ticket body (text/markdown) in the next message
  - `Describe it` — feature name and scope in your own words
  - `Use what I already told you` — pull from the current conversation

Follow-up prompt text per option: [interview-prompts.md § Step 1](references/interview-prompts.md). Parse into slots with markers; large material per Source preservation.

### Step 1.5 — Confirm feature understanding → `AskUserQuestion` [auto]

Immediately after Step 1, present the slot summary (template in [interview-prompts.md § Step 1.5](references/interview-prompts.md)) showing only `ask` items and required-slot blockers up top, pending count, then `stated` slots collapsed.

**Question**: "Is this understanding of the feature correct?"
- header: `Confirm feature`
- options:
  - `Correct — next step`
  - `Answer what I can now` — text for the items listed; the rest waits for later material
  - `Let me re-enter it` — back to Step 1

Required gate applies: with any required slot `unclear`, do not accept `Correct`; request that slot first.

### Step 2 — External interfaces → `AskUserQuestion`

Always ask about the **server API**; ask about the **platform bridge** only when `platformInterface.enabled` is true (use `platformInterface.label` in the wording). Two questions in one call when both apply.

**Question A**: "Is there a server API spec or server-side work for this feature?"
- header: `Server API`
- options: `Yes — paste it` / `Yes — attach a file` / `None` / `Pass — fill in later`

**Question B** (conditional): "Is there a <label> interface spec (events, callbacks, SDK calls)?"
- header: `<label>`
- options: `Yes — paste it` / `Yes — attach a file` / `None` / `Pass — fill in later`

Follow-up texts and what to extract: [interview-prompts.md § Step 2](references/interview-prompts.md). Attached files are read with Read.

### Step 2.5 — Confirm interfaces → `AskUserQuestion` [only when something was provided]

Run the resolution check first. **Chunking**: more than 5 endpoints (or events) → confirm in groups, one round per group.

Before proposing fixture names, call the `dev-pipeline:fixture-advisor` agent with the endpoint list and target screen. Mark each endpoint's fixture `✅ exists` or `🆕 needed` against `e2e.fixturesDir`.

Summary template: [interview-prompts.md § Step 2.5](references/interview-prompts.md).

**Question**: "Is this understanding of the external interfaces correct?"
- header: `Confirm interfaces`
- options: `Correct — next step` / `Needs corrections` / `There is more spec`

### Step 3 — UI scenarios → `AskUserQuestion`

**Question**: "Do you have UI scenario material?"
- header: `UI scenarios`
- options: `Figma URL` / `Screenshots` / `Both` / `None / Pass`

On receipt, dispatch a `general-purpose` subagent with: feature name, target screen, the URL or images, and the extraction goals in [interview-prompts.md § Step 3](references/interview-prompts.md). Use the Figma MCP when available; otherwise WebFetch the URL or analyse screenshots.

### Step 3.5 — Confirm UI scenarios → `AskUserQuestion` [when material was given]

Resolution check, then the summary (template in [interview-prompts.md § Step 3.5](references/interview-prompts.md)).

**Question**: "Is this understanding of the UI scenarios correct?"
- header: `Confirm scenarios`
- options: `Correct — next step` / `Needs corrections` / `Let me add context`

### Step 4 — Design guide → `AskUserQuestion`

**Question**: "Do you have design guide material?"
- header: `Design guide`
- options: `Figma URL` / `Screenshots` / `Same as the UI scenarios` / `Pass`

`Same as the UI scenarios` → reuse the Step 3 agent result; do not spawn again. Otherwise dispatch a `general-purpose` subagent with the goals in [interview-prompts.md § Step 4](references/interview-prompts.md): hooks in `ui.selectorPriority` order (test ids first), component states, responsive notes, items that need manual visual review.

### Step 4.5 — Confirm design guide → `AskUserQuestion` [when material was given]

Resolution check, then the summary ([interview-prompts.md § Step 4.5](references/interview-prompts.md)).

**Question**: "Is this understanding of the design guide correct?"
- header: `Confirm design`
- options: `Correct — save the PRD` / `Needs corrections` / `I'll give you the exact hooks` — test ids / class names as text

## Step 6 — Save the PRD

Settle the queue: remaining `pending` → `ask` or `deferred`; if any `ask` exists, run one last round (max 3) **before** the save question.

> **Caller-provided slug wins.** When invoked by `/dev-pipeline:auto-e2e-pipeline` or `auto-dev-pipeline`, the orchestrator passes a slug; use `<worksDir>/<slug>/prd.md` as the proposed path. Generate a kebab-case slug from the feature name only when running standalone. The slug is the work-directory name and the join key for every later artifact — downstream skills read it from the parent directory, so saving elsewhere breaks the pipeline.

**Question**: "Ready to save the PRD. Confirm the path."
- header: `Save PRD`
- description: `Path: <worksDir>/<slug>/prd.md` + collected sections (Feature ✅ / Server ✅|⚠️Pass / <label> ✅|⚠️Pass|— / UI ✅|⚠️Pass / Design ✅|⚠️Pass)
- options:
  - `Save here`
  - `Change the slug` — work-directory name as text; file name stays `prd.md`
  - `Go back and edit` — return to the last confirmation step

Then `mkdir -p <worksDir>/<slug>`, render the PRD from the state object per [prd-format.md](references/prd-format.md), Write it, delete the `.wip.json`.

## Step transitions

| Step | Enters when | Passes when |
|---|---|---|
| 1 → 1.5 | feature info received | summary confirmed |
| 1.5 → 2 | required slots settled | |
| 2 → 2.5 | any interface material given | confirmed (skipped on None/Pass) |
| 2.5 → 3 | interface step done | |
| 3 → 3.5 | scenario material given | confirmed (skipped on None/Pass) |
| 3.5 → 4 | scenario step done | |
| 4 → 4.5 | design material given | confirmed (skipped on Pass) |
| 4.5 → 6 | design step done | |
| 6 | queue settled | path confirmed, file written |

Minimum path: 2 rounds (Step 1 → 1.5 → all Pass → 6). Typical: 7–9 rounds.

## Handoff

After saving, print:

```
✅ PRD saved: <path>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Next — extract test cases
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
/dev-pipeline:tc-extract <path>

→ Analyses the code behind the PRD and extracts test cases.
→ Output: <worksDir>/<slug>/tc.md
```

## Text rules for every AskUserQuestion

- no unreplaced `[...]` variables, no truncated descriptions
- labels are plain language; put code, selectors, and paths in the description
- options in one question share one grammatical form; `(Recommended)` on at most one
