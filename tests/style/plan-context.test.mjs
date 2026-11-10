import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { annotatePlan, pickStyle } from '../../scripts/style/plan-context.mjs';

const PLAN_CONTEXT = path.resolve(import.meta.dirname, '../../scripts/style/plan-context.mjs');

const catalog = {
    excluded: ['src/mocks/**', '**/*.test.js'],
    layers: [
        { id: 'ui', name: 'UI', doc: 'ui.md', paths: ['src/components/**/*.vue'] },
        { id: 'viewmodel', name: 'View model', doc: 'viewmodel.md', paths: ['src/store/**'] },
        {
            id: 'motion',
            name: 'Motion',
            doc: 'motion.md',
            paths: ['src/components/three/**'],
            imports: ['^(gsap|three)(/|$)']
        }
    ]
};

const STYLE = `---
name: kim
emails: [kim@corp.example, kim@mail.example]
---

# kim style

## ui — UI

- Prefers mapping objects.

## Design attitude

- Consolidates once repeats pile up.

## Code shape

- Always braces.
`;

// tdd-implement task-checkbox-contract shape: bare paths, implementation code in fences
const PLAN = `# Feature Implementation Plan

**Goal:** something

**Spec:** /repo/.agents/works/x/tc.md
(requirements: prd.md)

## Global Constraints

\`\`\`
- Follow the project rules.
\`\`\`

### Task 1: [TC-01] Card

**Files:**
- Create: src/components/card/Card.vue
- Modify: src/store/product.js:903-940
- Modify: src/mocks/data/base.js:120
- Test:   src/store/product.test.js

- [ ] Write the failing test — \`it('UCP-01: card')\` (real code below)

\`\`\`javascript
// ### Task 9: a heading inside a fence is not a task
- [ ] a checkbox inside a fence
\`\`\`

- [ ] Minimal implementation (real code below)

### Task 2: [TC-02] Effect

**Full replacement:** the whole effect module — no settled pattern to keep

**Files:**
- Modify: src/utils/effect.js
- Create: server/new/thing.js

- [ ] Minimal implementation
`;

const opts = {
    catalog,
    layersDir: '.agents/layers',
    stylePath: '.agents/styles/kim.md',
    styleText: STYLE,
    readFile: (f) => (f === 'src/utils/effect.js' ? "import gsap from 'gsap';\n" : undefined)
};

test('pickStyle: argument > plan header > email match > defaultStyle > none', () => {
    const files = {
        '.agents/styles/kim.md': STYLE,
        '.agents/styles/lee.md': '---\nname: lee\nemails: [lee@corp.example]\n---\n',
        '.agents/styles/lead.md': '---\nname: lead\nemails: [lead@corp.example]\n---\n'
    };
    const base = { stylesDir: '.agents/styles', files, email: 'kim@mail.example' };
    assert.equal(pickStyle({ ...base, style: 'lee', planStyle: '.agents/styles/lead.md' }), '.agents/styles/lee.md');
    assert.equal(pickStyle({ ...base, planStyle: '.agents/styles/lee.md' }), '.agents/styles/lee.md');
    assert.equal(pickStyle(base), '.agents/styles/kim.md');
    assert.equal(pickStyle({ ...base, email: 'nobody@x', defaultStyle: 'lead.md' }), '.agents/styles/lead.md');
    assert.equal(pickStyle({ ...base, email: 'nobody@x' }), null);
    assert.throws(() => pickStyle({ ...base, style: 'park' }), /park/);
});

test('annotatePlan writes the style header after the Spec paragraph', () => {
    const { text } = annotatePlan(PLAN, opts);
    assert.match(text, /\(requirements: prd\.md\)\n\*\*Style:\*\* `\.agents\/styles\/kim\.md`\n\n## Global/);
});

test('annotatePlan inserts a context step before the first checkbox of each task', () => {
    const { text, report } = annotatePlan(PLAN, opts);
    const task1 = text.slice(text.indexOf('### Task 1'), text.indexOf('### Task 2'));
    assert.match(
        task1,
        /- Test: {3}src\/store\/product\.test\.js\n\n- \[ \] Read context — [^\n]+\n {2}- Layer: `ui` → `\.agents\/layers\/ui\.md`, `viewmodel` → `\.agents\/layers\/viewmodel\.md`\n {2}- Style: `\.agents\/styles\/kim\.md` — `## ui — UI` section, free sections `## Design attitude` · `## Code shape`\n {2}- [^\n]+\n- \[ \] Write the failing test/
    );
    assert.deepEqual(report.tasks[0], {
        n: 1,
        layers: ['ui', 'viewmodel'],
        create: ['src/components/card/Card.vue'],
        modify: ['src/store/product.js', 'src/mocks/data/base.js']
    });
});

test('annotatePlan ignores task headings and checkboxes inside code fences', () => {
    const { text, report } = annotatePlan(PLAN, opts);
    assert.deepEqual(
        report.tasks.map((t) => t.n),
        [1, 2]
    );
    assert.equal(text.match(/Read context/g).length, 2);
});

test('annotatePlan reports layers without a style section, unmapped paths and full replacements', () => {
    const { text, report } = annotatePlan(PLAN, opts);
    assert.deepEqual(report.tasks[1].layers, ['motion']);
    assert.deepEqual(report.noLayerSection, ['viewmodel', 'motion']);
    assert.match(text, /- Style: `\.agents\/styles\/kim\.md` — free sections `## Design attitude` · `## Code shape`\n/);
    assert.deepEqual(report.unmapped, ['server/new/thing.js']);
    assert.deepEqual(report.fullReplace, [2]);
    assert.equal(report.style, '.agents/styles/kim.md');
});

test('annotatePlan without a catalog points at the style file only', () => {
    const { text, report } = annotatePlan(PLAN, { ...opts, catalog: null });
    assert.doesNotMatch(text, /- Layer:/);
    // without a catalog no heading is a layer id, so every section is passed along
    assert.match(
        text,
        /- Style: `\.agents\/styles\/kim\.md` — free sections `## ui — UI` · `## Design attitude` · `## Code shape`\n/
    );
    assert.deepEqual(report.unmapped, []);
    assert.deepEqual(report.tasks[0].layers, []);
});

test('annotatePlan is idempotent and replaces an existing style header', () => {
    const once = annotatePlan(PLAN, opts).text;
    assert.equal(annotatePlan(once, opts).text, once);
    const other = annotatePlan(once, { ...opts, stylePath: '.agents/styles/lee.md' }).text;
    assert.equal(other.match(/\*\*Style:\*\*/g).length, 1);
    assert.match(other, /\*\*Style:\*\* `\.agents\/styles\/lee\.md`/);
    assert.equal(other.match(/Read context/g).length, 2);
});

test('CLI leaves the plan alone when no style file can be picked', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'style-skip-'));
    try {
        spawnSync('git', ['init', '-q'], { cwd: dir });
        spawnSync('git', ['config', 'user.email', 'nobody@x'], { cwd: dir });
        mkdirSync(path.join(dir, '.agents/styles'), { recursive: true });
        writeFileSync(path.join(dir, '.agents/styles/kim.md'), STYLE);
        writeFileSync(path.join(dir, 'plan.md'), PLAN);
        const r = spawnSync(process.execPath, [PLAN_CONTEXT, '--plan', 'plan.md'], { cwd: dir, encoding: 'utf8' });
        assert.equal(r.status, 0, r.stderr);
        assert.deepEqual(JSON.parse(r.stdout), { style: null, skipped: true });
        assert.equal(readFileSync(path.join(dir, 'plan.md'), 'utf8'), PLAN);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('a Full replacement marker written as a list item is still reported', () => {
    const plan = PLAN.replace('**Full replacement:**', '- **Full replacement:**');
    assert.deepEqual(annotatePlan(plan, opts).report.fullReplace, [2]);
});

test('nested and tilde fences hide their content from task parsing', () => {
    const plan = PLAN.replace(
        '- [ ] Minimal implementation (real code below)',
        [
            '````markdown',
            '```javascript',
            'const x = 1;',
            '```',
            '### Task 9: fake',
            '- [ ] fake checkbox',
            '````',
            '',
            '~~~',
            '### Task 8: also fake',
            '~~~',
            '',
            '- [ ] Minimal implementation (real code below)'
        ].join('\n')
    );
    const { text, report } = annotatePlan(plan, opts);
    assert.deepEqual(
        report.tasks.map((t) => t.n),
        [1, 2]
    );
    assert.equal(text.match(/Read context/g).length, 2);
    assert.match(text, /- \[ \] fake checkbox\n````/);
});

test('style names work with or without the .md suffix', () => {
    const files = { '.agents/styles/lee.md': '---\nemails: [lee@x]\n---\n' };
    const base = { stylesDir: '.agents/styles', files, email: 'nobody@x' };
    assert.equal(pickStyle({ ...base, style: 'lee.md' }), '.agents/styles/lee.md');
    assert.equal(pickStyle({ ...base, defaultStyle: 'lee' }), '.agents/styles/lee.md');
});
