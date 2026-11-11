import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSpec } from '../../scripts/spec-template.mjs';
import { lint } from '../../scripts/spec-lint.mjs';

const cfg = {
    locale: 'en',
    ui: { stateBridge: { globalExpr: 'window.__STATE__' } },
    e2e: { specFilePrefix: '', kitDir: 'e2e/kit', adapterModule: 'e2e/e2e.adapter.js', bootFixtures: [] }
};
const fileName = 'tc01-landing.spec.js';
const spec = (verifications, extra = {}) =>
    buildSpec(
        { tcName: 'Landing', outputPath: `e2e/specs/feat/${fileName}`, screen: 'Home', slotBody: '', verifications, ...extra },
        cfg
    );
const rules = (src) => lint(src, { fileName, cfg }).violations.map((x) => x.rule);

const BY_TYPE = {
    DOM: { type: 'DOM', selector: '.a', condition: 'hidden' },
    Focus: { type: 'Focus', condition: "includes('menu')" },
    State: { type: 'State', path: 'a.b', condition: 'exists' },
    Runtime: { type: 'Runtime', path: 'networkErrors', condition: 'isEmpty' },
    URL: { type: 'URL', path: 'pathname', condition: "hasText('/a')" },
    Popup: { type: 'Popup', path: 'count' },
    Observe: { type: 'Observe', selector: '.toast', condition: 'peak toBe(1)' }
};

for (const [type, v] of Object.entries(BY_TYPE)) {
    test(`a generated ${type} spec passes lint`, () => {
        const r = lint(spec([v]), { fileName, cfg });
        assert.equal(r.pass, true, JSON.stringify(r.violations));
        assert.deepEqual(r.violations, []);
    });
}

test('a generated multi-case spec passes lint', () => {
    const src = spec([], { cases: [{ tcName: 'A', verifications: [BY_TYPE.DOM], slotBody: '' }, { tcName: 'B', verifications: [BY_TYPE.URL], slotBody: '' }] });
    const r = lint(src, { fileName, cfg });
    assert.equal(r.pass, true, JSON.stringify(r.violations));
});

test('an unfilled body slot fails rule 20', () => {
    const src = buildSpec({ tcName: 'L', outputPath: `e2e/specs/${fileName}`, screen: 'Home', verifications: [BY_TYPE.DOM] }, cfg);
    assert.ok(rules(src).includes(20));
});

test('fixture specs skip the afterEach-skeleton rules', () => {
    const r = rules(spec([BY_TYPE.DOM]));
    for (const n of [1, 2, 5, 6, 7, 12, 13, 15]) assert.ok(!r.includes(n), `rule ${n}`);
});

test('rule 21: every checkpoint id must run through cp()', () => {
    const src = spec([BY_TYPE.DOM, BY_TYPE.URL]).replace("await cp('cp-02',", "await step('cp-02',");
    assert.ok(rules(src).includes(21));
});

test('rule 21 checks each describe of a multi-case spec on its own', () => {
    const src = spec([], {
        cases: [
            { tcName: 'A', verifications: [BY_TYPE.DOM], slotBody: '' },
            { tcName: 'B', verifications: [BY_TYPE.DOM], slotBody: '' }
        ]
    });
    const at = src.lastIndexOf("await cp('cp-01',");
    const broken = `${src.slice(0, at)}await step('cp-01',${src.slice(at + "await cp('cp-01',".length)}`;
    // case A still has cp('cp-01'), which must not cover case B
    assert.ok(broken.includes("cp('cp-01'"));
    assert.ok(rules(broken).includes(21));
    assert.ok(!rules(src).includes(21));
});

test('rule 22: a fixture spec must not take test from @playwright/test', () => {
    const src = spec([BY_TYPE.DOM]).replace(
        'import { test, expect, mockAll',
        "import { test } from '@playwright/test';\nimport { expect, mockAll"
    );
    assert.ok(rules(src).includes(22));
});

test('rule 3 accepts expect.poll as an assertion', () => {
    assert.ok(!rules(spec([BY_TYPE.Popup])).includes(3));
});

test('rules that still apply to fixture specs keep firing', () => {
    const src = spec([BY_TYPE.DOM]);
    assert.ok(rules(src.replace('test.setTimeout(120000);', 'let x = 1; test.setTimeout(120000);')).includes(10));
    assert.ok(rules(`${src}\nawait page.waitForFunction(() => true, { timeout: 5000 });`).includes(11));
    assert.ok(rules(`${src}\nawait page.screenshot({ fullPage: true });`).includes(19));
    assert.ok(rules(src.replace('const CONSOLE_ERROR_WHITELIST', 'const X')).includes(4));
    assert.ok(lint(src, { fileName: 'x.spec.js', cfg: { e2e: { specFilePrefix: 'app-' } } }).violations.some((x) => x.rule === 9));
});

test('the CLI keeps its <spec.js> [--config <path>] arguments', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'spec-lint-'));
    const file = path.join(dir, fileName);
    const config = path.join(dir, 'pipeline.config.json');
    writeFileSync(file, spec([BY_TYPE.DOM]));
    writeFileSync(config, JSON.stringify(cfg));
    const script = fileURLToPath(new URL('../../scripts/spec-lint.mjs', import.meta.url));
    const out = JSON.parse(execFileSync(process.execPath, [script, file, '--config', config], { encoding: 'utf8' }));
    assert.equal(out.pass, true, JSON.stringify(out.violations));
});
