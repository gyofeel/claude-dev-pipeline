#!/usr/bin/env node
/**
 * config-load — loads and validates `.agents/pipeline.config.json`.
 *
 *   node config-load.mjs              → { ok, root, raw, resolved, errors[], warnings[] }
 *   node config-load.mjs --check      → same, exit 1 when errors[] is non-empty
 *   node config-load.mjs --get e2e.specsDir   → prints one resolved value (strings raw, others JSON)
 *   node config-load.mjs --defaults   → prints the default document
 *
 * Exports loadConfig(cwd) for other scripts. See references/config-schema.md.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONFIG_REL = '.agents/pipeline.config.json';

export const DEFAULTS = {
    $schema: 'dev-pipeline/1',
    worksDir: '.agents/works',
    issueKeyPattern: '[A-Z]+-\\d+',
    branchPrefix: 'feat/',
    packageManager: 'npm',
    constraintsFile: null,
    commands: {
        setup: null,
        unitTest: 'npx vitest run',
        unitTestList: null,
        format: null,
        lint: null,
        dev: null,
        e2eRun: 'npx playwright test'
    },
    unitTest: {
        runner: 'vitest',
        runnerArgs: [],
        testFileGlobs: ['**/*.test.{js,ts,jsx,tsx}'],
        excludedFilePatterns: [],
        testNaming: '<name>.test.js',
        knownFailuresFile: null,
        excludedAreas: [],
        useWorktree: false
    },
    ui: {
        framework: 'auto',
        pagesDir: null,
        componentsDir: null,
        stateStoreDir: null,
        routeRule: null,
        stateBridge: null,
        registrationFiles: [],
        selectorPriority: ['testid', 'id', 'class', 'text'],
        testIdAttribute: 'data-testid'
    },
    e2e: {
        specsDir: 'e2e/specs',
        fixturesDir: 'e2e/fixtures',
        specFilePrefix: '',
        kitDir: 'e2e/kit',
        adapterModule: 'e2e/e2e.adapter.js',
        resultsJson: 'e2e/reports/results.json',
        baseUrl: 'http://localhost:3000',
        healthUrlPath: '/',
        interaction: 'pointer',
        readyExpr: null,
        renderSelectorDefault: null,
        envErrorPatterns: [
            'ECONNREFUSED',
            'EADDRINUSE',
            'EACCES',
            "Executable doesn't exist",
            'Process from config.webServer',
            'Timed out waiting'
        ],
        writableDirs: [],
        networkNoiseWhitelist: [],
        consoleAllowedMethods: null,
        softTrack: null,
        screenCatalog: null,
        ai: { provider: 'none', model: null, apiKeyEnv: null }
    },
    approvalGates: [],
    platformInterface: { enabled: false, label: 'platform bridge' }
};

// Keys (dot paths) whose values are repo-relative paths → resolved to absolute.
const PATH_KEYS = [
    'worksDir',
    'constraintsFile',
    'unitTest.knownFailuresFile',
    'ui.pagesDir',
    'ui.componentsDir',
    'ui.stateStoreDir',
    'e2e.specsDir',
    'e2e.fixturesDir',
    'e2e.kitDir',
    'e2e.adapterModule',
    'e2e.resultsJson',
    'e2e.screenCatalog'
];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function merge(base, over) {
    if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
    const out = { ...base };
    for (const [k, v] of Object.entries(over)) out[k] = merge(base[k], v);
    return out;
}

export function get(obj, dotPath) {
    return dotPath.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function set(obj, dotPath, value) {
    const keys = dotPath.split('.');
    const last = keys.pop();
    const parent = keys.reduce((o, k) => (o[k] ??= {}), obj);
    parent[last] = value;
}

export function findRoot(cwd = process.cwd()) {
    let dir = path.resolve(cwd);
    for (;;) {
        if (existsSync(path.join(dir, CONFIG_REL)) || existsSync(path.join(dir, '.git'))) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

function detectFramework(root) {
    try {
        const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        if (deps.vue || deps.nuxt) return 'vue';
        if (deps.react || deps.next) return 'react';
        if (deps.svelte || deps['@sveltejs/kit']) return 'svelte';
        if (Object.keys(deps).some((d) => d.startsWith('@angular/'))) return 'angular';
    } catch {
        /* no package.json */
    }
    return 'other';
}

const ENUMS = {
    'unitTest.runner': ['vitest', 'jest'],
    'ui.framework': ['auto', 'vue', 'react', 'svelte', 'angular', 'other'],
    'e2e.interaction': ['pointer', 'keyboard'],
    'e2e.ai.provider': ['openai', 'anthropic', 'none']
};

function validate(cfg, root, errors, warnings) {
    if (cfg.$schema !== 'dev-pipeline/1') warnings.push(`$schema is "${cfg.$schema}", expected "dev-pipeline/1"`);
    if (!cfg.commands?.unitTest) errors.push('commands.unitTest is required');
    if (!cfg.commands?.e2eRun) errors.push('commands.e2eRun is required');
    for (const [k, allowed] of Object.entries(ENUMS)) {
        const v = get(cfg, k);
        if (!allowed.includes(v)) errors.push(`${k} must be one of ${allowed.join('|')}, got ${JSON.stringify(v)}`);
    }
    try {
        new RegExp(cfg.issueKeyPattern);
    } catch {
        errors.push(`issueKeyPattern is not a valid regex: ${cfg.issueKeyPattern}`);
    }
    const sb = cfg.ui?.stateBridge;
    if (sb !== null && (!isObj(sb) || typeof sb.globalExpr !== 'string' || !sb.globalExpr))
        errors.push('ui.stateBridge must be null or { globalExpr: string, focusExpr?: string|null }');
    const st = cfg.e2e?.softTrack;
    if (st !== null && (!isObj(st) || typeof st.guardExpr !== 'string' || !Array.isArray(st.patterns)))
        errors.push('e2e.softTrack must be null or { guardExpr: string, patterns: string[] }');
    const rr = cfg.ui?.routeRule;
    if (rr !== null && (!isObj(rr) || typeof rr.strip !== 'string'))
        errors.push('ui.routeRule must be null or { strip: string, prefix?: string, indexFile?: string }');
    if (!Array.isArray(cfg.approvalGates)) errors.push('approvalGates must be an array');
    else
        cfg.approvalGates.forEach((g, i) => {
            if (!isObj(g) || typeof g.name !== 'string' || typeof g.check !== 'string')
                errors.push(`approvalGates[${i}] must be { name: string, check: string }`);
        });
    if (cfg.e2e?.screenCatalog && !existsSync(path.resolve(root, cfg.e2e.screenCatalog)))
        errors.push(`e2e.screenCatalog file not found: ${cfg.e2e.screenCatalog}`);
    if (cfg.e2e?.interaction === 'keyboard') {
        const adapter = path.resolve(root, cfg.e2e.adapterModule);
        if (!existsSync(adapter)) {
            // Bootstrap order is init → e2e-init; the adapter does not exist yet at init time.
            warnings.push(`e2e.interaction is "keyboard": ${cfg.e2e.adapterModule} must define findAndEnter — run /dev-pipeline:e2e-init, then implement it (see examples/adapters/)`);
        } else {
            // ponytail: identifier grep on comment-stripped source, not a module import (loader stays sync and dependency-free)
            const src = readFileSync(adapter, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
            if (!/\bfindAndEnter\b/.test(src))
                errors.push(`e2e.interaction is "keyboard" but ${cfg.e2e.adapterModule} does not define findAndEnter (the template's commented example does not count)`);
        }
    }
    if (cfg.e2e?.consoleAllowedMethods !== null && !Array.isArray(cfg.e2e.consoleAllowedMethods))
        errors.push('e2e.consoleAllowedMethods must be null or string[]');
}

export function loadConfig(cwd = process.cwd()) {
    const errors = [];
    const warnings = [];
    const root = findRoot(cwd);
    if (!root) return { ok: false, root: null, raw: null, resolved: null, errors: ['repo root not found (no .git or .agents/pipeline.config.json above cwd)'], warnings };
    const file = path.join(root, CONFIG_REL);
    if (!existsSync(file))
        return { ok: false, root, raw: null, resolved: null, errors: [`${CONFIG_REL} not found — run /dev-pipeline:init`], warnings };
    let raw;
    try {
        raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
        return { ok: false, root, raw: null, resolved: null, errors: [`${CONFIG_REL} is not valid JSON: ${e.message}`], warnings };
    }
    const resolved = merge(DEFAULTS, raw);
    if (resolved.ui.framework === 'auto') resolved.ui.framework = detectFramework(root);
    validate(resolved, root, errors, warnings);
    for (const k of PATH_KEYS) {
        const v = get(resolved, k);
        if (typeof v === 'string') set(resolved, k, path.resolve(root, v));
    }
    return { ok: errors.length === 0, root, raw, resolved, errors, warnings };
}

const HELP = `config-load — load and validate ${CONFIG_REL}
  node config-load.mjs [--check] [--get <dot.path>] [--defaults] [--cwd <dir>]
  --check      exit 1 when errors[] is non-empty
  --get PATH   print one resolved value
  --defaults   print the default document`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const a = process.argv.slice(2);
    if (a.includes('--help') || a.includes('-h')) {
        console.log(HELP);
        process.exit(0);
    }
    if (a.includes('--defaults')) {
        console.log(JSON.stringify(DEFAULTS, null, 2));
        process.exit(0);
    }
    const cwdIdx = a.indexOf('--cwd');
    const res = loadConfig(cwdIdx >= 0 ? a[cwdIdx + 1] : process.cwd());
    const getIdx = a.indexOf('--get');
    if (getIdx >= 0) {
        if (!res.ok) {
            console.error(res.errors.join('\n'));
            process.exit(1);
        }
        const v = get(res.resolved, a[getIdx + 1]);
        console.log(typeof v === 'string' ? v : JSON.stringify(v));
        process.exit(0);
    }
    console.log(JSON.stringify(res, null, 2));
    process.exit(a.includes('--check') && !res.ok ? 1 : 0);
}
