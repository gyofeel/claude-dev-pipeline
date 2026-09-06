#!/usr/bin/env node
// Self-check: assemble → lint passes; inject 2-arg waitForFunction → rule 11 fires.
import assert from 'node:assert/strict';
import { buildSpec } from './spec-template.mjs';
import { lint } from './spec-lint.mjs';

const base = {
    tcName: 'Catalog list renders',
    outputPath: 'e2e/specs/catalog/tc01-catalog-list.spec.js',
    screen: 'catalog',
    startUrl: '/catalog',
    renderSelector: '[data-testid=list]',
    fixtures: { '**/api/items': 'items.json' },
    successCriteria: 'The catalog list is visible and the first item has focus.',
    verifications: [
        { type: 'DOM', target: 'testid:list', condition: 'visible' },
        { type: 'DOM', target: '.item', condition: 'count(3)' },
        { type: 'Focus', condition: "matches('.item')" },
        { type: 'Runtime', condition: 'noConsoleErrors' }
    ]
};

// 1) pointer, no bridge
const cfgA = { ui: {}, e2e: { specFilePrefix: '', kitDir: 'e2e/kit', adapterModule: 'e2e/e2e.adapter.js', networkNoiseWhitelist: ['noise.example'] } };
const a = buildSpec(base, cfgA);
assert.ok(a.includes("from '../../kit/index.js'"), 'kit import relative path');
assert.ok(a.includes("from '../../e2e.adapter.js'"), 'adapter import relative path');
assert.ok(a.includes("NETWORK_ERROR_WHITELIST = ['noise.example']"));
assert.ok(lint(a, { fileName: 'tc01-catalog-list.spec.js', cfg: cfgA }).violations.some((x) => x.rule === 20), 'unfilled slot → rule 20');
const aFilled = a.replace(/ +\/\/ <<< TEST_BODY >>>[^\n]*\n/, '');
const la = lint(aFilled, { fileName: 'tc01-catalog-list.spec.js', cfg: cfgA });
assert.equal(la.pass, true, JSON.stringify(la.violations));
assert.ok(la.violations.length === 0 || la.violations.every((x) => x.severity === 'Warning'));

// 2) bridge + State verification + prefix + console allowlist
const cfgB = { ui: { stateBridge: { globalExpr: 'window.__STATE__', forbiddenGlobals: ['window.__oldState__'] } }, e2e: { specFilePrefix: 'app-', kitDir: 'tests/kit', adapterModule: 'tests/adapter.js', consoleAllowedMethods: ['log', 'error'] } };
const b = buildSpec(
    { ...base, outputPath: 'tests/specs/x/app-tc02-state.spec.js', liveData: true, notes: 'n', acceptanceCriteria: 'scenario',
      navigationPlan: { steps: [{ action: 'click', target: { by: 'text', value: 'Go' } }] },
      verifications: [...base.verifications, { type: 'State', path: 'catalog.items', condition: 'length(3)' }, { type: 'State', path: 'ui.ready', condition: 'toBe(true)' }] },
    cfgB
);
assert.ok(b.includes('window.__STATE__?.catalog?.items ?? null); // @state-path catalog.items'));
assert.ok(b.includes('// @live-data'));
assert.ok(b.includes('isolate: false'));
assert.ok(b.includes('<<< TEST_BODY >>>') && b.includes('navigationPlan (compile'));
// body slot still present → rule 20 must fire until the writer fills it
const lb0 = lint(b, { fileName: 'app-tc02-state.spec.js', cfg: cfgB });
assert.equal(lb0.pass, false);
assert.ok(lb0.violations.some((x) => x.rule === 20));
const bFilled = b.replace(/ +\/\* navigationPlan[\s\S]*?\*\/\n/, '').replace(/ +\/\/ <<< TEST_BODY >>>[^\n]*\n/, "        await adapter.locator(page, { by: 'text', value: 'Go' }).click();\n        await page.waitForFunction(() => location.pathname !== '/catalog', null, { timeout: 5000 });\n");
const lb = lint(bFilled, { fileName: 'app-tc02-state.spec.js', cfg: cfgB });
assert.equal(lb.pass, true, JSON.stringify(lb.violations));

// 3) mutations → rules fire
const r = (src, cfg, file = 'app-tc02-state.spec.js') => lint(src, { fileName: file, cfg }).violations.map((x) => x.rule);
assert.ok(r(bFilled.replace("!== '/catalog', null, { timeout: 5000 })", "!== '/catalog', { timeout: 5000 })"), cfgB).includes(11), 'rule 11');
assert.ok(r(bFilled, cfgB, 'wrong-name.spec.js').includes(9), 'rule 9');
assert.ok(r(bFilled.replace('SUCCESS_CRITERIA[0].passed = true;', 'console.warn(1); SUCCESS_CRITERIA[0].passed = true;'), cfgB).includes(18), 'rule 18');
assert.ok(r(bFilled.replace('window.__STATE__?.ui?.ready', 'window.__STATE__.state.value.ui.ready'), cfgB).includes(14), 'rule 14 state.value');
assert.ok(r(bFilled + '\n// window.__oldState__', cfgB).includes(14), 'rule 14 forbidden global');
assert.ok(r(bFilled.replace("value: 'Go' }", "value: '[Target name]' }"), cfgB).includes(20), 'rule 20 placeholder');
assert.ok(r(bFilled.replace('page.screenshot()', 'page.screenshot({ fullPage: true })'), cfgB).includes(19), 'rule 19');
assert.ok(r(bFilled.replace('acceptanceCriteria: SUCCESS_CRITERIA', 'successCriteriaResults: SUCCESS_CRITERIA'), cfgB).includes(13), 'rule 13');
assert.ok(r(bFilled.replace('test.setTimeout(120000);', 'let x = 1; test.setTimeout(120000);'), cfgB).includes(10), 'rule 10');
assert.throws(() => buildSpec({ ...base, verifications: [{ type: 'State', path: 'a.b', condition: 'truthy' }] }, cfgA), /stateBridge/);

console.log(JSON.stringify({ ok: true, pointerLines: aFilled.split('\n').length, bridgeLines: bFilled.split('\n').length, residual: la.llmResidual.map((x) => x.rule) }));
