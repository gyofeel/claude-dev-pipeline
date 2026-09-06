#!/usr/bin/env node
/**
 * spec-template — deterministic Playwright spec skeleton assembler.
 *
 * Generates everything except the body slot `// <<< TEST_BODY >>>` from an input JSON,
 * so the mechanical structure (imports, describe/setTimeout, beforeEach/afterEach,
 * declarations, verifications → SUCCESS_CRITERIA + test.step/expect) is identical no
 * matter which model drives spec-writer. See references/adapter-contract.md.
 *
 * Usage:
 *   node spec-template.mjs <input.json> [--config <pipeline.config.json>] [--write] [--cwd <repoRoot>]
 *   echo '<json>' | node spec-template.mjs
 *   node spec-template.mjs --help
 *
 * Output: generated spec source on stdout; with --write also saved to input.outputPath.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { readFileSync as _rf } from 'node:fs';
import { loadConfig, DEFAULTS } from './config-load.mjs';

/** Config for CLI use: --config <json> (tests) or the repo's pipeline.config.json via config-load. */
async function loadConfigCompat({ cwd, configPath }) {
    if (configPath) {
        const raw = JSON.parse(_rf(configPath, 'utf8'));
        const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b || {})) o[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v; return o; };
        return { cfg: merge(DEFAULTS, raw), root: cwd };
    }
    const r = loadConfig(cwd);
    if (!r.ok) throw new Error(`config invalid: ${(r.errors || []).join('; ')}`);
    return { cfg: r.resolved, root: r.root };
}

export const INPUT_SCHEMA = {
    tcName: 'string (required) — test title; also TC_NAME',
    outputPath: 'string (required) — repo-relative spec path; must end with .spec.js and start with e2e.specFilePrefix',
    screen: 'string (required) — feature/page area, passed to analyze() as domain',
    startUrl: "string (default '/')",
    timeout: 'number ms (default 120000) — test.setTimeout',
    renderSelector: 'string | null — CSS the app must render before the body runs',
    readyExpr: 'string | null — JS boolean the app must satisfy before the body runs (TC render condition of kind expr); overrides config e2e.readyExpr for this spec',
    fixtures: "{ '<url glob>': '<fixture file | inline object>' } (default {})",
    verifications: "[{ type: 'DOM'|'Focus'|'State'|'Runtime', target?: string, path?: string, condition: string, desc?: string }]",
    successCriteria: 'string — natural-language success statement for analyze()',
    acceptanceCriteria: 'string | null — extra scenario sentence for analyze()',
    notes: 'string | null — header comment',
    consoleErrorWhitelist: 'string[] (default [])',
    networkErrorWhitelist: 'string[] (default []) — merged with config e2e.networkNoiseWhitelist',
    acceptableStatuses: "string[] (default ['PASS'])",
    navigationPlan: 'object | null — emitted as a comment above the body slot; spec-writer compiles it',
    liveData: 'boolean — adds the @live-data header comment and disables request isolation',
    testBody: 'string | null — replaces the body slot when given (rare; used by selfcheck)'
};

const BODY_MARKER = '        // <<< TEST_BODY >>> — spec-writer fills navigation / interaction logic here.';

const jsStr = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const jsArray = (arr) => `[${(arr || []).map(jsStr).join(', ')}]`;
const cpId = (i) => `cp-${String(i + 1).padStart(2, '0')}`;

/** 'testid:x' | 'role:button[Save]' | 'text:Hello' | '.css' → target descriptor literal */
export const parseTarget = (raw) => {
    const s = String(raw).trim();
    let m;
    if ((m = s.match(/^testid:(.+)$/))) return { by: 'testid', value: m[1].trim() };
    if ((m = s.match(/^role:([\w-]+)(?:\[(.*)\])?$/))) {
        const t = { by: 'role', value: m[1] };
        if (m[2]) t.name = m[2];
        return t;
    }
    if ((m = s.match(/^text:(.+)$/))) return { by: 'text', value: m[1].trim() };
    if ((m = s.match(/^css:(.+)$/))) return { by: 'css', value: m[1].trim() };
    return { by: 'css', value: s };
};

const targetLiteral = (t) =>
    `{ by: ${jsStr(t.by)}, value: ${jsStr(t.value)}${t.name ? `, name: ${jsStr(t.name)}` : ''}${
        t.nth != null ? `, nth: ${Number(t.nth)}` : ''
    } }`;

const stateAccessor = (globalExpr, p) => `${globalExpr}?.${String(p).split('.').join('?.')}`;

const defaultDesc = (v) => {
    if (v.type === 'DOM') return `${v.target} — ${v.condition || 'visible'}`;
    if (v.type === 'Focus') return `focus ${v.condition || ''}`.trim();
    if (v.type === 'State') return `${v.path} ${v.condition || 'truthy'}`;
    if (v.type === 'Runtime') return `runtime ${v.condition || 'noConsoleErrors'}`;
    return 'checkpoint';
};

// ── condition compilers ─────────────────────────────────────
const domMatcher = (cond) => {
    const c = (cond || 'visible').trim();
    let m;
    if (c === 'visible') return { expect: 'toBeVisible()', not: false };
    if (c === 'hidden') return { expect: 'toBeHidden()', not: false };
    if ((m = c.match(/^hasText\((.+)\)$/))) return { expect: `toHaveText(${m[1]})`, not: false };
    if ((m = c.match(/^not hasClass\((.+)\)$/))) return { expect: `toHaveClass(new RegExp(${m[1]}))`, not: true };
    if ((m = c.match(/^hasClass\((.+)\)$/))) return { expect: `toHaveClass(new RegExp(${m[1]}))`, not: false };
    if ((m = c.match(/^count\((\d+)\)$/))) return { expect: `toHaveCount(${m[1]})`, not: false };
    throw new Error(`DOM condition not supported: ${c}`);
};

const stateMatcher = (cond) => {
    const c = (cond || 'truthy').trim();
    let m;
    if (c === 'truthy') return { expect: 'toBeTruthy()', passed: (v) => `!!${v}` };
    if (c === 'falsy') return { expect: 'toBeFalsy()', passed: (v) => `!${v}` };
    if ((m = c.match(/^toBe\((.+)\)$/))) return { expect: `toBe(${m[1]})`, passed: (v) => `${v} === ${m[1]}` };
    if ((m = c.match(/^toEqual\((.+)\)$/)))
        return { expect: `toEqual(${m[1]})`, passed: (v) => `JSON.stringify(${v}) === JSON.stringify(${m[1]})` };
    if ((m = c.match(/^matches\s*(\/.+\/[a-z]*)$/))) return { expect: `toMatch(${m[1]})`, passed: (v) => `${m[1]}.test(String(${v}))` };
    if ((m = c.match(/^length\((\d+)\)$/))) return { expect: `toHaveLength(${m[1]})`, passed: (v) => `${v}?.length === ${m[1]}` };
    throw new Error(`State condition not supported: ${c}`);
};

const focusCheck = (cond) => {
    const c = (cond || '').trim();
    let m;
    if ((m = c.match(/^matches\((.+)\)$/))) return `focusInfo.matches(${m[1]})`;
    if ((m = c.match(/^hasText\((.+)\)$/))) return `focusInfo.text.includes(${m[1]})`;
    if ((m = c.match(/^includes\((.+)\)$/))) return `focusInfo.id.includes(${m[1]})`;
    throw new Error(`Focus condition not supported: ${c}`);
};

const runtimeCheck = (cond) => {
    const c = (cond || 'noConsoleErrors').trim();
    let m;
    if (c === 'noConsoleErrors' || c === 'isEmpty') return '(runtime.consoleErrors ?? []).length === 0';
    if (c === 'noNetworkErrors') return '(runtime.networkErrors ?? []).length === 0';
    if ((m = c.match(/^consoleErrors\s*<\s*(\d+)$/))) return `(runtime.consoleErrors ?? []).length < ${m[1]}`;
    if ((m = c.match(/^filteredCount\s*<\s*(\d+)$/))) return `(runtime.consoleErrors ?? []).length < ${m[1]}`;
    throw new Error(`Runtime condition not supported: ${c}`);
};

const buildSuccessCriteria = (verifications) =>
    `const SUCCESS_CRITERIA = [\n${verifications
        .map((v, i) => `    { id: ${jsStr(cpId(i))}, desc: ${jsStr(v.desc || defaultDesc(v))}, passed: false }`)
        .join(',\n')}\n];`;

const buildSteps = (verifications, cfg) => {
    const globalExpr = cfg.ui?.stateBridge?.globalExpr || null;
    const focusExpr = cfg.ui?.stateBridge?.focusExpr || null;
    return verifications
        .map((v, i) => {
            const id = cpId(i);
            const title = jsStr(`${id}: ${v.desc || defaultDesc(v)}`);
            if (v.type === 'DOM') {
                const t = parseTarget(v.target);
                const { expect: mt, not } = domMatcher(v.condition);
                return `        await test.step(${title}, async () => {
            await expect(adapter.locator(page, ${targetLiteral(t)}))${not ? '.not' : ''}.${mt};
            SUCCESS_CRITERIA[${i}].passed = true;
        });`;
            }
            if (v.type === 'Focus') {
                const check = focusCheck(v.condition);
                const testId = cfg.ui?.testIdAttribute || 'data-testid';
                // the check runs inside the page: matches() needs the live element.
                const inPage = focusExpr
                    ? `await page.evaluate(() => { const id = String(${focusExpr} ?? ''); const focusInfo = { id, text: id, matches: () => false }; return ${check}; })`
                    : `await page.evaluate(() => { const el = document.activeElement; const focusInfo = { id: el?.id || el?.getAttribute(${jsStr(testId)}) || '', text: el?.textContent?.trim() || '', matches: (sel) => !!el && el.matches(sel) }; return ${check}; })`;
                return `        await test.step(${title}, async () => {
            const focused = ${inPage};
            expect(focused).toBe(true);
            SUCCESS_CRITERIA[${i}].passed = focused;
        });`;
            }
            if (v.type === 'State') {
                if (!globalExpr) throw new Error(`State verification "${v.path}" requires ui.stateBridge.globalExpr in config`);
                const { expect: mt, passed } = stateMatcher(v.condition);
                return `        await test.step(${title}, async () => {
            const stateVal = await page.evaluate(() => ${stateAccessor(globalExpr, v.path)} ?? null); // @state-path ${v.path}
            expect(stateVal).${mt};
            SUCCESS_CRITERIA[${i}].passed = ${passed('stateVal')};
        });`;
            }
            if (v.type === 'Runtime') {
                return `        await test.step(${title}, async () => {
            const raw = await collector.collect();
            // apply the same whitelists afterEach uses, so in-body checks and the verdict agree
            const runtime = {
                ...raw,
                consoleErrors: (raw.consoleErrors ?? []).filter(
                    (e) => !CONSOLE_ERROR_WHITELIST.some((p) => e.text?.includes(p)) && !NETWORK_ERROR_WHITELIST.some((p) => e.url?.includes(p))
                ),
                networkErrors: (raw.networkErrors ?? []).filter((e) => !NETWORK_ERROR_WHITELIST.some((p) => e.url?.includes(p)))
            };
            const ok = ${runtimeCheck(v.condition)};
            expect(ok).toBe(true);
            SUCCESS_CRITERIA[${i}].passed = ok;
        });`;
            }
            throw new Error(`Unknown verification type: ${v.type}`);
        })
        .join('\n\n');
};

const relImport = (fromDir, toFile) => {
    let r = path.posix.relative(fromDir.split(path.sep).join('/'), toFile.split(path.sep).join('/'));
    if (!r.startsWith('.')) r = `./${r}`;
    return r;
};

export const buildSpec = (input, cfg) => {
    const {
        tcName,
        outputPath,
        screen,
        startUrl = '/',
        timeout = 120000,
        renderSelector = null,
        readyExpr = null,
        fixtures = {},
        verifications = [],
        successCriteria = '',
        acceptanceCriteria = null,
        notes = null,
        consoleErrorWhitelist = [],
        networkErrorWhitelist = [],
        acceptableStatuses = ['PASS'],
        navigationPlan = null,
        liveData = false,
        testBody = null
    } = input;
    if (!tcName || !outputPath || !screen) throw new Error('missing required fields: tcName, outputPath, screen');

    const e2e = cfg.e2e || {};
    const fileName = path.basename(outputPath);
    const prefix = e2e.specFilePrefix || '';
    if (!fileName.endsWith('.spec.js')) throw new Error(`outputPath must end with .spec.js: ${fileName}`);
    if (prefix && !fileName.startsWith(prefix)) throw new Error(`outputPath file name must start with "${prefix}": ${fileName}`);
    if (timeout < 60000) throw new Error('timeout must be >= 60000');

    const outDir = path.dirname(outputPath);
    const kitImport = relImport(outDir, path.posix.join(e2e.kitDir || 'e2e/kit', 'index.js'));
    const adapterImport = relImport(outDir, e2e.adapterModule || 'e2e/e2e.adapter.js');

    const header = [`// ${fileName}`, `// ${tcName}`];
    if (liveData) header.push('// @live-data — depends on live API data; consider excluding from CI');
    if (notes) header.push(`// notes: ${notes}`);

    const fixtureKeys = Object.keys(fixtures);
    const mockArg = fixtureKeys.length
        ? `{\n${fixtureKeys
              .map((k) => `            ${jsStr(k)}: ${typeof fixtures[k] === 'string' ? jsStr(fixtures[k]) : JSON.stringify(fixtures[k])}`)
              .join(',\n')}\n        }`
        : '{}';
    const readyOpts = [];
    if (renderSelector) readyOpts.push(`renderSelector: ${jsStr(renderSelector)}`);
    if (readyExpr) readyOpts.push(`readyExpr: ${jsStr(readyExpr)}`);
    const readyArg = readyOpts.length ? `{ ${readyOpts.join(', ')} }` : '{}';

    const planComment = navigationPlan
        ? `        /* navigationPlan (compile per references/navigation-plan.md):\n${JSON.stringify(navigationPlan, null, 2)
              .split('\n')
              .map((l) => `           ${l}`)
              .join('\n')}\n        */\n`
        : '';
    const steps = buildSteps(verifications, cfg);
    const body = testBody ?? `${planComment}${BODY_MARKER}\n\n${steps}`;
    const network = [...(e2e.networkNoiseWhitelist || []), ...networkErrorWhitelist];

    return `${header.join('\n')}

import { test, expect } from '@playwright/test';
import { mockAll, RuntimeCollector, analyze, attachAnalysisToReport } from ${jsStr(kitImport)};
import adapter from ${jsStr(adapterImport)};

const TC_NAME = ${jsStr(tcName)};
const START_URL = ${jsStr(startUrl)};
const SCREEN = ${jsStr(screen)};

const CONSOLE_ERROR_WHITELIST = ${jsArray(consoleErrorWhitelist)};
const NETWORK_ERROR_WHITELIST = ${jsArray(network)};
const ACCEPTABLE_STATUSES = ${jsArray(acceptableStatuses)};

${buildSuccessCriteria(verifications)}

let collector = null;

test.describe(${jsStr(tcName)}, () => {
    test.setTimeout(${Number(timeout)});

    test.beforeEach(async ({ page }) => {
        for (const criterion of SUCCESS_CRITERIA) {
            criterion.passed = false;
        }

        collector = new RuntimeCollector(page);
        await collector.start();

        await mockAll(page, ${mockArg}, { isolate: ${liveData ? 'false' : 'true'} });

        await page.goto(START_URL, { waitUntil: 'domcontentloaded' });
        await adapter.waitForAppReady(page, ${readyArg});
    });

    test(${jsStr(tcName)}, async ({ page }, testInfo) => {
${body}
    });

    test.afterEach(async ({ page }, testInfo) => {
        if (!collector) return;

        let runtimeData = await collector.collect();

        const allConsoleErrors = runtimeData.consoleErrors ?? [];
        const filteredErrors = allConsoleErrors.filter((e) => {
            const byText = CONSOLE_ERROR_WHITELIST.some((p) => e.text?.includes(p));
            const byUrl = NETWORK_ERROR_WHITELIST.some((p) => e.url?.includes(p));
            return !byText && !byUrl;
        });
        runtimeData = { ...runtimeData, consoleErrors: filteredErrors };
        const whitelistedErrors = {
            patterns: CONSOLE_ERROR_WHITELIST,
            filteredCount: allConsoleErrors.length - filteredErrors.length,
            remainingCount: filteredErrors.length
        };

        const allNetworkErrors = runtimeData.networkErrors ?? [];
        const filteredNetworkErrors = NETWORK_ERROR_WHITELIST.length
            ? allNetworkErrors.filter((e) => !NETWORK_ERROR_WHITELIST.some((p) => e.url?.includes(p)))
            : allNetworkErrors;
        runtimeData = { ...runtimeData, networkErrors: filteredNetworkErrors };
        const whitelistedNetworkErrors = {
            patterns: NETWORK_ERROR_WHITELIST,
            filteredCount: allNetworkErrors.length - filteredNetworkErrors.length,
            remainingCount: filteredNetworkErrors.length
        };

        const analysisResult = await analyze(runtimeData, {
            testName: TC_NAME,
            domain: SCREEN,
            testMode: ${liveData ? "'live-data'" : "'fixture'"},
            successCriteria: ${jsStr(successCriteria)},${acceptanceCriteria ? `\n            scenario: ${jsStr(acceptanceCriteria)},` : ''}
            acceptableStatuses: ACCEPTABLE_STATUSES,
            whitelistedErrors,
            whitelistedNetworkErrors,
            acceptanceCriteria: SUCCESS_CRITERIA
        });

        attachAnalysisToReport(testInfo, analysisResult, runtimeData, SUCCESS_CRITERIA);

        if (testInfo.status === 'failed' || analysisResult.status === 'FAIL') {
            const failureShot = await page.screenshot().catch(() => null);
            if (failureShot) {
                await testInfo.attach('failure-screenshot', { body: failureShot, contentType: 'image/png' });
            }
        }

        const screenshot = await page.screenshot().catch(() => null);
        if (screenshot) {
            await testInfo.attach('screenshot', { body: screenshot, contentType: 'image/png' });
        }

        if (!analysisResult.analysisError && !ACCEPTABLE_STATUSES.includes(analysisResult.status)) {
            throw new Error(
                \`[\${TC_NAME}] analysis status: \${analysisResult.status}\\n\` +
                    \`Issues:\\n\${analysisResult.issues?.map((i) => \`  - \${i}\`).join('\\n') || 'none'}\`
            );
        }
    });
});
`;
};

// ── CLI ─────────────────────────────────────────────────────
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
    const argv = process.argv.slice(2);
    if (argv.includes('--help')) {
        console.log(JSON.stringify({ usage: 'node spec-template.mjs <input.json> [--config <path>] [--write] [--cwd <root>]', input: INPUT_SCHEMA }, null, 2));
        process.exit(0);
    }
    const opt = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);
    const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--config' && argv[i - 1] !== '--cwd');
    try {
        const input = JSON.parse(positional[0] ? readFileSync(positional[0], 'utf8') : readFileSync(0, 'utf8'));
        const { cfg, root } = await loadConfigCompat({ cwd: opt('--cwd') || process.cwd(), configPath: opt('--config') });
        const src = buildSpec(input, cfg);
        if (argv.includes('--write')) {
            const abs = path.isAbsolute(input.outputPath) ? input.outputPath : path.join(root, input.outputPath);
            mkdirSync(path.dirname(abs), { recursive: true });
            writeFileSync(abs, src);
        }
        process.stdout.write(src);
    } catch (e) {
        process.stderr.write(`[spec-template] ${e.message}\n`);
        process.exit(1);
    }
}
