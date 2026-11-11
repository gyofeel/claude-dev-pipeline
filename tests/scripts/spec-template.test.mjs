import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildSpec } from '../../scripts/spec-template.mjs';

const base = {
    tcName: 'Landing',
    outputPath: 'e2e/specs/feat/tc01-landing.spec.js',
    screen: 'Home',
    verifications: [{ type: 'DOM', selector: '.home' }]
};
const cfg = {
    locale: 'en',
    ui: { stateBridge: { globalExpr: 'window.__STATE__' } },
    e2e: { specFilePrefix: '', kitDir: 'e2e/kit', adapterModule: 'e2e/e2e.adapter.js', bootFixtures: [] }
};
const build = (input = {}, c = cfg) => buildSpec({ ...base, ...input }, c);
const withBoot = (bootFixtures) => ({ ...cfg, e2e: { ...cfg.e2e, bootFixtures } });

const ALL_TYPES = [
    { type: 'DOM', selector: '.a', condition: 'hidden' },
    { type: 'Focus', condition: "includes('menu')" },
    { type: 'Runtime', path: 'consoleErrors', condition: 'isEmpty' },
    { type: 'URL', path: 'pathname', condition: "hasText('/a')" },
    { type: 'Popup', path: 'url', condition: "hasText('a.com')" },
    { type: 'State', path: 'a.b', condition: 'exists' },
    { type: 'Observe', selector: '.toast', condition: 'peak toBe(1)' }
];

test('imports test, expect and mockAll from the kit and the adapter, never @playwright/test', () => {
    const out = build();
    assert.match(out, /^import \{ test, expect, mockAll, captureFailureDiagnostics, captureNavigationCensus \} from '\.\.\/\.\.\/kit\/index\.js';$/m);
    assert.match(out, /^import adapter from '\.\.\/\.\.\/e2e\.adapter\.js';$/m);
    assert.doesNotMatch(out, /@playwright\/test/);
    assert.match(out, /test\.use\(\{\n {4}e2e: \{\n {8}tcName: TC_NAME,\n {8}screen: 'Home',/);
    assert.match(out, /await adapter\.waitForAppReady\(page\);/);
});

test('without fixtures it boots on the real API — no isolation, real-api verdict', () => {
    const out = build();
    assert.match(out, /await mockAll\(page, \{\}, \{ isolate: false \}\);/);
    assert.match(out, /testMode: 'real-api'/);
});

test('isolates when a fixture pattern is one of e2e.bootFixtures', () => {
    const out = build(
        { fixtures: { '**/api/boot': 'boot.json', '**/api/a': 'a.json' } },
        withBoot(['**/api/boot'])
    );
    assert.match(out, /\{ isolate: true \}/);
    assert.match(out, /testMode: 'fixture'/);
});

test('does not isolate when no fixture pattern is a boot fixture', () => {
    const out = build({ fixtures: { '**/api/a': 'a.json' } }, withBoot(['**/api/boot']));
    assert.doesNotMatch(out, /isolate: true/);
    assert.match(out, /testMode: 'real-api'/);
});

test('does not isolate when e2e.bootFixtures is empty', () => {
    const out = build({ fixtures: { '**/api/boot': 'boot.json' } });
    assert.doesNotMatch(out, /isolate: true/);
});

test('isolate: false overrides a boot fixture and keeps the fixture over the real API', () => {
    const out = build(
        { fixtures: { '**/api/boot': 'boot.json' }, isolate: false },
        withBoot(['**/api/boot'])
    );
    assert.match(out, /await mockAll\(page, \{\n\s+'\*\*\/api\/boot': 'boot\.json'\n\s+\}, \{ isolate: false \}\);/);
    assert.match(out, /testMode: 'real-api'/);
});

test('DOM conditions become matchers on the adapter locator', () => {
    const out = build({
        verifications: [
            { type: 'DOM', selector: '.a', condition: 'hidden' },
            { type: 'DOM', selector: '.b', condition: "hasText('Home')" },
            { type: 'DOM', selector: '.c', condition: 'not hasClass --focused' },
            { type: 'DOM', selector: '.d', condition: 'toHaveCount(3)' },
            { type: 'DOM', selector: 'testid:list' }
        ]
    });
    const loc = (v) => `adapter\\.locator\\(page, \\{ by: 'css', value: '${v}' \\}\\)`;
    assert.match(out, new RegExp(`${loc('\\.a')}\\)\\.toBeHidden\\(\\)`));
    assert.match(out, new RegExp(`${loc('\\.b')}\\)\\.toContainText\\('Home'\\)`));
    assert.match(out, new RegExp(`${loc('\\.c')}\\)\\.not\\.toHaveClass\\(/--focused/\\)`));
    assert.match(out, new RegExp(`${loc('\\.d')}\\)\\.toHaveCount\\(3\\)`));
    assert.match(out, /adapter\.locator\(page, \{ by: 'testid', value: 'list' \}\)\)\.toBeVisible\(\)/);
});

test('State conditions read the configured state bridge', () => {
    const out = build({
        verifications: [
            { type: 'State', path: 'a.b', condition: 'falsy' },
            { type: 'State', path: 'a.c', condition: 'matches /^x/' }
        ]
    });
    assert.match(out, /page\.evaluate\(\(\) => window\.__STATE__\?\.a\?\.b \?\? null\)/);
    assert.match(out, /expect\(stateVal\)\.toBeFalsy\(\);/);
    assert.match(out, /expect\(stateVal\)\.toMatch\(\/\^x\/\);/);
});

test('State checkpoints stop when no state bridge is configured', () => {
    assert.throws(
        () => build({ verifications: [{ type: 'State', path: 'a.b' }] }, { ...cfg, ui: {} }),
        /stateBridge/
    );
});

test('runtime checkpoints assert the error lists filtered by the verdict whitelists', () => {
    const out = build({
        verifications: [
            { type: 'Runtime', path: 'consoleErrors', condition: 'isEmpty' },
            { type: 'Runtime', path: 'networkErrors', condition: 'filteredCount < 2' }
        ]
    });
    assert.match(out, /import \{ test, expect, mockAll, runtimeErrors, captureFailureDiagnostics, captureNavigationCensus \} from/);
    assert.match(out, /async \(\{ page, cp, collector \}\)/);
    assert.match(out, /const \{ consoleErrors \} = runtimeErrors\(collector/);
    assert.match(out, /expect\(consoleErrors\.map\(\(e\) => e\.text \?\? e\.url\)\)\.toEqual\(\[\]\);/);
    assert.match(out, /expect\(networkErrors\.length\)\.toBeLessThan\(2\);/);
});

test('waits once for API responses to settle before the first runtime checkpoint', () => {
    const out = build({
        verifications: [
            { type: 'Runtime', path: 'consoleErrors', condition: 'isEmpty' },
            { type: 'Runtime', path: 'networkErrors', condition: 'isEmpty' }
        ]
    });
    assert.equal(out.match(/await collector\.settle\(\);/g)?.length, 1);
    assert.ok(out.indexOf('collector.settle()') < out.indexOf("cp('cp-01'"));
});

test('NETWORK_ERROR_WHITELIST includes the configured noise so runtime checkpoints match the verdict', () => {
    const out = build(
        { networkErrorWhitelist: ['extra.example'] },
        { ...cfg, e2e: { ...cfg.e2e, networkNoiseWhitelist: ['noise.example'] } }
    );
    assert.match(out, /const NETWORK_ERROR_WHITELIST = \['noise\.example', 'extra\.example'\];/);
});

test('multi-line notes become one comment line each', () => {
    assert.match(build({ notes: 'first\nsecond' }), /^\/\/ notes: first\n\/\/ second$/m);
    assert.match(build({ notes: ['first', 'second'] }), /^\/\/ notes: first\n\/\/ second$/m);
});

test('URL checkpoints wait for the landing and assert the location value', () => {
    const out = build({
        verifications: [
            { type: 'URL', path: 'pathname', condition: "hasText('/detail/')" },
            { type: 'URL', path: 'search', condition: "not hasText('id=1')" },
            { type: 'URL', path: 'pathname', condition: 'matches /^\\/jump/' }
        ]
    });
    assert.match(
        out,
        /await expect\.poll\(async \(\) => seen\(await page\.evaluate\(\(\) => location\.pathname\)\)\)\.toContain\('\/detail\/'\);/
    );
    assert.match(out, /location\.search\)\)\)\.not\.toContain\('id=1'\);/);
    assert.match(out, /location\.pathname\)\)\)\.toMatch\(\/\^\\\/jump\/\);/);
    assert.match(out, /await cp\('cp-01', async \(seen\) =>/);
});

test('before checkpoints go ahead of the body slot, the rest after it', () => {
    const out = build({
        verifications: [
            { type: 'DOM', selector: '.a', before: true },
            { type: 'DOM', selector: '.b' }
        ]
    });
    const at = (s) => out.indexOf(s);
    assert.ok(at("cp('cp-01'") < at('<<< TEST_BODY >>>'));
    assert.ok(at('<<< TEST_BODY >>>') < at("cp('cp-02'"));
});

test('popup checkpoints collect windows from the start and answer external navigations with an empty document', () => {
    const out = build({
        verifications: [
            { type: 'Popup', path: 'count' },
            { type: 'Popup', path: 'url', condition: "hasText('a.com/x')" }
        ]
    });
    assert.ok(out.indexOf("page.on('popup'") < out.indexOf('<<< TEST_BODY >>>'));
    assert.match(out, /expect\.poll\(\(\) => popups\.length\)\.toBe\(1\)/);
    assert.match(out, /expect\.poll\(\(\) => seen\(popups\[0\]\?\.url\(\) \?\? ''\)\)\.toContain\('a\.com\/x'\)/);
    assert.ok(out.indexOf('.route(') < out.indexOf('<<< TEST_BODY >>>'));
    assert.match(out, /const appOrigin = new URL\(page\.url\(\)\)\.origin;/);
    assert.match(out, /isNavigationRequest\(\) &&\s+!route\.request\(\)\.url\(\)\.startsWith\(appOrigin\)/);
    assert.doesNotMatch(build(), /isNavigationRequest/);
});

test('exists only checks that a value is present', () => {
    const out = build({ verifications: [{ type: 'State', path: 'a.b', condition: 'exists' }] });
    assert.match(out, /expect\(stateVal\)\.not\.toBeNull\(\)/);
});

test('unknown types and conditions stop instead of passing silently', () => {
    assert.throws(() => build({ verifications: [{ type: 'Console', path: 'x' }] }), /verification type/);
    assert.throws(() => build({ verifications: [{ type: 'Send', path: 'X' }] }), /verification type/);
    assert.throws(
        () => build({ verifications: [{ type: 'DOM', selector: '.a', condition: 'shown' }] }),
        /condition/
    );
});

test('locale checkpoint labels are accepted as types', () => {
    const out = build({
        verifications: [
            { type: '포커스', condition: "includes('menu')" },
            { type: 'Store', path: 'a.b', condition: 'truthy' },
            { type: '런타임', path: 'consoleErrors' },
            { type: '팝업', path: 'count' },
            { type: '관측', selector: '.t', condition: 'peak toBe(0)' }
        ]
    });
    for (let i = 1; i <= 5; i++) assert.match(out, new RegExp(`cp\\('cp-0${i}'`));
});

test('focus checkpoints read the configured focus expression, else the active element', () => {
    const v = [{ type: 'Focus', condition: "includes('menu')" }];
    const bridged = build(
        { verifications: v },
        { ...cfg, ui: { stateBridge: { globalExpr: 'window.__STATE__', focusExpr: 'window.__STATE__.focus.id' } } }
    );
    assert.match(bridged, /const focusId = await page\.evaluate\(\(\) => String\(window\.__STATE__\.focus\.id \?\? ''\)\);/);
    assert.match(bridged, /expect\(focusId\)\.toContain\('menu'\);/);
    assert.match(build({ verifications: v }), /String\(document\.activeElement/);
});

test('the generated spec is valid JavaScript with every checkpoint type', () => {
    const out = build({
        verifications: [...ALL_TYPES, { type: 'DOM', selector: '.c', before: true }],
        renderSelector: '.c',
        startUrl: '/a',
        notes: 'first\nsecond',
        setupBody: "await adapter.findAndEnter(page, { by: 'text', value: 'Go' });",
        slotBody: "await adapter.press(page, 'Enter');"
    });
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'spec-template-')), 'a.spec.mjs');
    writeFileSync(file, out);
    execFileSync(process.execPath, ['--check', file]);
});

test('output carries no product-specific strings', () => {
    const outs = [
        build({ verifications: ALL_TYPES, fixtures: { '**/api/boot': 'b.json' } }, withBoot(['**/api/boot'])),
        build({ navigationStrategy: 'C2', slotBody: '' }),
        build({ cases: [{ tcName: 'A', verifications: ALL_TYPES }, { tcName: 'B', verifications: base.verifications }] })
    ];
    for (const out of outs) {
        for (const s of ['app/', 'gnb/list', 'STB', 'Native']) assert.ok(!out.includes(s), `found ${s}`);
    }
});

test('DOM text checkpoints keep the on-screen text as the actual value even on failure', () => {
    const out = build({
        verifications: [
            { type: 'DOM', selector: '.toast', condition: "hasText('Failed')" },
            { type: 'DOM', selector: '.a', condition: 'visible' }
        ]
    });
    assert.match(
        out,
        /async \(seen\) => \{\n\s+try \{\n\s+await expect\(adapter\.locator\(page, \{ by: 'css', value: '\.toast' \}\)\)\.toContainText\('Failed'\);\n\s+\} finally \{\n\s+seen\(\(await adapter\.locator\(page, \{ by: 'css', value: '\.toast' \}\)\.allTextContents\(\)\)\.join\(' \| '\)\);/
    );
    assert.match(out, /async \(\) => \{\n\s+await expect\(adapter\.locator\(page, \{ by: 'css', value: '\.a' \}\)\)\.toBeVisible\(\);/);
});

test('DOM not hasText becomes does-not-contain', () => {
    const out = build({ verifications: [{ type: 'DOM', selector: '.toast', condition: "not hasText('Failed')" }] });
    assert.match(out, /\.not\.toContainText\('Failed'\)/);
});

test('setupBody goes before the before-checkpoints and slotBody into the marker slot', () => {
    const out = build({
        renderSelector: '.banner',
        setupBody: "await page.waitForFunction(() => window.ready === true, null, { timeout: 5000 });",
        slotBody: "await adapter.press(page, 'Enter');",
        verifications: [
            { type: 'DOM', selector: '.banner', desc: 'banner before', before: true },
            { type: 'URL', path: 'pathname', condition: "hasText('/detail')" }
        ]
    });
    assert.doesNotMatch(out, /TEST_BODY/);
    const order = ["renderSelector: '.banner'", 'window.ready === true', "cp('cp-01'", "adapter.press(page, 'Enter')", "cp('cp-02'"];
    const at = order.map((s) => out.indexOf(s));
    assert.ok(at.every((i) => i > 0), `missing: ${order.filter((_, i) => at[i] < 0)}`);
    assert.deepEqual([...at].sort((a, b) => a - b), at);
});

test('an empty slotBody leaves no marker; a missing one keeps it', () => {
    assert.doesNotMatch(build({ slotBody: '' }), /TEST_BODY/);
    assert.match(build(), /TEST_BODY/);
});

test('default checkpoint descriptions state the condition in the configured locale', () => {
    const v = [
        { type: 'DOM', selector: '.a' },
        { type: 'DOM', selector: '.c', condition: 'toHaveCount(0)' },
        { type: 'Focus', condition: "includes('m')" }
    ];
    const en = build({ verifications: v });
    assert.match(en, /desc: 'DOM \.a visible'/);
    assert.match(en, /desc: 'DOM \.c toHaveCount\(0\)'/);
    assert.match(en, /desc: 'Focus includes\(\\'m\\'\)'/);
    assert.match(build({ verifications: v }, { ...cfg, locale: 'ko' }), /desc: '포커스 includes\(\\'m\\'\)'/);
});

test('observe checkpoints start the sampler before the slot, wait for the window once, then assert per checkpoint', () => {
    const out = build({
        slotBody: '',
        verifications: [
            { type: 'Observe', selector: '.toast.--up', condition: 'peak toBe(0)', window: 4000 },
            { type: 'Observe', selector: '.toast.--up', condition: "texts not hasText('Deleted')" }
        ]
    });
    assert.match(out, /import \{ test, expect, mockAll, readWatch, watchSelectors, captureFailureDiagnostics, captureNavigationCensus \} from '\.\.\/\.\.\/kit\/index\.js';/);
    assert.ok(out.indexOf("await watchSelectors(page, ['.toast.--up']);") < out.indexOf("cp('cp-01'"));
    assert.equal(out.match(/await readWatch\(page, 4000\);/g).length, 1);
    assert.match(out, /expect\(peak\)\.toBe\(0\);/);
    assert.match(out, /expect\(texts\.join\(' \| '\)\)\.not\.toContain\('Deleted'\);/);
    assert.throws(
        () => build({ verifications: [{ type: 'Observe', selector: '.a', condition: 'visible' }] }),
        /observe condition/
    );
});

test('C2 navigation adds testInfo and the diagnostics import and never isolates', () => {
    const out = build(
        { navigationStrategy: 'C2', fixtures: { '**/api/boot': 'b.json' } },
        withBoot(['**/api/boot'])
    );
    assert.match(out, /async \(\{ page, cp \}, testInfo\)/);
    assert.match(out, /^import \{ test, expect, mockAll, captureFailureDiagnostics, captureNavigationCensus \} from/m);
    assert.doesNotMatch(out, /isolate: true/);
});

test('cases share one file-level beforeEach and get a describe each', () => {
    const out = build({
        cases: [
            { tcName: 'First', verifications: [{ type: 'DOM', selector: '.a' }] },
            { tcName: 'Second', verifications: [{ type: 'DOM', selector: '.b' }], slotBody: '' }
        ]
    });
    assert.equal(out.match(/test\.beforeEach\(/g).length, 1);
    assert.ok(out.indexOf('test.beforeEach(') < out.indexOf("test.describe('First'"));
    assert.match(out, /test\.describe\('Second', \(\) => \{\n {4}test\.setTimeout\(120000\);/);
    assert.equal(out.match(/test\.use\(\{/g).length, 2);
});

test('rejects file names outside the configured prefix or extension', () => {
    assert.throws(() => build({ outputPath: 'e2e/x/tc01.js' }), /\.spec\.js/);
    assert.throws(() => build({}, { ...cfg, e2e: { ...cfg.e2e, specFilePrefix: 'app-' } }), /app-/);
});

test('a focus checkpoint without a condition stops instead of asserting toContain(\'\')', () => {
    assert.throws(() => build({ verifications: [{ type: 'Focus' }] }), /focus condition/);
    assert.throws(() => build({ verifications: [{ type: 'Focus', condition: '  ' }] }), /focus condition/);
});

test('observe checkpoints reject before: true — the window is read after the interaction', () => {
    assert.throws(
        () =>
            build({
                verifications: [
                    { type: 'Observe', selector: '.t', condition: 'peak toBe(0)', before: true },
                    { type: 'Observe', selector: '.t', condition: 'peak toBe(1)' }
                ]
            }),
        /Observe.*before/
    );
});

test('focus rejects the old matches()/hasText() forms instead of asserting on their literal text', () => {
    for (const condition of ["matches('.item')", "hasText('Save')", "not hasText('Save')"]) {
        assert.throws(() => build({ verifications: [{ type: 'Focus', condition }] }), /unknown checkpoint condition/, condition);
    }
    assert.match(build({ verifications: [{ type: 'Focus', condition: 'menu' }] }), /expect\(focusId\)\.toContain\('menu'\);/);
});

test('every spec imports the diagnostics helpers so the body never needs an import edit', async () => {
    const { lint } = await import('../../scripts/spec-lint.mjs');
    for (const input of [{ slotBody: '' }, { slotBody: '', navigationStrategy: 'C2' }]) {
        const out = build({ ...input, verifications: [{ type: 'DOM', selector: '.a' }] });
        assert.match(out, /^import \{ test, expect, mockAll, captureFailureDiagnostics, captureNavigationCensus \} from '\.\.\/\.\.\/kit\/index\.js';$/m);
        // one import per module: consumer lint (import/no-duplicates) rejects a second kit import
        assert.equal(out.match(/from '\.\.\/\.\.\/kit\/index\.js';/g).length, 1);
        const r = lint(out, { fileName: 'tc01-landing.spec.js', cfg });
        assert.equal(r.pass, true, JSON.stringify(r.violations));
    }
});

test('target is an alias of selector for every type, Observe included', () => {
    const observe = (key, extra = {}) => ({ type: 'Observe', [key]: '.toast', condition: 'peak toBe(1)', ...extra });
    assert.equal(build({ verifications: [observe('target')] }), build({ verifications: [observe('selector')] }));
    assert.equal(
        build({ verifications: [{ type: 'DOM', target: '.a' }] }),
        build({ verifications: [{ type: 'DOM', selector: '.a' }] })
    );
    assert.throws(() => build({ verifications: [observe('target', { before: true })] }), /Observe checkpoint \.toast cannot use before/);
});

test('a case with neither a test body nor checkpoints is refused', () => {
    assert.throws(() => buildSpec({ ...base, verifications: [] }, cfg), /^Error: Landing: no checkpoints$/);
    assert.throws(
        () => buildSpec({ ...base, cases: [{ tcName: 'A', verifications: [{ type: 'DOM', selector: '.a', condition: 'toBeVisible()' }] }, { tcName: 'B' }] }, cfg),
        /B: no checkpoints/
    );
    assert.doesNotThrow(() => buildSpec({ ...base, verifications: [], testBody: 'await page.goto(START_URL);' }, cfg));
});
