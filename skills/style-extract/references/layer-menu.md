# Layer menu

Starting set for a project's layer catalog (`<style.layersDir>/catalog.json`). A layer is a place where code is written the same way for the same reason. Keep the ids below when a layer fits, so style files stay comparable across projects. Drop layers the project does not have; split or add one only when a group of files clearly works differently.

| id | Name | What lives here | Common path signals |
|---|---|---|---|
| `ui` | UI (view) | Components, templates, markup, styles, view-only focus or interaction glue | `components/`, `pages/`, `views/`, `layouts/`, `*.vue`, `*.jsx`, `*.svelte`, `styles/` |
| `motion` | Motion and media | Animation, canvas/WebGL, video and audio players | `animation/`, `three/`, `player/`; imports of `gsap`, `three`, `lottie`, `hls.js` |
| `viewmodel` | State and logic (view model) | Stores, hooks/composables, derived values, lifecycle-bound listeners | `store/`, `stores/`, `state/`, `composables/`, `hooks/` |
| `controller` | Controller | Flows that span screens: routing decisions, landing, playback or purchase orchestration | `controller/`, `flows/`, route guards, middleware on the client |
| `data-access` | Data access (model) | HTTP clients, API wrappers, request/response mapping, client caches | `api/`, `services/`, `network/`, `repositories/` |
| `platform` | Platform bridge | Messages to a native shell, device or SDK interfaces, global key input | `bridge/`, `native/`, `sdk/`, device adapters |
| `app-base` | App base | Framework extensions: plugins, modules, base components, app bootstrapping, build config | `plugins/`, `modules/`, `boot/`, framework config files |
| `observability` | Observability | Logging, metrics, error reporting, analytics events | `logger/`, `log/`, `analytics/`, `monitoring/` |
| `server` | Server | Backend or BFF routes, server middleware, server-side caching | `server/`, `api/` under a server root, `routes/` |
| `shared` | Shared and pure | Stateless helpers, constants, config shared by client and server | `shared/`, `utils/` without state, `constants/`, `config/` |

## catalog.json

```json
{
  "excluded": ["**/*.test.*", "**/*.spec.*", "**/*.md", "<mock dirs>", "<generated dirs>"],
  "layers": [
    { "id": "ui", "name": "UI (view)", "doc": "ui.md", "paths": ["src/components/**"] },
    { "id": "motion", "name": "Motion and media", "doc": "motion.md", "paths": ["src/animation/**"], "imports": ["^(gsap|three)(/|$)"] },
    { "id": "viewmodel", "name": "State and logic", "doc": "viewmodel.md", "paths": ["src/store/**"], "exclude": ["src/store/legacy/**"] }
  ]
}
```

- `paths` / `exclude` / `excluded` are globs (`path.matchesGlob`). `exclude` removes files from one layer only; `excluded` removes them from every layer and from the `--check` count.
- `imports` are regexes on import specifiers. A file joins the layer when it imports a match, wherever it lives. Use it for cross-cutting concerns like animation libraries.
- A file may belong to two layers. Prefer moving it with `exclude` when it plainly belongs to one.
- Put tests, docs, mocks, fixtures, generated output and tooling scripts in `excluded`, or `--check` reports them as unmapped.

## Layer doc (`<id>.md`)

Two sections, both required by `resolve-layer --check`:

```markdown
# <Name>

<One paragraph: what this layer is in this project, with real paths.>

## Fixed
- Boundary: what is done here and what goes to which other layer.
- Tests: how this layer is tested in this project, a reference test file, which test project runs it.
- Project rules that bind this layer (section names in the project's rule file).

## Methodology
- How code here is actually written today, each line with a count or an example path as evidence.
  e.g. "Stores use the options syntax (42 files, setup syntax 0). Evidence: src/store/cart.js"
- Where the code disagrees with itself, say so instead of picking a winner.
```

`Fixed` is what any developer must respect here. `Methodology` describes the project's current habits, not one person's taste; personal taste goes in style files.
