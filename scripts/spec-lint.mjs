#!/usr/bin/env node
/**
 * spec-lint — deterministic rule checker for generated Playwright specs (model-independent gate).
 *
 * Rules 1–20 are the contract shared with the spec-writer / spec-reviewer agents.
 * Rules 16 and 17 are context-dependent and left to the reviewer (llmResidual).
 *
 * Usage: node spec-lint.mjs <spec.js> [--config <pipeline.config.json>] [--cwd <root>]
 * Output (stdout): { pass, violations: [{ rule, severity, line, message, fix }], llmResidual: [{ rule, note }] }
 * Exit code is always 0 — callers read `pass`.
 */

import { readFileSync } from 'node:fs';
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
    if (!r.ok) {
        // Lint needs config only for rules 9/14/18; run with defaults rather than refusing.
        console.error(`[spec-lint] config unavailable (${(r.errors || []).join('; ')}) — using defaults`);
        return { cfg: DEFAULTS, root: r.root || cwd };
    }
    return { cfg: r.resolved, root: r.root };
}

const SEV = { CRITICAL: 'Critical', ERROR: 'Error', WARNING: 'Warning' };

export const LLM_RESIDUAL = [
    { rule: 16, note: 'no fixed sleeps (waitForTimeout) right after an interaction — wait on a condition instead' },
    { rule: 17, note: 'soft-track applied to assertions touching e2e.softTrack.patterns; navigation plan compiled faithfully' }
];

const lineOf = (src, i) => (i < 0 ? null : src.slice(0, i).split('\n').length);

/** Split call arguments at top-level commas, ignoring strings/comments. openParen = index of '('. */
export const extractArgs = (src, openParen) => {
    let depth = 0, inStr = null, line = false, block = false, start = openParen + 1;
    const args = [];
    for (let i = openParen; i < src.length; i++) {
        const c = src[i], n = src[i + 1];
        if (line) { if (c === '\n') line = false; continue; }
        if (block) { if (c === '*' && n === '/') { block = false; i++; } continue; }
        if (inStr) { if (c === '\\') { i++; continue; } if (c === inStr) inStr = null; continue; }
        if (c === '/' && n === '/') { line = true; i++; continue; }
        if (c === '/' && n === '*') { block = true; i++; continue; }
        if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
        if (c === '(' || c === '[' || c === '{') { depth++; continue; }
        if (c === ')' || c === ']' || c === '}') {
            depth--;
            if (depth === 0) {
                args.push(src.slice(start, i));
                return args.map((a) => a.trim()).filter((a, idx, arr) => !(idx === arr.length - 1 && a === ''));
            }
            continue;
        }
        if (c === ',' && depth === 1) { args.push(src.slice(start, i)); start = i + 1; }
    }
    return null;
};

export const lint = (src, { fileName = '', cfg = {} } = {}) => {
    const v = [];
    const add = (rule, severity, idx, message, fix) => v.push({ rule, severity, line: lineOf(src, idx), message, fix });
    const e2e = cfg.e2e || {};

    // 1 afterEach
    if (!src.includes('test.afterEach(')) add(1, SEV.ERROR, -1, 'test.afterEach block missing', 'add test.afterEach');
    // 2 guard
    if (!/if\s*\(\s*!collector\s*\)\s*return\s*;/.test(src)) add(2, SEV.ERROR, -1, 'afterEach guard missing', 'first line: if (!collector) return;');
    // 3 expect when criteria exist
    const critMatch = src.match(/const SUCCESS_CRITERIA\s*=\s*\[([\s\S]*?)\];/);
    const critCount = critMatch ? (critMatch[1].match(/\bid:/g) || []).length : 0;
    if (critCount > 0 && !/\bexpect\s*\(/.test(src)) add(3, SEV.ERROR, -1, 'SUCCESS_CRITERIA declared but no expect( call', 'assert each checkpoint with expect()');
    // 4, 5
    if (!src.includes('const CONSOLE_ERROR_WHITELIST')) add(4, SEV.ERROR, -1, 'const CONSOLE_ERROR_WHITELIST missing', 'declare it');
    if (!src.includes('const ACCEPTABLE_STATUSES')) add(5, SEV.ERROR, -1, 'const ACCEPTABLE_STATUSES missing', 'declare it');
    // 6
    if (!src.includes('analysisResult.issues')) add(6, SEV.ERROR, -1, 'throw message does not reference analysisResult.issues', 'include issues in the error');
    // 7
    if (!src.replace(/\s+/g, ' ').includes("testInfo.status === 'failed' || analysisResult.status === 'FAIL'"))
        add(7, SEV.ERROR, -1, 'failure screenshot condition missing', "use if (testInfo.status === 'failed' || analysisResult.status === 'FAIL')");
    // 8
    const tcId = src.indexOf('const TC_ID');
    if (tcId >= 0) add(8, SEV.ERROR, tcId, 'const TC_ID is forbidden', 'use TC_NAME only');
    // 9 file name
    const prefix = e2e.specFilePrefix || '';
    if (prefix && fileName && !(fileName.startsWith(prefix) && fileName.endsWith('.spec.js')))
        add(9, SEV.ERROR, -1, `file name must match ${prefix}*.spec.js: ${fileName}`, 'rename the file');
    // 10 setTimeout first in describe
    const desc = src.indexOf('test.describe(');
    const st = src.match(/test\.setTimeout\(\s*(\d+)\s*\)/);
    if (desc < 0 || !st) add(10, SEV.ERROR, -1, 'test.setTimeout(N) missing', 'first statement in test.describe: test.setTimeout(120000)');
    else {
        const between = src.slice(src.indexOf('{', desc) + 1, st.index);
        if (/[;]/.test(between)) add(10, SEV.ERROR, st.index, 'test.setTimeout is not the first statement in test.describe', 'move it to the first line');
        if (Number(st[1]) < 60000) add(10, SEV.ERROR, st.index, `test.setTimeout(${st[1]}) < 60000`, 'raise to >= 60000');
    }
    // 11 waitForFunction 3-arg
    const wff = /\bwaitForFunction\s*\(/g;
    let m;
    while ((m = wff.exec(src))) {
        const args = extractArgs(src, m.index + m[0].length - 1);
        // Only the 2-arg form with an object literal is the bug: (fn, { timeout }) passes the options as
        // the page-function argument. (fn, { anyArg }, { timeout }) is legitimate — never flag 3-arg calls.
        if (args && args.length === 2 && args[1].startsWith('{'))
            add(11, SEV.CRITICAL, m.index, `waitForFunction 2-arg bug — second argument is an object (${args[1].slice(0, 30)}…)`, 'pass null as the 2nd argument and { timeout } as the 3rd');
        if (args && args.length === 1)
            add(11, SEV.CRITICAL, m.index, 'waitForFunction without null arg and { timeout }', 'use waitForFunction(fn, null, { timeout })');
    }
    // 12 attachAnalysisToReport
    if (!/attachAnalysisToReport\s*\(\s*testInfo\s*,\s*analysisResult/.test(src)) add(12, SEV.ERROR, -1, 'attachAnalysisToReport(testInfo, analysisResult, …) not called', 'call it in afterEach');
    if (src.includes('attachAnalysisToReport') && !/import[^;]*attachAnalysisToReport/.test(src)) add(12, SEV.ERROR, -1, 'attachAnalysisToReport not imported', 'import from the kit');
    // 13 acceptanceCriteria key
    const scr = src.indexOf('successCriteriaResults:');
    if (scr >= 0) add(13, SEV.ERROR, scr, 'successCriteriaResults: key is forbidden', 'use acceptanceCriteria:');
    if (/\banalyze\s*\(/.test(src) && !/acceptanceCriteria\s*:/.test(src)) add(13, SEV.ERROR, -1, 'analyze() call lacks acceptanceCriteria: key', 'pass acceptanceCriteria: SUCCESS_CRITERIA');
    // 14 state bridge access
    const bridge = cfg.ui?.stateBridge;
    if (bridge?.globalExpr) {
        const g = bridge.globalExpr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const sv = new RegExp(`${g}[?.\\w]*\\.state\\.value`, 'g');
        while ((m = sv.exec(src))) add(14, SEV.CRITICAL, m.index, `${bridge.globalExpr}.state.value chaining — the bridge already exposes state`, `access ${bridge.globalExpr}.<store>.<field> directly`);
        for (const bad of bridge.forbiddenGlobals || []) {
            const i = src.indexOf(bad);
            if (i >= 0) add(14, SEV.CRITICAL, i, `${bad} does not exist`, `use ${bridge.globalExpr}`);
        }
    }
    // 15 step isolation
    if (critCount >= 2 && !src.includes('test.step(')) add(15, SEV.WARNING, -1, `${critCount} checkpoints without test.step() isolation`, 'wrap each checkpoint in test.step()');
    // 18 console methods
    if (Array.isArray(e2e.consoleAllowedMethods)) {
        const re = /console\.(\w+)\s*\(/g;
        while ((m = re.exec(src))) if (!e2e.consoleAllowedMethods.includes(m[1])) add(18, SEV.ERROR, m.index, `console.${m[1]}() not in e2e.consoleAllowedMethods`, `use console.${e2e.consoleAllowedMethods[0] || 'log'}`);
    }
    // 19 fullPage
    const fp = /screenshot\(\s*\{[^}]*fullPage\s*:\s*true/g;
    while ((m = fp.exec(src))) add(19, SEV.ERROR, m.index, 'screenshot({ fullPage: true }) is forbidden', 'use page.screenshot()');
    // 20 placeholders
    // ponytail: placeholder strings = bracket text with a space or a capital ('[TC name]', '[Selector]'); single lowercase words slip through.
    const ph = [/<<< TEST_BODY >>>/, /'\[(?:[A-Z][\w ]*|[a-z]+ [\w ]+)\]'/, /\bTODO\b/, /<placeholder>/i];
    for (const re of ph) { const i = src.search(re); if (i >= 0) add(20, SEV.ERROR, i, `leftover placeholder: ${src.slice(i, i + 30).split('\n')[0]}`, 'replace with real content'); }

    const blocking = v.some((x) => x.severity !== SEV.WARNING);
    return { pass: !blocking, violations: v, llmResidual: LLM_RESIDUAL };
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
    const argv = process.argv.slice(2);
    const fail = (msg) => console.log(JSON.stringify({ pass: false, violations: [{ rule: 0, severity: SEV.ERROR, line: null, message: msg, fix: 'node spec-lint.mjs <spec.js> [--config <path>]' }], llmResidual: LLM_RESIDUAL }));
    if (argv.includes('--help')) { console.log(JSON.stringify({ usage: 'node spec-lint.mjs <spec.js> [--config <path>] [--cwd <root>]', rules: '1–15,18–20 deterministic; 16,17 llmResidual' }, null, 2)); process.exit(0); }
    const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
    const file = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--config' && argv[i - 1] !== '--cwd');
    if (!file) { fail('spec path missing'); process.exit(0); }
    try {
        const src = readFileSync(file, 'utf8');
        const { cfg } = await loadConfigCompat({ cwd: opt('--cwd') || process.cwd(), configPath: opt('--config') });
        console.log(JSON.stringify(lint(src, { fileName: path.basename(file), cfg }), null, 2));
    } catch (e) { fail(`read/config failed: ${e.message}`); }
}
