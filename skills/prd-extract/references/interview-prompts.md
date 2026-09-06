# Interview prompt texts and summary templates

Referenced from SKILL.md. Print the follow-up text after the user picks an option; use the summary templates in the `description` of the `.5` confirmation rounds.

## Step 1 — feature information

**After `Paste a ticket`:**

> Paste the ticket body (requirements, acceptance criteria, notes). I will extract:
> - scope and requirement list
> - acceptance criteria — derived from requirements if none are explicit
> - exception cases
> - related screens and APIs

**After `Describe it`:**

> Describe the feature and its scope. Including these makes the PRD more accurate:
> - feature name (e.g. "catalog list filter")
> - target screen (e.g. "Catalog page > filter panel")
> - what is new or changed
> - acceptance criteria, if you have them

**After `Use what I already told you`:** parse the conversation and go straight to Step 1.5.

## Step 1.5 — feature summary template

```
📋 Feature as understood:

⚠️ Needs confirmation now (blocks a required slot, or only you can answer):
- <slot>: <value> inferred — <basis>
- <slot>: unclear — <why>

⏸ Pending: N — re-checked after server spec / platform spec / Figma arrive

✓ Confirmed slots (reference):
- Feature: <name> stated
- Target screen: <screen> stated
- Requirements: 1. … / 2. …
- Acceptance criteria: AC-01 … / AC-02 …
- Exceptions: <list or none>
- Related APIs: <list or none>
```

Omit the "Needs confirmation now" block when empty.

## Step 2 — external interfaces

**After `Yes — paste it` (server API):**

> Paste the server API spec (endpoints, request/response shapes, error codes). Helpful details:
> - endpoint and method (e.g. `GET /api/catalog/items`)
> - request parameters (required / optional)
> - response fields with an example
> - error codes (e.g. `E401: unauthorized`)
> - boundary cases — pagination, empty list

**After `Yes — paste it` (platform bridge):**

> Paste the <label> interface spec (events, callbacks, parameters). Helpful details:
> - event/callback names and when they fire
> - data handed to the web app (JSON example)
> - platform differences, if any
> - whether it can be simulated in E2E (`page.evaluate` mock) or needs a real device

**After `Yes — attach a file`:** read the file with Read.

**What to extract from server material:** new/changed endpoints + methods; request params and response fields (required ones); error codes and their response shape; endpoints to mock as fixtures (`**/api/<path>` pattern); boundary cases.

**What to extract from platform material:** new/changed events and callbacks; host-specific behaviour (hardware keys, platform APIs); data format and timing host → app; platform differences; how E2E will simulate each event.

## Step 2.5 — interface summary template

```
🔌 Server interface:
- Endpoints:
  - <METHOD> <path> — <role>
- Fixtures to mock:
  - **/api/<path> → <file>.json (✅ exists / 🆕 needed)
- Error cases:
  - <code>: <description>
- Boundary cases:
  - <empty list, max values …>

📡 <label> interface:                  ← only when collected
- Mechanism: <bridge object / postMessage / SDK>
- Events / callbacks:
  - <name>: <params> → <app behaviour>
- E2E simulation:
  - <name>: mockable (page.evaluate) / manual review (real device)
- Platform differences: <yes/no>
```

## Step 3 — UI scenarios

**After `Figma URL` or `Both`:**

> Enter the Figma URL for the UI scenarios. If the Figma MCP is unavailable I will fall back to screenshots or a page fetch.

**After `Screenshots` or `Both`:**

> Attach the scenario screens in your next message (several allowed).

**Subagent goals (general-purpose):**
- screen state list (normal, loading, empty, error, edge)
- entry condition and a plausible interaction sequence for each state
- elements that must be visible in each state
- transition triggers (user action, API response, timer)
- when the Figma MCP is unavailable: WebFetch the URL, or analyse screenshots

## Step 3.5 — UI scenario summary template

```
🖼️ UI scenarios:
- Screen states:
  - <state>: <entry condition> → <visible elements>
- Interaction sequences (inferred):
  - <scenario>: <url> → <steps>
- Error / edge screens:
  - <case>: <condition> → <shown>
- Needs confirmation: <unclear items>
```

## Step 4 — design guide

**After `Figma URL`:**

> Enter the Figma URL for the design guide.

**After `Screenshots`:**

> Attach the design guide images (per-state component images help).

**Subagent goals (general-purpose):**
- component names and their likely hooks, in `ui.selectorPriority` order (`data-testid` first, then id, stable class, text)
- visual differences per state (default / focus or hover / disabled / loading / error)
- responsive or fixed-viewport notes
- items that need manual visual review (pixel comparison, animation timing)

## Step 4.5 — design summary template

```
🎨 Design guide:
- Components:
  - <component>: hook <descriptor>, states <default/focus/disabled>
- Selector hints:
  - <hook>: <meaning>
- Manual review items:
  - <item>: <reason>
```
