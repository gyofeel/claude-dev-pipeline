#!/usr/bin/env node
/**
 * spec-template — deterministic Playwright spec assembler.
 *
 * Stamps the whole spec from an input JSON: kit fixture import, test.use({ e2e }) verdict options,
 * describe/setTimeout, beforeEach (mockAll → goto → adapter.waitForAppReady), SUCCESS_CRITERIA and
 * one cp() per checkpoint. The kit fixture owns collector, verdict, report and screenshot, so specs
 * do not repeat them. Only the body slot `// <<< TEST_BODY >>>` is left to spec-writer, and only
 * when no `slotBody` is given. Interaction goes through `adapter.press` / `adapter.findAndEnter`.
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
import { loadConfig, DEFAULTS } from './config-load.mjs';
import { ARTIFACT_LABELS, labelsFor } from '../kit/artifact-labels.mjs';

/** Config for CLI use: --config <json> (tests) or the repo's pipeline.config.json via config-load. */
async function loadConfigCompat({ cwd, configPath }) {
    const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b || {})) o[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v; return o; };
    if (configPath) return { cfg: merge(DEFAULTS, JSON.parse(readFileSync(configPath, 'utf8'))), root: cwd };
    const r = loadConfig(cwd);
    if (!r.ok) throw new Error(`config invalid: ${(r.errors || []).join('; ')}`);
    // repo-relative paths, so kit/adapter imports are computed against the repo-relative outputPath
    return { cfg: merge(DEFAULTS, r.raw), root: r.root };
}

export const INPUT_SCHEMA = {
    tcName: 'string (required) — test title; also TC_NAME',
    outputPath: 'string (required) — repo-relative spec path; must end with .spec.js and start with e2e.specFilePrefix',
    screen: 'string (required; alias domain) — feature/page area shown in the report',
    startUrl: "string (default '/')",
    timeout: 'number ms (default 120000) — test.setTimeout',
    navigationStrategy: "'A' | 'C2' (default 'A') — C2 adds the testInfo param and never isolates",
    renderSelector: 'string | null — target the app must render before the body runs',
    readyExpr: 'string | null — JS boolean the app must satisfy before the body runs',
    fixtures: "{ '<url glob>': '<fixture file | inline object>' } (default {})",
    isolate: 'boolean — default: true when a fixtures pattern is listed in e2e.bootFixtures',
    verifications:
        "[{ type: 'DOM'|'Focus'|'State'|'Runtime'|'URL'|'Popup'|'Observe' (or the locale's tc.cp label), selector? (alias target), path?, condition?, desc?, soft?, before? (not Observe), window? }]",
    successCriteriaText: 'string (alias successCriteria) — success statement shown in the report',
    notes: 'string | string[] | null — header comment lines',
    consoleErrorWhitelist: 'string[] (default [])',
    networkErrorWhitelist: 'string[] (default []) — merged with config e2e.networkNoiseWhitelist',
    navigationPlan: 'object | null — emitted as a comment above the body slot; spec-writer compiles it',
    setupBody: 'string | null — code after the render wait, before the before-checkpoints',
    slotBody: "string | null — code for the body slot; '' means no interaction",
    testBody: 'string | null — whole test body (replaces setupBody, slotBody and checkpoints)',
    cases: '[{ tcName, verifications, successCriteriaText?, setupBody?, slotBody?, testBody?, screen? }] — TCs sharing one entry, one describe each'
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
    `{ by: ${jsStr(t.by)}, value: ${jsStr(t.value)}${t.name ? `, name: ${jsStr(t.name)}` : ''} }`;

const isMatcherCall = (c) => /^(not\.)?to\w+\(.*\)$/.test(c);

// Checkpoint condition → matcher. An unknown value appended as-is would assert nothing, so stop.
const toMatcher = (condition, aliases) => {
    const c = String(condition).trim();
    if (aliases[c]) return aliases[c];
    // containers with several children (toast title + body) never match a whole-text equality
    const text = c.match(/^(not )?hasText\((.*)\)$/);
    if (text) return `${text[1] ? 'not.' : ''}toContainText(${text[2]})`;
    const noClass = c.match(/^not hasClass\s+(\S+)$/);
    if (noClass) return `not.toHaveClass(/${noClass[1]}/)`;
    const re = c.match(/^matches\s+(\/.*\/\w*)$/);
    if (re) return `toMatch(${re[1]})`;
    if (isMatcherCall(c)) return c;
    throw new Error(`unknown checkpoint condition: ${c}`);
};

// For string values (URL parts, popup URL, observed texts): hasText is a locator-only matcher.
const toValueMatcher = (condition) => {
    const c = String(condition).trim();
    const text = c.match(/^(not )?hasText\((.*)\)$/);
    if (text) return `${text[1] ? 'not.' : ''}toContain(${text[2]})`;
    return toMatcher(c, { exists: 'toBeTruthy()' });
};

const URL_PARTS = ['pathname', 'search', 'href'];
const CP_KEYS = { dom: 'DOM', focus: 'Focus', state: 'State', runtime: 'Runtime', url: 'URL', popup: 'Popup', observe: 'Observe' };
const KEY_OF_TYPE = Object.fromEntries(Object.entries(CP_KEYS).map(([k, t]) => [t, k]));
// Every locale's tc.cp label names a type, so a TC written in either locale assembles
const TYPE_OF_LABEL = Object.fromEntries(
    Object.values(ARTIFACT_LABELS).flatMap((l) => Object.entries(CP_KEYS).map(([k, type]) => [l[`tc.cp.${k}`], type]))
);
const typeOf = (v) => {
    const type = TYPE_OF_LABEL[v.type];
    if (!type) throw new Error(`unknown verification type: ${v.type}`);
    return type;
};

const indentCode = (code) => String(code).trim().replace(/^(?=.)/gm, '        ');

const defaultDesc = (v, locale) => {
    const type = typeOf(v);
    const condition = v.condition ?? (type === 'DOM' ? 'visible' : '');
    return [labelsFor(locale)[`tc.cp.${KEY_OF_TYPE[type]}`], v.selector ?? v.path, condition]
        .filter(Boolean)
        .join(' ');
};

const buildSuccessCriteria = (verifications, locale) => {
    if (!verifications?.length) return 'const SUCCESS_CRITERIA = [];';
    const lines = verifications.map((v, i) => `    { id: ${jsStr(cpId(i))}, desc: ${jsStr(v.desc || defaultDesc(v, locale))} }`);
    return `const SUCCESS_CRITERIA = [\n${lines.join(',\n')}\n];`;
};

// verifications[] → cp() blocks; cp records the flag and actual value. `before` checkpoints run ahead of the slot.
const buildVerificationSteps = (verifications, cfg, before = false) => {
    const globalExpr = cfg.ui?.stateBridge?.globalExpr || null;
    const focusExpr = cfg.ui?.stateBridge?.focusExpr || "document.activeElement?.outerHTML.split('>')[0]";
    let settled = false;
    let watched = false;
    return (verifications || [])
        .map((v, i) => {
            if (Boolean(v.before) !== before) return null;
            const id = jsStr(cpId(i));
            const opts = v.soft ? ', { soft: true }' : '';
            const type = typeOf(v);
            if (type === 'URL') {
                if (!URL_PARTS.includes(v.path)) throw new Error(`unknown URL part: ${v.path}`);
                const read = `page.evaluate(() => location.${v.path})`;
                return `        await cp(${id}, async (seen) => {
            await expect.poll(async () => seen(await ${read})).${toValueMatcher(v.condition)};
            return ${read};
        }${opts});`;
            }
            if (type === 'Popup') {
                if (v.path === 'count') {
                    return `        await cp(${id}, async () => {
            await expect.poll(() => popups.length).${toMatcher(v.condition || 'toBe(1)', {})};
            return String(popups.length);
        }${opts});`;
                }
                if (v.path !== 'url') throw new Error(`unknown popup target: ${v.path}`);
                const url = "popups[0]?.url() ?? ''";
                return `        await cp(${id}, async (seen) => {
            await expect.poll(() => seen(${url})).${toValueMatcher(v.condition)};
            return ${url};
        }${opts});`;
            }
            if (type === 'Observe') {
                const c = String(v.condition ?? '').match(/^(peak|texts)\s+(.+)$/);
                if (!c) throw new Error(`unknown observe condition: ${v.condition}`);
                // the window is read once, after the interaction
                if (v.before) throw new Error(`Observe checkpoint ${v.selector} cannot use before: true`);
                // wait for the window once; every observe checkpoint reads the same samples
                const read = watched ? '' : `        const watched = await readWatch(page, ${Number(v.window ?? 3000)});\n\n`;
                watched = true;
                const [value, matcher] =
                    c[1] === 'peak' ? ['peak', toMatcher(c[2], {})] : ["texts.join(' | ')", toValueMatcher(c[2])];
                return `${read}        await cp(${id}, async (seen) => {
            const { peak, texts } = watched[${jsStr(v.selector)}] ?? { peak: 0, texts: [] };
            seen(\`peak \${peak} · \${texts.join(' | ')}\`);
            expect(${value}).${matcher};
        }${opts});`;
            }
            if (type === 'DOM') {
                const loc = `adapter.locator(page, ${targetLiteral(parseTarget(v.selector))})`;
                const matcher = toMatcher(v.condition || 'visible', { visible: 'toBeVisible()', hidden: 'toBeHidden()' });
                // expected text is often a guess, so keep what the screen showed even when it fails
                if (/hasText\(/.test(v.condition ?? '')) {
                    return `        await cp(${id}, async (seen) => {
            try {
                await expect(${loc}).${matcher};
            } finally {
                seen((await ${loc}.allTextContents()).join(' | '));
            }
        }${opts});`;
                }
                return `        await cp(${id}, async () => {
            await expect(${loc}).${matcher};
        }${opts});`;
            }
            if (type === 'Focus') {
                const c = String(v.condition || v.path || '').trim();
                if (!c) throw new Error('empty focus condition — toContain(\'\') would always pass');
                const included = c.match(/^includes\((.*)\)$/);
                // a call-shaped condition (matches(), hasText()) would otherwise be asserted as literal text
                if (!included && !isMatcherCall(c) && /^(not\s+)?\w+\(.*\)$/.test(c)) throw new Error(`unknown checkpoint condition: ${c}`);
                const matcher = included ? `toContain(${included[1]})` : isMatcherCall(c) ? c : `toContain(${jsStr(c)})`;
                return `        await cp(${id}, async () => {
            const focusId = await page.evaluate(() => String(${focusExpr} ?? ''));
            expect(focusId).${matcher};
            return focusId;
        }${opts});`;
            }
            if (type === 'Runtime') {
                const kind = v.path;
                const condition = String(v.condition || 'isEmpty').trim();
                const below = condition.match(/^filteredCount\s*<\s*(\d+)$/);
                if (!['consoleErrors', 'networkErrors'].includes(kind)) throw new Error(`unknown runtime target: ${kind}`);
                if (!below && condition !== 'isEmpty') throw new Error(`unknown checkpoint condition: ${condition}`);
                // counting right after a transition misses errors from late responses
                const settle = settled ? '' : '        await collector.settle();\n\n';
                settled = true;
                const assertion = below
                    ? `expect(${kind}.length).toBeLessThan(${below[1]});`
                    : `expect(${kind}.map((e) => ${kind === 'networkErrors' ? 'e.url' : 'e.text ?? e.url'})).toEqual([]);`;
                return `${settle}        await cp(${id}, async () => {
            const { ${kind} } = runtimeErrors(collector, {
                consoleErrorWhitelist: CONSOLE_ERROR_WHITELIST,
                networkErrorWhitelist: NETWORK_ERROR_WHITELIST
            });
            ${assertion}
            return String(${kind}.length);
        }${opts});`;
            }
            if (!globalExpr) throw new Error(`State verification "${v.path}" requires ui.stateBridge.globalExpr in config`);
            const matcher = toMatcher(v.condition || 'truthy', {
                truthy: 'toBeTruthy()',
                falsy: 'toBeFalsy()',
                exists: 'not.toBeNull()'
            });
            return `        await cp(${id}, async (seen) => {
            const stateVal = seen(await page.evaluate(() => ${globalExpr}?.${String(v.path).split('.').join('?.')} ?? null)); // @state-path ${v.path}
            expect(stateVal).${matcher};
            return stateVal;
        }${opts});`;
        })
        .filter(Boolean)
        .join('\n\n');
};

const relImport = (fromDir, toFile) => {
    let r = path.posix.relative(fromDir.split(path.sep).join('/'), toFile.split(path.sep).join('/'));
    if (!r.startsWith('.')) r = `./${r}`;
    return r;
};

export const buildSpec = (input, cfg = DEFAULTS) => {
    const {
        tcName,
        outputPath,
        startUrl = '/',
        timeout = 120000,
        navigationStrategy = 'A',
        renderSelector = null,
        readyExpr = null,
        consoleErrorWhitelist = [],
        networkErrorWhitelist = [],
        fixtures = {},
        verifications = [],
        notes = null,
        navigationPlan = null,
        cases = null
    } = input;
    const screen = input.screen ?? input.domain;
    const e2e = cfg.e2e || {};
    const locale = cfg.locale || 'en';

    // cases[]: TCs sharing one entry (START_URL, fixtures, render wait) → one describe each
    const caseList = (
        Array.isArray(cases) && cases.length
            ? cases
            : [
                  {
                      tcName,
                      screen,
                      verifications,
                      successCriteriaText: input.successCriteriaText ?? input.successCriteria,
                      setupBody: input.setupBody,
                      slotBody: input.slotBody,
                      testBody: input.testBody
                  }
              ]
    ).map((c) => ({ ...c, verifications: (c.verifications || []).map((v) => ({ ...v, selector: v.selector ?? v.target })) }));
    const isMulti = caseList.length > 1;
    const primaryName = tcName ?? caseList[0].tcName;
    if (!primaryName || !outputPath || !screen) throw new Error('missing required fields: tcName (or cases[0].tcName), outputPath, screen');
    for (const c of caseList) if (!c.tcName) throw new Error('cases[] entry without tcName');
    // a spec with nothing to assert passes on whatever screen it lands
    for (const c of caseList) if (!c.testBody && !c.verifications.length) throw new Error(`${c.tcName}: no checkpoints`);

    const fileName = path.basename(outputPath);
    const prefix = e2e.specFilePrefix || '';
    if (!fileName.endsWith('.spec.js')) throw new Error(`outputPath must end with .spec.js: ${fileName}`);
    if (prefix && !fileName.startsWith(prefix)) throw new Error(`outputPath file name must start with "${prefix}": ${fileName}`);
    if (timeout < 60000) throw new Error('timeout must be >= 60000');

    const isC2 = navigationStrategy === 'C2';
    // isolating without the boot fixtures answers the app's boot calls with {} and it never starts
    const bootFixtures = e2e.bootFixtures || [];
    const isolated = !isC2 && (input.isolate ?? Object.keys(fixtures).some((k) => bootFixtures.includes(k)));

    const checked = caseList.flatMap((c) => (c.testBody ? [] : c.verifications || []));
    const cpTypes = new Set(checked.map(typeOf));
    const usesRuntime = cpTypes.has('Runtime');
    const usesPopup = cpTypes.has('Popup');
    const watchList = [...new Set(checked.filter((v) => typeOf(v) === 'Observe').map((v) => v.selector))];

    const outDir = path.dirname(outputPath);
    const kitNames = ['test', 'expect', 'mockAll'];
    if (usesRuntime) kitNames.push('runtimeErrors');
    if (watchList.length) kitNames.push('readWatch', 'watchSelectors');
    // always imported: the body slot may call them, and the assembled file is never hand-edited
    kitNames.push('captureFailureDiagnostics', 'captureNavigationCensus');
    const imports = [
        `import { ${kitNames.join(', ')} } from ${jsStr(relImport(outDir, path.posix.join(e2e.kitDir || 'e2e/kit', 'index.js')))};`,
        `import adapter from ${jsStr(relImport(outDir, e2e.adapterModule || 'e2e/e2e.adapter.js'))};`
    ];

    const header = [`// ${fileName}`];
    if (isMulti) {
        header.push(`// ${caseList.map((c) => c.tcName).join(' · ')}`);
        header.push('// TCs sharing one entry — run one: npx playwright test <this file> --grep "<TC name>"');
    } else header.push(`// ${primaryName}`);
    if (notes) {
        [notes].flat().join('\n').split('\n').forEach((line, i) => header.push(`// ${i ? '' : 'notes: '}${line}`));
    }

    const fixtureKeys = Object.keys(fixtures);
    const mockArg = fixtureKeys.length
        ? `{\n${fixtureKeys
              .map((k) => `            ${jsStr(k)}: ${typeof fixtures[k] === 'string' ? jsStr(fixtures[k]) : JSON.stringify(fixtures[k])}`)
              .join(',\n')}\n        }`
        : '{}';
    const readyOpts = [];
    if (renderSelector) readyOpts.push(`renderSelector: ${jsStr(renderSelector)}`);
    if (readyExpr) readyOpts.push(`readyExpr: ${jsStr(readyExpr)}`);
    const readyCall = `await adapter.waitForAppReady(page${readyOpts.length ? `, { ${readyOpts.join(', ')} }` : ''});`;

    const preBody = [
        watchList.length &&
            `        // start sampling before the interaction so short-lived elements are caught
        await watchSelectors(page, ${jsArray(watchList)});`,
        usesPopup &&
            `        // listen before the interaction so late windows are counted too
        const popups = [];
        page.on('popup', (popup) => popups.push(popup));
        // a popup event fires only after its first navigation; external hosts may be unreachable here
        const appOrigin = new URL(page.url()).origin;
        await page
            .context()
            .route('**/*', (route) =>
                route.request().isNavigationRequest() &&
                !route.request().url().startsWith(appOrigin)
                    ? route.fulfill({ contentType: 'text/html', body: '' })
                    : route.fallback()
            );`
    ].filter(Boolean);

    const planComment = navigationPlan
        ? `        /* navigationPlan (compile per references/navigation-plan.md):\n${JSON.stringify(navigationPlan, null, 2)
              .split('\n')
              .map((l) => `           ${l}`)
              .join('\n')}\n        */\n`
        : '';

    const params = usesRuntime ? '{ page, cp, collector }' : '{ page, cp }';
    const testParam = isC2 ? `${params}, testInfo` : params;

    const bodyOf = (c) => {
        if (c.testBody) return c.testBody;
        const head = [
            ...preBody,
            c.setupBody && indentCode(c.setupBody),
            buildVerificationSteps(c.verifications, cfg, true)
        ].filter(Boolean);
        // slotBody '' means "no interaction", so no marker is left behind
        const slot = c.slotBody == null ? `${planComment}${BODY_MARKER}` : indentCode(c.slotBody);
        return [...head, slot, buildVerificationSteps(c.verifications, cfg)].filter(Boolean).join('\n\n');
    };

    const beforeEachBody = `        await mockAll(page, ${mockArg}, { isolate: ${isolated} });

        await page.goto(START_URL, { waitUntil: 'domcontentloaded' });
        ${readyCall}`;

    const useBlock = (c) => `test.use({
    e2e: {
        tcName: TC_NAME,
        screen: ${jsStr(c.screen ?? screen)},
        testMode: ${isolated ? "'fixture'" : "'real-api'"},
        successCriteria: SUCCESS_CRITERIA,
        successCriteriaText: ${jsStr(c.successCriteriaText ?? '')},
        consoleErrorWhitelist: CONSOLE_ERROR_WHITELIST,
        networkErrorWhitelist: NETWORK_ERROR_WHITELIST
    }
});`;

    const indent = (s) => s.replace(/^(?=.)/gm, '    ');
    const network = [...(e2e.networkNoiseWhitelist || []), ...networkErrorWhitelist];

    const sharedHead = `${header.join('\n')}

${imports.join('\n')}

${isMulti ? '' : `const TC_NAME = ${jsStr(primaryName)};\n`}const START_URL = ${jsStr(startUrl)};

const CONSOLE_ERROR_WHITELIST = ${jsArray(consoleErrorWhitelist)};
const NETWORK_ERROR_WHITELIST = ${jsArray(network)};
`;

    if (!isMulti) {
        const c = caseList[0];
        return `${sharedHead}
${buildSuccessCriteria(c.verifications, locale)}

${useBlock(c)}

test.describe(TC_NAME, () => {
    test.setTimeout(${Number(timeout)});

    test.beforeEach(async ({ page }) => {
${beforeEachBody}
    });

    test(TC_NAME, async (${testParam}) => {
${bodyOf(c)}
    });
});
`;
    }

    const caseBlocks = caseList.map(
        (c) => `test.describe(${jsStr(c.tcName)}, () => {
    test.setTimeout(${Number(timeout)});

    const TC_NAME = ${jsStr(c.tcName)};

${indent(buildSuccessCriteria(c.verifications, locale))}

${indent(useBlock(c))}

    test(TC_NAME, async (${testParam}) => {
${bodyOf(c)}
    });
});`
    );

    return `${sharedHead}
test.beforeEach(async ({ page }) => {
${beforeEachBody.replace(/^ {4}/gm, '')}
});

${caseBlocks.join('\n\n')}
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
