import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { labelsFor } from '../../kit/artifact-labels.mjs';

const gate = path.join(import.meta.dirname, '../../scripts/coverage-gate.mjs');
const LOCALES = ['ko', 'en'];

// A repo root with a pipeline config; the gate reads locale and source.roots from it
const project = (locale, files = {}, roots = ['.']) => {
    const root = mkdtempSync(path.join(tmpdir(), 'coverage-gate-'));
    const all = {
        '.agents/pipeline.config.json': JSON.stringify({ locale, source: { roots } }),
        ...files
    };
    for (const [rel, text] of Object.entries(all)) {
        mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        writeFileSync(path.join(root, rel), text);
    }
    return root;
};
const write = (root, rel, text) => {
    const p = path.join(root, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, text);
    return p;
};
const run = (root, ...args) =>
    JSON.parse(execFileSync('node', [gate, ...args], { cwd: root, encoding: 'utf8' }));

// ko PRDs carry the full ORIG heading; matching is by prefix
const acHeading = (L) =>
    L === labelsFor('ko') ? `${L['prd.acHeading']} (Acceptance Criteria)` : L['prd.acHeading'];

const prdText = (L) => `# Feature PRD

> **${L['prd.scope']}**: Home > Block

## ${acHeading(L)}

- [ ] **AC-01**: filter works
- [ ] **AC-02**: shows the remaining count

## ${L['prd.serverInterface']}

### ${L['prd.endpoints']}

| Method | Path | Role | Source |
|--------|------|------|--------|
| GET | /api/a | read | — |

### ${L['prd.specCrossCheck']}

| I/F ID | Method · path | Requirement | Handling |
|--------|---------------|-------------|----------|
| IF-001 | GET /api/a | Requirement 1 | — |
| IF-002 | GET /api/b | — | — |
`;

const tcRow = (L, id, ac, unit, e2e, reason) => `### TC-${id}: name

#### ${L['tc.metadata']}

| Field | Value |
|------|-----|
| **${L['tc.relatedAc']}** | ${ac} |
| **${L['tc.field.e2eSuitability']}** | ${e2e} |
| **${L['tc.e2eBasis']}** | ${reason} |
| **${L['tc.field.unitTarget']}** | ${unit} |

---
`;

const tcText = (L, extra = '') => `# Feature ${L['tc.titleSuffix']}

> **${L['tc.implMode']}**: ${L['tc.implMode.new']}

${tcRow(L, '01', 'AC-01', 'src/filter.test.js', L['tc.e2eFit.manual'], '—')}
${tcRow(L, '02', 'AC-02', L['tc.unitNone'], L['tc.e2eFit.e2e'], 'render')}
${tcRow(L, '03', 'AC-02', L['tc.unitNone'], L['tc.e2eFit.e2e'], '—')}
${extra}`;

const owners = (L) => `## ${L['tc.owner']}

| TC | Owner | Reason |
|----|------|------|
| TC-02 | ${L['tc.owner.implement']} | wiring |
| TC-03 | ${L['tc.owner.split']} ABC-999 | no entry path yet |
`;

// Writes prd.md and tc.md into a fresh project and returns the paths with the root
const setup = (locale, { prd, tc, files, roots } = {}) => {
    const L = labelsFor(locale);
    const root = project(locale, files, roots);
    return {
        L,
        root,
        prd: write(root, 'w/prd.md', prd ?? prdText(L)),
        tc: write(root, 'w/tc.md', tc ?? tcText(L))
    };
};

for (const locale of LOCALES) {
    test(`[${locale}] PRD lint: blocks an unhandled spec I/F and an endpoint without a source`, () => {
        const { root, prd } = setup(locale);
        assert.deepEqual(run(root, '--prd', prd, '--lint').lint.errors, [
            'Spec I/F is in neither the requirements nor the handling column: IF-002',
            'Spec input, but the endpoint has no source: /api/a'
        ]);
    });

    test(`[${locale}] PRD lint: a dynamic route segment in the scope is not a placeholder`, () => {
        const L = labelsFor(locale);
        const errs = (scope) => {
            const text = `# Feature PRD\n\n> **${L['prd.scope']}**: ${scope}\n\n## ${acHeading(L)}\n\n- [ ] **AC-01**: works\n`;
            const { root, prd } = setup(locale, { prd: text });
            return run(root, '--prd', prd, '--lint').lint.errors;
        };
        assert.deepEqual(errs('Assistant screen (/app/[version]/assistant) > Image collection'), []);
        assert.deepEqual(errs('[target screen > component]'), [
            `\`> **${L['prd.scope']}**:\` (target screen) is empty or unclear`
        ]);
    });

    test(`[${locale}] PRD with no AC: no-ac names the expected heading, never a pass`, () => {
        const L = labelsFor(locale);
        const text = `# Feature PRD\n\n> **${L['prd.scope']}**: Home\n\n## ${acHeading(L)}\n\n(none yet)\n`;
        const { root, prd } = setup(locale, { prd: text });
        const expected = `no-ac: no **AC-NN** line under \`## ${L['prd.acHeading']}\` (locale ${locale})`;
        assert.deepEqual(run(root, '--prd', prd, '--lint').lint.errors, [expected]);
        assert.deepEqual(run(root, '--prd', prd), { ok: false, error: expected });
    });

    test(`[${locale}] PRD in the other locale is a no-ac error, not 0 ACs passing`, () => {
        const other = labelsFor(locale === 'ko' ? 'en' : 'ko');
        const L = labelsFor(locale);
        const { root, prd, tc } = setup(locale, { prd: prdText(other) });
        const lint = run(root, '--prd', prd, '--lint').lint;
        assert.ok(lint.errors.includes(
            `no-ac: no **AC-NN** line under \`## ${L['prd.acHeading']}\` (locale ${locale})`
        ));
        const g2 = run(root, '--prd', prd, '--tc', tc);
        assert.equal(g2.ok, false);
        assert.match(g2.error, /^no-ac: /);
    });

    test(`[${locale}] tc.md with no TC is a no-tc error`, () => {
        const L = labelsFor(locale);
        const { root, prd, tc } = setup(locale, { tc: `# Feature ${L['tc.titleSuffix']}\n\nnothing\n` });
        const out = run(root, '--prd', prd, '--tc', tc, '--lint');
        assert.equal(out.ok, false);
        assert.match(out.error, /^no-tc: /);
        // a caller that reads only lint.errors must not see a clean result
        assert.deepEqual(out.lint, { errors: [out.error], warnings: [] });
    });

    test(`[${locale}] tc.md in the other locale is a no-related-ac error in G2 and completion`, () => {
        const L = labelsFor(locale);
        const other = labelsFor(locale === 'ko' ? 'en' : 'ko');
        const { root, prd, tc } = setup(locale, { tc: tcText(other) });
        const plan = write(root, 'w/plan.md', `### ${L['plan.task']} 1: [TC-01] a\n`);
        const expected = `no-related-ac: no TC has a **${L['tc.relatedAc']}** row (locale ${locale}) — TC-01, TC-02, TC-03`;
        assert.deepEqual(run(root, '--prd', prd, '--tc', tc), { ok: false, error: expected });
        const done = run(root, '--prd', prd, '--tc', tc, '--plan', plan, '--lint');
        assert.equal(done.ok, false);
        assert.equal(done.error, expected);
        assert.deepEqual(done.lint.errors, [expected]);
    });

    test(`[${locale}] TC lint: a TC without the related-AC row is a no-related-ac error`, () => {
        const L = labelsFor(locale);
        const bare = `### TC-04: no related AC\n\n| Field | Value |\n|---|---|\n| **${L['tc.field.unitTarget']}** | src/x.test.js |\n`;
        const { root, prd, tc } = setup(locale, { tc: tcText(L, bare) });
        const out = run(root, '--prd', prd, '--tc', tc, '--lint');
        assert.equal(out.ok, true);
        assert.ok(out.lint.errors.includes(
            `no-related-ac: TC-04 has no **${L['tc.relatedAc']}** row (locale ${locale})`
        ), out.lint.errors.join('\n'));
    });

    test(`[${locale}] TC lint: surface files that all do not exist are a no-targets error`, () => {
        const L = labelsFor(locale);
        const surface = `## ${L['tc.surface']}\n\n| Planned path | Kind | ${L['tc.surface.siblingColumn']} |\n|---|---|---|\n| \`src/gone.js\` | util | same as siblings |\n| \`src/new.js\` ${L['tc.surface.new']} | util | — |\n`;
        const { root, prd, tc } = setup(locale, { tc: tcText(L, surface) });
        assert.ok(run(root, '--prd', prd, '--tc', tc, '--lint').lint.errors.includes(
            `no-targets: no file listed for modification exists under the project root (src/gone.js) — the ## ${L['tc.entryBranches']} and ## ${L['tc.flagEffects']} checks cannot run; fix the paths`
        ));
    });

    test(`[${locale}] TC lint: each non-new surface row whose file does not exist is an error`, () => {
        const L = labelsFor(locale);
        const surface = `## ${L['tc.surface']}\n\n| Planned path | Kind | ${L['tc.surface.siblingColumn']} |\n|---|---|---|\n| \`src/here.js\` | util | same as siblings |\n| \`src/gone.js\` | util | same as siblings |\n| \`src/new.js\` ${L['tc.surface.new']} | util | — |\n`;
        const { root, prd, tc } = setup(locale, { tc: tcText(L, surface), files: { 'src/here.js': 'export const a = 1;\n' } });
        const errors = run(root, '--prd', prd, '--tc', tc, '--lint').lint.errors;
        const missing = errors.filter((e) => e.includes('does not exist'));
        assert.deepEqual(missing, [
            `${L['tc.surface']} src/gone.js: modifies an existing file that does not exist — mark it ${L['tc.surface.new']} or fix the path`
        ]);
    });

    test(`[${locale}] TC lint: blocks a missing E2E basis and an undecided owner`, () => {
        const { L, root, prd, tc } = setup(locale);
        const out = run(root, '--prd', prd, '--tc', tc, '--lint');
        assert.deepEqual(out.uncovered, []);
        assert.ok(out.lint.errors.includes(
            `TC-03: ${L['tc.field.e2eSuitability']} is ${L['tc.e2eFit.e2e']} but ${L['tc.e2eBasis']} is empty`
        ));
        assert.ok(out.lint.errors.includes(
            `TC-02: a TC without a unit test has no owner (## ${L['tc.owner']})`
        ));
    });

    test(`[${locale}] TC lint: a surface row that modifies an existing file needs a sibling convention`, () => {
        const L = labelsFor(locale);
        const sib = L['tc.surface.siblingColumn'];
        const surface = (header, row) => {
            const extra = `## ${L['tc.surface']}\n\n${header}\n|---|---|---|\n${row}\n`;
            const { root, prd, tc } = setup(locale, { tc: tcText(L, extra) });
            return run(root, '--prd', prd, '--tc', tc, '--lint').lint.errors
                .filter((e) => e.includes(`## ${L['tc.surface']}`));
        };
        const isNew = L['tc.surface.new'];
        assert.deepEqual(
            surface('| Planned path | Kind | Similar file |', `| \`src/a.js\` ${isNew} | util | \`src/b.js\` |`),
            [`## ${L['tc.surface']} has no ${sib} column`]
        );
        const header = `| Planned path | Kind | ${sib} |`;
        assert.deepEqual(surface(header, '| `src/c/Ctrl.js` | controller | — |'), [
            `## ${L['tc.surface']} \`src/c/Ctrl.js\`: modifies an existing file but ${sib} is empty`
        ]);
        assert.deepEqual(surface(header, `| \`src/c/Ctrl.js\` | controller | (${L['tc.none']}) |`), [
            `## ${L['tc.surface']} \`src/c/Ctrl.js\`: modifies an existing file but ${sib} is empty`
        ]);
        assert.deepEqual(surface(header, `| \`src/a.js\` ${isNew} | util | — |`), []);
        // splitting on an escaped `\|` would shift the sibling column and miss the empty cell
        assert.deepEqual(surface(header, '| `src/c\\|d.js` | controller | — |'), [
            `## ${L['tc.surface']} \`src/c|d.js\`: modifies an existing file but ${sib} is empty`
        ]);
        assert.deepEqual(
            surface(header, '| `src/c/Ctrl.js` | controller | same switch, synopsis branch |'),
            []
        );
    });

    test(`[${locale}] TC lint: blocks a landing CP asserted by href or by a nameless search value`, () => {
        const L = labelsFor(locale);
        const cps = (row) => {
            const { root, prd, tc } = setup(locale, { tc: tcText(L, `### TC-09: landing\n\n${row}\n`) });
            return run(root, '--prd', prd, '--tc', tc, '--lint').lint.errors
                .filter((e) => /: URL /.test(e));
        };
        assert.deepEqual(cps("| CP-04 | URL | `href` | hasText('NM2000159057') | menu |"), [
            'TC-09 CP-04: URL href contains-assertion — assert the destination with pathname or search'
        ]);
        assert.deepEqual(cps("| CP-04 | URL | `pathname` | toBe('/jump/home/0/NM2') | menu |"), []);
        assert.deepEqual(cps("| CP-04 | URL | `search` | hasText('NM2000159057') | menu |"), [
            'TC-09 CP-04: URL search asserts only a value — include the parameter name (key=value) or assert the pathname'
        ]);
        assert.deepEqual(cps("| CP-04 | URL | `search` | hasText('sris_id=CS02') | series |"), []);
    });

    test(`[${locale}] TC lint: an entry flag in a modified file's sibling branches needs the entry-branches table`, () => {
        const L = labelsFor(locale);
        const surface = `## ${L['tc.surface']}\n\n| Planned path | Kind | ${L['tc.surface.siblingColumn']} |\n|---|---|---|\n| \`Ctrl.js\` | controller | live branch: kids go to KIDS_ZONE |\n`;
        const lint = (extra) => {
            const { root, prd, tc } = setup(locale, {
                tc: tcText(L, surface + extra),
                files: { 'Ctrl.js': "if (store.isFromKids === 'Y') go('KIDS_ZONE');\n" }
            });
            return run(root, '--prd', prd, '--tc', tc, '--lint').lint.errors
                .filter((e) => e.includes(L['tc.entryBranches']));
        };
        assert.deepEqual(lint(''), [
            `Ctrl.js: sibling branches split the entry path on isFromKids — add isFromKids handling for each new branch to the ## ${L['tc.entryBranches']} table`
        ]);
        assert.deepEqual(
            lint(`\n## ${L['tc.entryBranches']}\n\n| Flag | New branch | Handling |\n|---|---|---|\n| isFromKids | channel | KIDS_ZONE |\n`),
            []
        );
    });

    test(`[${locale}] TC lint: a dynamic route path with brackets still finds the entry flag`, () => {
        const L = labelsFor(locale);
        const surface = `## ${L['tc.surface']}\n\n| Planned path | Kind | ${L['tc.surface.siblingColumn']} |\n|---|---|---|\n| \`pages/[version]/Page.vue\` | page | kids entry branch |\n`;
        const { root, prd, tc } = setup(locale, {
            tc: tcText(L, surface),
            files: { 'pages/[version]/Page.vue': 'if (route.query.isFromKids) go();\n' }
        });
        const errors = run(root, '--prd', prd, '--tc', tc, '--lint').lint.errors
            .filter((e) => e.includes(L['tc.entryBranches']));
        assert.deepEqual(errors, [
            `pages/[version]/Page.vue: sibling branches split the entry path on isFromKids — add isFromKids handling for each new branch to the ## ${L['tc.entryBranches']} table`
        ]);
    });

    test(`[${locale}] TC lint: values other files write while a toggled shared flag is true need the flag side-effects table`, () => {
        const L = labelsFor(locale);
        const fx = L['tc.flagEffects'];
        const surface = `## ${L['tc.surface']}\n\n| Planned path | Kind | ${L['tc.surface.siblingColumn']} |\n|---|---|---|\n| \`app/fin.js\` | composable | releases the guard per result |\n`;
        const files = {
            'app/fin.js': 'Utils.KEY_BLOCK = false;\n',
            'app/main.vue': 'if (Utils.KEY_BLOCK) {\n    store.updateFlag({ isAvailable: false });\n}\n'
        };
        const lint = (extra, more = {}) => {
            const { root, prd, tc } = setup(locale, {
                tc: tcText(L, surface + extra),
                files: { ...files, ...more },
                roots: ['app']
            });
            return run(root, '--prd', prd, '--tc', tc, '--lint').lint.errors.filter((e) => e.includes(fx));
        };
        assert.deepEqual(lint(''), [
            `app/main.vue:1 writes isAvailable while KEY_BLOCK is true — in the ## ${fx} table, state whether this design changes how long KEY_BLOCK stays true and how isAvailable is handled`
        ]);
        assert.deepEqual(
            lint(`\n## ${fx}\n\n| Flag | Written while true | Handling |\n|---|---|---|\n| KEY_BLOCK | main.vue isAvailable | restore isAvailable on release |\n`),
            []
        );
        // one row per writer is fine too
        assert.deepEqual(
            lint(
                `\n## ${fx}\n\n| Flag | Written while true | Handling |\n|---|---|---|\n| KEY_BLOCK | main.vue isAvailable | restore |\n| KEY_BLOCK | other.vue opacity | unchanged |\n`,
                { 'app/other.vue': 'if (Utils.KEY_BLOCK) {\n    panel.opacity = 0;\n}\n' }
            ),
            []
        );
    });

    test(`[${locale}] TC lint: no source files under source.roots is a no-targets error, not a pass`, () => {
        const L = labelsFor(locale);
        const surface = `## ${L['tc.surface']}\n\n| Planned path | Kind | ${L['tc.surface.siblingColumn']} |\n|---|---|---|\n| \`app/fin.js\` | composable | releases the guard |\n`;
        const { root, prd, tc } = setup(locale, {
            tc: tcText(L, surface),
            files: { 'app/fin.js': 'Utils.KEY_BLOCK = false;\n' },
            roots: ['src']
        });
        const errors = run(root, '--prd', prd, '--tc', tc, '--lint').lint.errors;
        assert.ok(errors.includes(
            `no-targets: no production source files under source.roots (src) — the ## ${L['tc.flagEffects']} check cannot run; set source.roots`
        ), errors.join('\n'));
    });

    test(`[${locale}] TC lint: a PRD field that existing code reads by segment needs the field-interpretation table`, () => {
        const L = labelsFor(locale);
        const fi = L['tc.fieldInterp'];
        const prd = `# P\n\n> **${L['prd.scope']}**: Home\n\n## ${L['prd.requirements']}\n\n1. open the screen with \`item_path\` and read \`item_meta\`\n\n## ${acHeading(L)}\n\n- [ ] **AC-01**: works\n- [ ] **AC-02**: stays\n`;
        const nav = "const openItem = (item_path) => {\n    const p = item_path.split('/');\n    type = map[p[0]];\n    id = p[2];\n};\nconst readMeta = (item_meta) => JSON.parse(item_meta);\nconst openItemTarget = (item_path) => {\n    const q = item_path.split('/');\n    last = q[q.length - 1];\n};\n";
        const lint = (extra) => {
            const { root, prd: p, tc } = setup(locale, {
                prd,
                tc: tcText(L, extra),
                files: { 'modules/nav.js': nav },
                roots: ['modules']
            });
            return run(root, '--prd', p, '--tc', tc, '--lint').lint.errors.filter((e) => e.includes(fi));
        };
        const cols = ['field', 'newBranch', 'follows', 'writes', 'drops'].map((k) => L[`tc.fieldInterp.${k}`]);
        const table = (rows) => `\n## ${fi}\n\n| ${cols.join(' | ')} |\n|---|---|---|---|---|\n${rows}`;
        assert.deepEqual(lint(''), [
            `item_path is read segment by segment by existing code (openItem /[0][2] · openItemTarget /[-1]) — in the ## ${fi} table, give each new branch its ${cols[2]}, ${cols[3]} and ${cols[4]}`
        ]);
        assert.deepEqual(lint(table('| `item_path` | b | `openItem` | `[2]` item id | — |\n')), [
            `## ${fi} b: openItem reads slot [0] of item_path (modules/nav.js:3 type = map[p[0]];) — put it in ${cols[3]} or ${cols[4]}`
        ]);
        assert.deepEqual(lint(table('| `item_path` | b | `openItem` | `[2]` item id | `[0]` |\n')), [
            `## ${fi} b: ${cols[4]} has no reason (\`[n] — <reason>\`)`
        ]);
        assert.deepEqual(lint(table('| `item_path` | b | new parser | `[2]` | — |\n')), [
            `## ${fi} b: ${cols[2]} is not an existing interpreter name — if it follows none, write \`${L['tc.none']} — <reason>\``
        ]);
        // an interpreter that does not split is still accepted by name
        assert.deepEqual(
            lint(table('| `item_path` | t | `openItemTarget` | `[-1]` | — |\n') + '| `item_meta` | t | `readMeta` | whole JSON | — |\n'),
            []
        );
        // a name that is a prefix of another (openItem) does not pull in its slots
        assert.deepEqual(lint(table('| `item_path` | t | `openItemTarget` | `[-1]` | — |\n')), []);
        assert.deepEqual(
            lint(table(
                '| `item_path` | a | `openItem` | `[0]` code table · `[2]` item id | — |\n' +
                '| `item_path` | b | `openItem` | `[2]` item id | `[0]` — screen b takes no type |\n' +
                `| \`item_path\` | c | ${L['tc.none']} — passed through as a URL | — | — |\n`
            )),
            []
        );
    });

    test(`[${locale}] plan lint: catches brief leaks, red-gate arguments and missing owners`, () => {
        const { L, root, prd } = setup(locale);
        const tc = write(root, 'w/tc-owned.md', tcText(L, owners(L)));
        const plan = write(root, 'w/x-plan.md', `# Plan

## Global Constraints

- common

### ${L['plan.task']} 1: [TC-01, TC-02] filter

- Modify: \`src/missing-file.js\`

\`\`\`bash
node scripts/red-gate.mjs --phase red \\
  --plan p.md --task 1 \\
  --file "src/filter.test.js" \\
  --test "UCP-01: x"
node scripts/red-gate.mjs --phase green --plan p.md --file /abs/filter.test.js --test "UCP-01: x"
\`\`\`

## Shared design
`);
        const e = run(root, '--prd', prd, '--tc', tc, '--plan', plan, '--lint').lint.errors.join('\n');
        assert.match(e, /\[TC-NN, TC-MM\]/);
        assert.match(e, /Modify target does not exist: src\/missing-file\.js/);
        assert.match(e, /section after the first Task: `## Shared design`/);
        // --project is optional; the other arguments are still required
        assert.doesNotMatch(e, /--project/);
        assert.match(e, /red-gate command is missing --task: node scripts\/red-gate\.mjs --phase green/);
        assert.match(e, /red-gate --file is not an absolute path/);
        // the comma form is not counted, so TC-01 and TC-02 have no task; TC-03 has a split decision
        assert.match(e, /TC-01: unit TC has no owning task/);
        assert.match(e, /TC-02: a TC without a unit test has no owning task/);
        assert.doesNotMatch(e, /TC-03/);
    });

    test(`[${locale}] tc.md owners feed completion coverage`, () => {
        const { L, root, prd } = setup(locale);
        const tc = write(root, 'w/tc-owned.md', tcText(L, owners(L)));
        const plan = write(root, 'w/y-plan.md', `# Plan\n\n### ${L['plan.task']} 1: [TC-01][TC-02] filter\n`);
        assert.deepEqual(run(root, '--prd', prd, '--tc', tc, '--plan', plan).summary, {
            implemented: 2,
            verifyOnly: 0,
            split: 0,
            excluded: 0,
            missing: 0
        });
    });

    test(`[${locale}] plan lint: a Create target of a task with passing ledger evidence is not an error`, () => {
        const { L, root, prd } = setup(locale, { files: { 'package.json': '{}', 'vite.config.js': '' } });
        const tc = write(root, 'w/tc-owned.md', tcText(L, owners(L)));
        const plan = write(
            root,
            'w/x-plan.md',
            `### ${L['plan.task']} 1: [TC-01] done task\n\n- Create: \`package.json\`\n\n` +
                `### ${L['plan.task']} 2: [TC-02] task added after a rewind\n\n- Create: \`vite.config.js\`\n`
        );
        write(root, 'w/red-evidence.jsonl', `${JSON.stringify({ task: 1, phase: 'red', ok: true })}\n`);
        const e = run(root, '--prd', prd, '--tc', tc, '--plan', plan, '--lint').lint.errors.join('\n');
        assert.doesNotMatch(e, /Create target already exists: package\.json/);
        assert.match(e, /Create target already exists: vite\.config\.js/);
    });
}

test('[en] sample PRD in the EUXP-style format lints clean', () => {
    const root = project('en');
    const prd = path.join(import.meta.dirname, 'fixtures/prd-en-sample.md');
    const out = run(root, '--prd', prd, '--lint');
    assert.equal(out.ok, true);
    assert.equal(out.acTotal, 4);
    assert.deepEqual(out.lint, { errors: [], warnings: [] });
});

test('[en] inline-source warning: "(source: …)" warns, a word like "resource" does not', () => {
    const L = labelsFor('en');
    const text = `# Feature PRD\n\n> **${L['prd.scope']}**: Home\n\n## ${L['prd.acHeading']}\n\n- [ ] **AC-01**: shows the resource list\n- [ ] **AC-02**: saves the data source setting\n- [ ] **AC-03**: shows the badge (source: spec §2)\n`;
    const { root, prd } = setup('en', { prd: text });
    assert.deepEqual(run(root, '--prd', prd, '--lint').lint.warnings, [
        `AC line carries its source — move it to the ${L['prd.acProvenance']} table: - [ ] **AC-03**: shows the badge (source: spec §2)`
    ]);
});

test('missing config is an error', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'coverage-gate-'));
    mkdirSync(path.join(root, '.git'));
    const prd = write(root, 'prd.md', prdText(labelsFor('en')));
    const out = run(root, '--prd', prd);
    assert.equal(out.ok, false);
    assert.match(out.error, /pipeline\.config\.json not found/);
});

test('completion: a root-relative plan path works from a subdirectory cwd and reads the ledger beside it', () => {
    const L = labelsFor('en');
    const { root, prd, tc } = setup('en');
    write(root, 'w/x-plan.md', `### ${L['plan.task']} 1: [TC-01] done\n\n- Create: \`package.json\`\n`);
    write(root, 'package.json', '{}');
    write(root, 'w/red-evidence.jsonl', JSON.stringify({ task: 1, phase: 'green', ok: true, failureClass: 'OK_GREEN' }) + '\n');
    mkdirSync(path.join(root, 'sub'), { recursive: true });
    const out = JSON.parse(execFileSync('node', [gate, '--prd', 'w/prd.md', '--tc', 'w/tc.md', '--plan', 'w/x-plan.md', '--lint'], { cwd: path.join(root, 'sub'), encoding: 'utf8' }));
    assert.equal(out.ok, true, out.error);
    assert.equal(out.mode, 'completion');
    assert.ok(!out.lint.errors.some((e) => e.includes('package.json')), out.lint.errors.join('\n'));
});
