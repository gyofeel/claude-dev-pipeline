/**
 * Reads `.agents/pipeline.config.json` for kit runtime code (specs, adapter, analyzer).
 * Walks up from cwd to find the repo root (the directory containing `.agents/`).
 * Result is cached for the process lifetime.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const LOCALES = ['en', 'ko'];

const DEFAULTS = {
    worksDir: '.agents/works',
    locale: 'en',
    platformInterface: { enabled: false, label: 'platform bridge' },
    ui: { stateBridge: null, testIdAttribute: 'data-testid' },
    e2e: {
        fixturesDir: 'e2e/fixtures',
        kitDir: 'e2e/kit',
        resultsJson: 'e2e/reports/results.json',
        archiveDir: null,
        specFilePrefix: '',
        readyExpr: null,
        softTrack: null,
        bootFixtures: [],
        report: { locale: null, loopThreshold: 3 },
        judge: { backendErrorPatterns: [] }
    }
};

let cached = null;

/** Find the directory containing `.agents/` starting at `from`, else `from` itself. */
export function findRepoRoot(from = process.cwd()) {
    let dir = path.resolve(from);
    for (;;) {
        if (existsSync(path.join(dir, '.agents'))) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) return path.resolve(from);
        dir = parent;
    }
}

/**
 * @returns {{ root: string, config: Object }} config with kit-relevant defaults merged in.
 * Paths in `config` stay relative to `root`.
 */
export function loadKitConfig(from = process.cwd()) {
    if (cached) return cached;
    const root = findRepoRoot(from);
    const file = path.join(root, '.agents', 'pipeline.config.json');
    const raw = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    const e2e = raw.e2e || {};
    const config = {
        ...raw,
        worksDir: raw.worksDir ?? DEFAULTS.worksDir,
        locale: raw.locale ?? DEFAULTS.locale,
        platformInterface: { ...DEFAULTS.platformInterface, ...(raw.platformInterface || {}) },
        ui: { ...DEFAULTS.ui, ...(raw.ui || {}) },
        e2e: {
            ...DEFAULTS.e2e,
            ...e2e,
            report: { ...DEFAULTS.e2e.report, ...(e2e.report || {}) },
            judge: { ...DEFAULTS.e2e.judge, ...(e2e.judge || {}) }
        }
    };
    delete config.e2e.ai;
    cached = { root, config };
    return cached;
}

/** Test hook: drop the cache. */
export function resetKitConfig() {
    cached = null;
}

/** Absolute paths and report options for the archive reporter. Takes `loadKitConfig()`'s result or a bare config. */
export function reportSettings(loaded) {
    const { root = process.cwd(), config = loaded } = loaded.config ? loaded : { config: loaded };
    const e2e = { ...DEFAULTS.e2e, ...(config.e2e || {}) };
    const report = { ...DEFAULTS.e2e.report, ...(e2e.report || {}) };
    const resultsJson = path.resolve(root, e2e.resultsJson);
    const pi = config.platformInterface;
    const picked = report.locale ?? config.locale;
    const locale = LOCALES.includes(picked) ? picked : 'en';
    // tc.md is written in the top-level locale; only the report text follows e2e.report.locale
    const artifactLocale = LOCALES.includes(config.locale) ? config.locale : 'en';
    return {
        worksDir: path.resolve(root, config.worksDir ?? DEFAULTS.worksDir),
        resultsJson,
        archiveDir: e2e.archiveDir ? path.resolve(root, e2e.archiveDir) : path.join(path.dirname(resultsJson), 'archive'),
        locale,
        artifactLocale,
        loopThreshold: report.loopThreshold,
        specFilePrefix: e2e.specFilePrefix,
        platformLabel: pi?.enabled ? pi.label : null,
        backendErrorPatterns: e2e.judge?.backendErrorPatterns ?? [],
        openCommand: `node ${path.posix.join(e2e.kitDir.split(path.sep).join('/'), 'report/open.mjs')}`
    };
}
