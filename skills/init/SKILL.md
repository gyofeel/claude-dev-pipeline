---
name: init
description: Use when a project has no `.agents/pipeline.config.json` yet, when another dev-pipeline skill stops with "config missing", when the user wants to change project facts the pipeline relies on (test command, spec directory, state bridge, interaction mode, language), or when the user is unsure what to do next or wants to resume work — init is the hub that shows the settings and offers the next step.
---

# init — create or update the pipeline config

Every other skill in this plugin reads `.agents/pipeline.config.json` and refuses to guess paths or commands. This skill writes that file: it auto-detects what a repository reveals, asks only about things a repository cannot reveal, validates, installs the E2E kit when the project uses Playwright, and ends with one question about what to do next. Run again with a config in place, it is the hub: it shows the settings and asks what to do next (new feature, verify, resume, change settings). The user never has to type a follow-up command.

Schema and every key: [config-schema.md](../../references/config-schema.md). Read it before writing the file.

**Talking to the user.** From Step 0 on, every message and question is in the chosen `language` and follows "User-facing output" in [shared-contract.md](../auto-e2e-pipeline/references/shared-contract.md). Korean copy quoted below is used as written; the English text of the other questions is the meaning to convey, said in natural words. Each option description tells the user what changes for them, so they can judge the choice without knowing the config.

## Step 0 — Language (before anything else is printed)

```bash
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
node -e "try { const c = require(process.argv[1]); console.log(c.language ?? c.e2e?.report?.locale ?? '') } catch { console.log('') }" "$ROOT/.agents/pipeline.config.json"
```

Prints `en` / `ko` → that is `language`; do not ask. Empty → ask exactly one `AskUserQuestion` with this one question and nothing else, in both languages because none is known yet:

**Question**: "Which language should the pipeline use with you? / 파이프라인이 어떤 언어로 안내할까요?"
- header: `Language`
- options:
  - `English` — "Questions, guidance and the E2E report in English. Document headings default to English too."
  - `한국어` — "질문, 안내, E2E 리포트를 한국어로 보여 줍니다. 문서 제목도 기본은 한국어입니다."

The answer is written as `language` (`en` / `ko`).

## Step 1 — Existing config: the hub

```bash
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
ls "$ROOT/.agents/pipeline.config.json" 2>/dev/null && echo CONFIG_EXISTS || echo CONFIG_MISSING
```

`CONFIG_MISSING` → Step 2.

`CONFIG_EXISTS` → init is the hub the user comes back to, first time or stuck. Validate first:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config-load.mjs" --check && node "${CLAUDE_PLUGIN_ROOT}/scripts/config-load.mjs"
```

Go to **Change settings** below instead of the hub when `--check` fails (show `errors[]` first), when the raw config has no `language` key (a 0.3 config: Step 0 asked the language, or took it from a leftover `e2e.report.locale`; update mode writes it as `language`), or when the invocation asks to change something (any argument or request naming a setting). Otherwise show the hub and re-ask no setup question:

1. The Step 7 summary block, with the first line `init — current settings (.agents/pipeline.config.json)` and `warnings[]` below it.
2. **Kit and run facts** (Step 6 and Step 7 use the same block):
   ```bash
   ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
   P=$(cat "${CLAUDE_PLUGIN_ROOT}/kit/VERSION"); K=$(cat "$ROOT/<e2e.kitDir>/VERSION" 2>/dev/null)
   if [ -z "$K" ]; then node -e "try { const p = require(process.argv[1]); console.log((p.devDependencies?.['@playwright/test'] || p.dependencies?.['@playwright/test']) ? 'NO_KIT_PLAYWRIGHT' : 'NO_KIT') } catch { console.log('NO_KIT') }" "$ROOT/package.json"
   elif [ "$K" = "$P" ]; then echo KIT_CURRENT
   elif [ "$(printf '%s\n%s\n' "$K" "$P" | sort -V | tail -1)" = "$P" ]; then echo "KIT_OLDER $K → $P"
   else echo "KIT_NEWER $K > $P"; fi
   node -e "const fs = require('fs'), w = process.argv[1]; for (const d of fs.existsSync(w) ? fs.readdirSync(w) : []) { try { const s = JSON.parse(fs.readFileSync(w + '/' + d + '/state.json', 'utf8')); if (s.next) console.log(s.pipeline, s.slug, s.next); } catch {} }" "$ROOT/<worksDir>"
   ```
   The first line is the kit state: `NO_KIT_PLAYWRIGHT` (no kit, but `@playwright/test` is in package.json), `NO_KIT`, `KIT_CURRENT`, `KIT_OLDER old → new`, `KIT_NEWER kit > plugin`. Then one line per run in progress: `<pipeline> <slug> <next stage>`.
   `KIT_NEWER` → no kit option; add one line to the summary: "프로젝트의 E2E 키트(<kit>)가 플러그인(<plugin>)보다 새 버전입니다. 플러그인을 업데이트해야 E2E 테스트를 만들 수 있습니다." / "The project's E2E kit (<kit>) is newer than the plugin (<plugin>). Update the plugin before generating E2E tests."
3. One `AskUserQuestion`, in `language` (2–4 options; header `다음 단계` / `Next`):

**Question**: "무엇을 할까요?" / "What would you like to do?"
- Kit option, first, at most one of:
  - on `KIT_OLDER`: `키트 업그레이드 (추천)` / `Upgrade the E2E kit (Recommended)` — "프로젝트의 E2E 키트(<old>)가 플러그인(<new>)보다 오래되어, 바꾸기 전에는 E2E 테스트를 만들 수 없습니다. 어댑터와 Playwright 설정은 그대로 둡니다." / "The project's E2E kit (<old>) is older than the plugin (<new>), so E2E tests cannot be generated until it is replaced. Your adapter and Playwright config stay as they are."
  - on `NO_KIT_PLAYWRIGHT`: `E2E 키트 설치 (추천)` / `Install the E2E kit (Recommended)` — "Playwright는 있지만 E2E 키트가 없어, 지금은 E2E 테스트를 만들 수 없습니다. 키트를 복사하고 어댑터와 필요한 폴더를 만듭니다. 기존 Playwright 설정은 고치지 않습니다." / "Playwright is installed but the E2E kit is not, so E2E tests cannot be generated yet. This copies the kit and creates the adapter and folders. An existing Playwright config is not edited."
- `새 기능 개발` / `Build a new feature` — same description as in Step 7.
- `이미 만든 기능 검증` / `Verify an existing feature` — same description as in Step 7.
- `진행 중인 작업 이어 가기` / `Resume work in progress` — only when a run is in progress: "멈춘 단계부터 이어서 진행합니다: <slug — 다음 단계 목록>" / "Picks up where it stopped: <slug — next stage list>"
- `설정 바꾸기` / `Change settings` — "설정 질문으로 돌아갑니다. 지금 값은 그대로 두고 고칠 것만 고르거나, 처음부터 다시 만들 수 있습니다." / "Back to the setup questions. Keep your values and fix only what you need, or start over."

At most four fit. Five apply only when a kit option and a run in progress both exist. Then leave out `설정 바꾸기`: the kit and resume options come from the current state and are what the user most likely needs now. Say on the summary's last line that settings stay reachable: "설정을 바꾸려면 아래 질문에서 직접 입력(Other)에 '설정 바꾸기'라고 적으세요." / "To change settings, type 'change settings' as the Other answer below." Treat that answer as `설정 바꾸기`.

Act on the answer in this session:
- upgrade → `Skill: dev-pipeline:e2e-init --upgrade` (it shows the diff and asks before replacing), then this hub question again without the kit option.
- install → if `commands.e2eRun` is null, set it to the Step 2 detection value (`npx playwright test`) and re-run `--check`; then `Skill: dev-pipeline:e2e-init --from-init`, then this hub question again without the kit option.
- new feature / existing feature → as in Step 7 (ask for the feature first, then start a new run).
- resume → the router named in the state file, with no argument: `Skill: dev-pipeline:<pipeline>`; it lists its runs when there are several. Runs of both pipelines in progress → one `AskUserQuestion` to pick the run, then that run's router with its slug.
- change settings → **Change settings**.

**Change settings** → `AskUserQuestion`:

**Question**: "설정 파일이 이미 있습니다. 어떻게 할까요?" / "A pipeline config already exists. What should happen to it?"
- header: `기존 설정` / `Existing config`
- options:
  - `지금 값 유지하고 고치기` / `Update — keep my values` — "직접 정한 값은 그대로 두고, 빠졌거나 새로 감지한 값만 채웁니다." / "Values you set stay as they are; only missing or newly detected values are filled in." (merge: user-set keys win, detection fills gaps)
  - `처음부터 다시` / `Start over` — "파일을 새로 씁니다. 이전 파일은 `pipeline.config.json.bak`으로 남겨 둡니다." / "The file is written again from scratch. The old one is kept as `pipeline.config.json.bak`." (copy it first)
  - `취소` / `Cancel` — "설정 파일을 바꾸지 않습니다." / "The config file stays as it is."

`Cancel` → nothing is written, and the session stays in the language chosen in Step 0. Config valid → back to the hub question. Config invalid → end with the `--check` errors; the one next action is fixing them.

Otherwise Step 2 onward.

## Step 2 — Auto-detect (no questions)

Read `package.json`, lockfiles, and the directory tree. Collect these; note the evidence for each so Step 4 can show it.

| Key | Detection |
|---|---|
| package manager | `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `bun.lockb` → bun, else npm |
| `unitTest.runner` | `vitest` in deps → vitest; `jest` → jest; neither → ask in Step 4 |
| `commands.unitTest` | first `scripts.*` whose value contains the runner **and** (`run` or `--run` or `--watch=false` or `ci`); else `npx vitest run` / `npx jest`. If every runner script is watch-mode, keep the fallback and flag it |
| `commands.unitTestList` | vitest → `npx vitest list --filesOnly` when vitest ≥ 3; else null |
| `commands.format` / `commands.lint` | `prettier` in deps → `npx prettier --write`; `eslint` in deps → `npx eslint --fix` |
| `commands.dev` | `scripts.dev` if present |
| `commands.e2eRun` | `@playwright/test` in deps → `npx playwright test`; else null with a note. Update mode detects a null value again (Playwright may have been installed since) |
| `ui.framework` | vue/nuxt → vue; react/next/remix → react; svelte/@sveltejs → svelte; @angular/core → angular; else other |
| `ui.pagesDir` | first existing of `app/pages`, `src/pages`, `pages`, `src/app`, `src/routes`, `src/views`, `app/routes` |
| `ui.componentsDir` | first existing of `app/components`, `src/components`, `components` |
| `ui.stateStoreDir` | first existing of `app/store`, `app/stores`, `src/store`, `src/stores`, `store`, `stores` |
| `ui.testIdAttribute` | grep the pages/components dirs for `data-testid`, `data-test`, `data-cy`; take the most frequent, default `data-testid` |
| `e2e.specsDir` | existing `playwright.config.*` → its `testDir`; else `e2e/specs` |
| `e2e.resultsJson` | from the json reporter in `playwright.config.*` if present; else `e2e/reports/results.json` |
| `e2e.baseUrl` | `use.baseURL` in `playwright.config.*`; else `http://localhost:3000` |
| `unitTest.testFileGlobs` | from the runner config `include`/`testMatch` if readable; else the schema default |
| `source.roots` | every existing top-level directory among `src`, `app`, `lib`, `server`, `shared`, `components`, `pages`, `store`, `stores`, `modules`, `packages` (none → keep the default `["src"]` and flag it: field-consumers and flag-effects, and the coverage-gate checks built on them, report "no targets" when no root exists) |
| `source.aliases` | not written: read from tsconfig/jsconfig `compilerOptions.paths` at run time. Flag it when the root tsconfig only `extends` a generated file (Nuxt `.nuxt/tsconfig.json`) or no tsconfig/jsconfig exists — the user then sets it by hand (Nuxt: `{ "~/": "app/", "@/": "" }`) |

Do not read the runner config files by executing them; grep for the keys.

**Optional, not detected** — written only when the user sets them (update mode keeps existing values). They tune `scripts/surface-gate.mjs`:

| Key | Meaning | Default |
|---|---|---|
| `surfaceGate.autoEntryPaths` | repo-relative path prefixes the framework registers by location (e.g. `app/pages/`, `server/api/`) — new files there count as reachable without an import | `[]` |
| `surfaceGate.specPaths` | where existing specs and their helpers live; vanished tokens are searched here | `e2e.specsDir`, `e2e.fixturesDir`, `e2e.kitDir` |
| `surfaceGate.nonProductionPaths` | extra path prefixes excluded from "production" (tooling, docs, scripts) on top of test files and `specPaths` | `[]` |

## Step 3 — Document-heading language (`locale`)

`locale` sets the headings of PRD, TC and plan files and the labels the checks look for. It follows `language` unless the existing documents say otherwise. Ask only when they do.

Skip this step when the existing config (update mode) sets `locale` itself. Otherwise read the headings of existing artifacts with both locales' labels from `kit/artifact-labels.mjs` (`<worksDir>`: the existing config's, else `.agents/works`):

```bash
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$ROOT" && LABELS="${CLAUDE_PLUGIN_ROOT}/kit/artifact-labels.mjs" WORKS=<worksDir> node --input-type=module -e "
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { ARTIFACT_LABELS } = await import(pathToFileURL(process.env.LABELS).href);
const works = process.env.WORKS, found = { en: 0, ko: 0 };
for (const dir of existsSync(works) ? readdirSync(works) : []) {
    for (const [file, key, mark] of [['prd.md', 'prd.acHeading', '## '], ['tc.md', 'tc.relatedAc', '**']]) {
        const p = works + '/' + dir + '/' + file;
        if (!existsSync(p)) continue;
        const text = readFileSync(p, 'utf8');
        for (const loc of ['en', 'ko']) if (text.includes(mark + ARTIFACT_LABELS[loc][key])) found[loc]++;
    }
}
console.log(JSON.stringify(found));
"
```

It prints how many `prd.md` / `tc.md` files use each locale's headings, e.g. `{"en":3,"ko":0}`.

- The other locale's count is not greater than `language`'s (including no artifacts at all) → do not ask. `locale` = `language`, and say one line:
  - ko: "문서(PRD·TC) 제목도 한국어로 씁니다. 나중에 바꾸려면 설정 파일의 locale 값을 바꾸면 됩니다."
  - en: "Document (PRD/TC) headings will be in English too. Change `locale` in the config later if you need another language."
- The other locale's count is greater → add this question to Round 1 below, in `language`.

`language` ko, existing documents English:

**Question**: "기존 PRD·TC 문서의 제목이 영어로 되어 있습니다. 앞으로 만들 문서의 제목은 어떤 언어로 쓸까요?"
- header: `문서 제목`
- options:
  - `영어 — 기존 문서와 같게 (추천)` — "기존 PRD·TC를 고치지 않고 그대로 검사하고 이어서 쓸 수 있습니다. 대화와 E2E 리포트는 계속 한국어입니다." → `locale: "en"`
  - `한국어` — "새 문서의 제목과 항목 이름이 한국어로 바뀝니다. 기존 영어 문서는 검사에서 제목과 항목을 찾지 못해 막히므로, 계속 쓰려면 제목·항목 이름·고정 값(예: e2e → E2E 가능)까지 한국어로 고쳐야 합니다." → `locale: "ko"`

`language` en, existing documents Korean:

**Question**: "Your existing PRD and TC documents have Korean headings. Which language should new document headings use?"
- header: `Headings`
- options:
  - `Korean — same as existing documents (Recommended)` — "Existing PRDs and TCs keep passing the checks without edits, and you can keep working on them. Conversation and the E2E report stay in English." → `locale: "ko"`
  - `English` — "Headings and field names of new documents switch to English. The checks can no longer find the headings and fields of the existing Korean documents and stop; to keep using them, change their headings, field names and fixed values (e.g. E2E 가능 → e2e) to English." → `locale: "en"`

## Step 4 — Show detection, ask the rest

Print the detected values as one grouped block (commands / unit tests / ui / e2e), each line with its evidence in parentheses. Then ask, in at most two `AskUserQuestion` rounds, only the items below. Skip a question when the existing config (update mode) already answers it.

**Round 1**

**Question**: "테스트에서 앱을 어떻게 조작하나요?" / "How does a user operate this app in tests?"
- header: `조작 방식` / `Interaction`
- options:
  - `포인터 — 클릭, 입력, 탭 (추천)` / `Pointer — click, type, tap (Recommended)` — "사람이 마우스나 터치로 하듯 테스트가 누르고 입력합니다. 대부분의 웹앱은 코드를 따로 쓰지 않아도 됩니다." / "Tests click and type the way a person does with a mouse or touch. Works for most web apps with no extra code." (generated specs use Playwright locators and `click()`)
  - `키보드만 — 방향키, Enter` / `Keyboard only — arrow keys, Enter` — "TV나 키오스크처럼 방향키로 움직이는 앱에 맞습니다. 이 방식의 테스트를 돌리기 전에, 목표 위치로 이동하는 함수 하나를 어댑터 파일에 써야 합니다. 쓰는 법은 플러그인 예제에 있습니다." / "For apps driven by arrow keys, like a TV or a kiosk. Before such tests can run, you write one function in the adapter file that moves to a target; the plugin's examples show how." (the project adapter must implement `findAndEnter`)

**Question**: "테스트가 페이지에서 앱 상태를 읽을 수 있나요?" / "Can tests read the app's state from the page?"
- header: `앱 상태` / `State bridge`
- options:
  - `아니요 — 화면과 콘솔만 확인 (추천)` / `No — DOM and runtime checks only (Recommended)` — "테스트가 화면에 보이는 것과 콘솔만 확인합니다. 따로 준비할 것이 없습니다." / "Tests check what is on the screen and in the console. Nothing to set up." (the State checkpoint type stays off)
  - `예 — 읽는 식을 입력하겠습니다` / `Yes — I will enter the expression` — "스토어 값처럼 앱 안의 값까지 확인합니다. 페이지에서 그 값을 읽는 식 하나(예: `window.__APP_STATE__`)를 다음에 입력합니다." / "Tests can also check values inside the app, such as a store. You type one expression that reads them in the page, like `window.__APP_STATE__`; the next prompt asks for it."

If `unitTest.runner` was not detected, add this question to the round:

**Question**: "단위 테스트는 무엇으로 돌리나요?" / "Which unit test runner does this project use?"
- header: `단위 테스트` / `Unit tests`
- options:
  - `Vitest` — "Vitest로 단위 테스트를 돌립니다." / "Unit tests run with Vitest."
  - `Jest` — "Jest로 단위 테스트를 돌립니다." / "Unit tests run with Jest."
  - `단위 테스트 없음` / `No unit tests` — "실행기를 정할 때까지 테스트를 먼저 쓰고 구현하는 단계는 쓸 수 없습니다." / "The test-first implementation step cannot run until a runner is set." (`commands.unitTest` becomes null and config-load warns)

Add Step 3's heading question here when it is needed. One call takes at most four questions.

E2E verdicts are rule-based, so there is no AI provider to choose. In update mode, delete a leftover `e2e.ai` key, move a leftover `e2e.report.locale` to `language` (Step 0 read it), and say so in one line.

**Round 2**

**Question**: "구현할 때 그대로 지켜야 하는 프로젝트 코딩 규칙은 어디에 있나요?" / "Where do the project coding rules live that implementers must follow verbatim?"
- header: `코딩 규칙` / `Constraints`
- options:
  - `CLAUDE.md나 AGENTS.md에서 뽑기 (추천)` / `Derive from CLAUDE.md or AGENTS.md (Recommended)` — "기존 규칙 파일을 읽어 짧은 목록을 제안하고, 쓰기 전에 확인을 받습니다." / "I read your existing rule files and propose a short list. You confirm it before anyone uses it."
  - `파일을 직접 지정` / `A file I will name` — "구현할 때 그 파일을 글자 그대로 따릅니다. 경로는 다음에 입력합니다." / "Implementers follow that file word for word. You enter the path next."
  - `없음` / `None` — "구현할 때 계획서와 주변 코드만 따릅니다." / "Implementers follow only the plan and the code around them."

**Question**: "테스트 환경에서 재현할 수 없는 상태가 있나요?" / "Are there states the test environment can never reach, so checks on them should not fail the test?"
- header: `재현 불가` / `Soft-track`
- options:
  - `없음 (추천)` / `No (Recommended)` — "검사 하나가 실패하면 그 테스트가 실패합니다." / "Every failed check fails its test."
  - `있음 — 설명하겠습니다` / `Yes — I will describe them` — "실제 기기에만 있는 기능 같은 경우입니다. 그 상태를 보는 검사는 결과를 기록하고 다시 확인할 항목으로 보여 주지만, 테스트를 실패로 만들지 않습니다. 조건식과 패턴 단어를 다음에 입력합니다." / "For things only a real device has, for example. Those checks are still recorded and shown for a recheck, but they do not fail the test. You describe them next (a guard expression and pattern words)."

**Question**: "단위 테스트와 영향 범위 검사가 살펴볼 소스 폴더는 어디인가요?" / "Which directories hold the source code that unit-test and impact checks scan?"
- header: `소스 폴더` / `Source roots`
- options:
  - `<감지한 목록, 예: app, server, shared> (추천)` / `<detected list, e.g. app, server, shared> (Recommended)` — "아무도 부르지 않는 코드나 변경이 미치는 범위를 찾는 검사가 이 폴더만 봅니다. 빠진 폴더는 검사하지 않습니다." / "The checks that find code nothing calls, or what a change affects, look only in these folders. A folder left out is never checked." (written as `source.roots`)
  - `직접 적기` / `Other — I will list them` — "저장소 루트 기준 폴더 이름을 다음에 입력합니다." / "You type the folder names next (relative to the repository root)."

With no candidate, the first option is `src (기본값 — 아직 없는 폴더)` / `src (default — no such directory yet)`: "아직 없는 폴더라서, 폴더가 생길 때까지 이 검사들은 검사할 대상이 없다고 알립니다." / "No such folder yet, so those checks report that they found nothing to check until it exists."

**Question**: "구현 검토 때 늘 따로 승인을 받아야 하는 코드 변경이 있나요?" / "Are there code changes that always need explicit approval during implementation review?"
- header: `승인 항목` / `Approval gates`
- options:
  - `없음 (추천)` / `No (Recommended)` — "구현 검토에서 기본 질문만 합니다." / "Implementation review asks only its standard questions."
  - `있음 — 목록을 적겠습니다` / `Yes — I will list them` — "새 의존성 추가처럼 지정한 변경은 언제나 승인을 기다립니다. 항목마다 이름과 확인용 셸 명령을 다음에 입력합니다." / "Changes you name, such as a new dependency, always wait for your approval. You give a name and a shell check for each next."

For every `있음` / `예` / `Yes — …` answer, ask for the value as plain text in the next turn.

## Step 5 — Write and validate

1. Build the object: `"$schema": "dev-pipeline/1"` first, then `language` and `locale`, then only keys that differ from schema defaults plus every key the user answered. Keep the file short.
2. Create the directory and write `pipeline.config.json` (2-space indent):
   ```bash
   ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd); mkdir -p "$ROOT/.agents"
   ```
3. Validate:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/config-load.mjs" --check
   ```
   On errors, fix and re-run. Do not print a success message while `--check` fails.
4. `.gitignore` — append these lines if absent (idempotent grep first):
   ```
   <worksDir>/**/state.json
   .superpowers/
   ```

## Step 6 — E2E kit

Run the Kit and run facts block (Step 1) and act on the kit state:
- `NO_KIT_PLAYWRIGHT`, or `NO_KIT` with `commands.e2eRun` set by hand → run the e2e-init skill now, in this session: `Skill: dev-pipeline:e2e-init --from-init`. It keeps its own safety checks (kit directory check, collision table, never overwriting the adapter or an existing Playwright config) and reports the dependencies. If it stops on an error, end init with that error's one next action instead of Step 7's question.
- `KIT_CURRENT` → skip it; the summary says the kit is current.
- `KIT_OLDER` → skip it here; Step 7's question offers the upgrade.
- `KIT_NEWER` → skip it; the summary carries the plugin-update line from Step 1.
- `NO_KIT` and `commands.e2eRun` null → skip it. Say one plain line: Playwright was not found, so E2E setup is skipped; after installing it, running init again offers the E2E kit install from its hub.

## Step 7 — Summary and the next step

The summary, in `language`:

```
init — config saved (.agents/pipeline.config.json)
  Conversation and report: <language in words> / Document headings: <locale in words>
  unit: <runner> · <commands.unitTest> · source <source.roots>
  ui:   <framework> · pages <dir> · state bridge <yes/no>
  e2e:  <interaction> · specs <dir> · kit <installed vN | current vN | older vN | skipped>
```

The language line in Korean reads, e.g., "대화·리포트: 한국어 / 문서 제목: 영어".

Then one `AskUserQuestion`, in `language`:

**Question**: "설정을 마쳤습니다. 이제 무엇을 할까요?" / "Setup is done. What would you like to do next?"
- header: `다음 단계` / `Next`
- options:
  - on `KIT_OLDER` only, first: the hub's `키트 업그레이드 (추천)` / `Upgrade the E2E kit (Recommended)` option, same copy and action (then this question again without it)
  - `새 기능 개발` / `Build a new feature` — "아직 코드가 없는 기능을 요구사항 정리부터 테스트, 구현, 화면 검증까지 한 단계씩 진행합니다." / "For a feature with no code yet: from requirements to tests, code and screen checks, one step at a time."
  - `이미 만든 기능 검증` / `Verify an existing feature` — "이미 만든 기능의 요구사항을 정리하고 E2E 테스트를 돌려 확인합니다." / "For a feature that is already built: organize its requirements and check it with E2E tests that run."
  - `나중에` / `Later` — "설정만 마칩니다. 돌아올 때 쓸 명령 하나를 알려 드립니다." / "Finish setup only. You get the one command to come back with."

Act on the answer in this session:
- new feature / existing feature → always a **new** run, even when a run of that pipeline is in progress (resuming is the hub's `진행 중인 작업 이어 가기`). First ask one plain-text question, in `language`: "어떤 기능인가요? 기능 이름이나 한두 문장 설명을 적어 주세요. 일감 번호가 있으면 함께 적어 주세요." / "Which feature is it? Give its name or a sentence or two, plus the issue key if there is one." Then call the router with the answer as its argument: `Skill: dev-pipeline:auto-dev-pipeline <answer>` (new feature) or `Skill: dev-pipeline:auto-e2e-pipeline <answer>` (existing feature). The router reads text that is not a path or a resume target as the feature description (its Arguments and Routing). An answer that is only a path, a slug, or an issue key that already has a run under `<worksDir>` would resume or import that instead: say so and ask for a description.
- later → one line ("언제든 이 명령으로 돌아오면 다음 할 일을 고를 수 있습니다." / "Come back with this command any time to pick what to do next.") and `/dev-pipeline:init` alone in a code block.

## Rules

- Never run install commands. Print them.
- Never overwrite without the Change settings answer (Step 1); in update mode, keys the user set by hand win over detection.
- Before every `AskUserQuestion`, re-read labels and descriptions: in `language`, no `[...]` placeholders, no truncated sentences, labels in plain words, `(Recommended)` (`ko`: `(추천)`) on at most one option per question. Korean: proofread particles, spacing and typos; write it literally, never as `\uXXXX` escapes.
