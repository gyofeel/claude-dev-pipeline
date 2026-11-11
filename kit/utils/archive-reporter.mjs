/**
 * archive-reporter: Playwright reporter that keeps every run instead of overwriting the live html/json.
 * One run = one archive:
 *   <archiveDir>/<YYMMDD>/<tag>-<NN>/   html report, results.json, summary.txt, e2e-report.html (+ e2e-report.md)
 *
 * tag: one spec -> its file name; one scenario directory -> the directory name; mixed -> 'run'.
 * e2e-report.md is written only for an unfiltered full-directory run that has a tc.md.
 * Skipped when E2E_ARCHIVE=0 or when no test ran. Errors never break the run (everything is try/catch),
 * but a test the report fails (e.g. mock never used) turns a passed run into a failed one, archive or not.
 * Register it LAST in `reporter` so the html/json reporters have finished writing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadKitConfig, reportSettings } from '../config-loader.js';
import { buildModel, writeReport } from '../report/index.mjs';

const shouldSkip = () => process.env.E2E_ARCHIVE === '0';

const yymmdd = (d) => {
    const yy = String(d.getFullYear()).slice(2);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yy}${mm}${dd}`;
};

const nextNN = (dateDir, tag) => {
    let max = 0;
    try {
        const re = new RegExp(`^${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`);
        for (const name of fs.readdirSync(dateDir)) {
            const m = name.match(re);
            if (m) max = Math.max(max, parseInt(m[1], 10));
        }
    } catch {
        // no directory yet
    }
    return String(max + 1).padStart(2, '0');
};

/** Archive directory tag for the spec files that ran. */
export const archiveTag = (specFiles, testDir) => {
    const names = [
        ...new Set(specFiles.map((f) => path.basename(f).replace(/\.spec\.(js|ts|mjs)$/i, '')))
    ];
    if (names.length === 1) return names[0];
    const dirs = [
        ...new Set(
            specFiles.map((f) => {
                const parts = path.relative(testDir, f).split(path.sep);
                return parts.length > 1 ? parts[0] : null;
            })
        )
    ];
    return dirs.length === 1 && dirs[0] ? dirs[0] : 'run';
};

const isMatchAll = (grep) =>
    !grep || (Array.isArray(grep) ? grep.every(isMatchAll) : grep.source === '.*');
const hasInvert = (grepInvert) =>
    Array.isArray(grepInvert) ? grepInvert.length > 0 : !!grepInvert;

// `a.spec.js:12` selects tests by line; the reporter API does not expose it, so read the CLI
const hasLineFilter = (argv) => argv.some((a) => !a.startsWith('-') && !a.includes('://') && /:\d+(:\d+)?$/.test(a));

/** True when --grep, a file:line argument or similar selected only some tests; such a run is not a full-feature record. */
export const isFilteredRun = (config, argv = process.argv) =>
    hasLineFilter(argv.slice(2)) ||
    !isMatchAll(config.grep) ||
    hasInvert(config.grepInvert) ||
    (config.projects ?? []).some((p) => !isMatchAll(p.grep) || hasInvert(p.grepInvert));

const reporterOptions = (config, name) => (config.reporter ?? []).find(([n]) => n === name)?.[1] ?? null;

/** Where the html and json reporters wrote, resolved like Playwright does: relative to the config file. */
export function reporterPaths(config) {
    const base = config.configFile ? path.dirname(config.configFile) : (config.rootDir ?? process.cwd());
    const at = (p) => (p ? path.resolve(base, p) : null);
    return {
        htmlDir: at(reporterOptions(config, 'html')?.outputFolder),
        resultsJson: at(reporterOptions(config, 'json')?.outputFile)
    };
}

export default class ArchiveReporter {
    onBegin(config, suite) {
        this._testDir = config.projects?.[0]?.testDir ?? config.rootDir;
        this._filtered = isFilteredRun(config);
        this._paths = reporterPaths(config);
        this._suite = suite;
        this._files = new Set();
        this._counts = { passed: 0, failed: 0, timedOut: 0, skipped: 0, interrupted: 0 };
    }

    onTestEnd(test, result) {
        try {
            if (test?.location?.file) this._files.add(test.location.file);
            const s = result?.status;
            if (s && s in this._counts) this._counts[s] += 1;
        } catch {
            // ignore
        }
    }

    async onEnd(result) {
        let model = null;
        try {
            // A run that executed nothing (--list) leaves nothing to archive.
            if (this._files.size === 0) return undefined;
            const settings = reportSettings(loadKitConfig());
            model = shouldSkip() ? this._modelOnly(settings) : this._archive(result, settings);
        } catch (e) {
            console.log(`[archive] skipped (error): ${e?.message ?? e}`);
        }
        if (result?.status !== 'passed' || !model?.counts.failed) return undefined;
        console.log(`[archive] the report fails ${model.counts.failed} test(s) Playwright passed — run status set to failed`);
        return { status: 'failed' };
    }

    _liveJson(settings) {
        return this._paths.resultsJson ?? settings.resultsJson;
    }

    _modelOnly(settings) {
        const results = JSON.parse(fs.readFileSync(this._liveJson(settings), 'utf8'));
        const specFiles = [...this._files];
        const tag = archiveTag(specFiles, this._testDir);
        return buildModel({ results, specFiles, tag, nn: '01', testDir: this._testDir, filtered: this._filtered, settings }).model;
    }

    _archive(result, settings) {
        const dateDir = path.join(settings.archiveDir, yymmdd(new Date()));
        const uniqueSpecs = [
            ...new Set([...this._files].map((f) => path.basename(f).replace(/\.spec\.(js|ts|mjs)$/i, '')))
        ];
        const tag = archiveTag([...this._files], this._testDir);
        const liveHtml = this._paths.htmlDir;
        const liveJson = this._liveJson(settings);
        const nn = nextNN(dateDir, tag);
        const destDir = path.join(dateDir, `${tag}-${nn}`);
        fs.mkdirSync(destDir, { recursive: true });

        if (liveHtml && fs.existsSync(liveHtml)) fs.cpSync(liveHtml, destDir, { recursive: true });
        if (fs.existsSync(liveJson)) fs.copyFileSync(liveJson, path.join(destDir, 'results.json'));

        const c = this._counts;
        const summary = [
            `spec: ${uniqueSpecs.length === 1 ? tag : `${uniqueSpecs.length} specs`}`,
            `status: ${result?.status ?? 'unknown'}`,
            `passed: ${c.passed} / failed: ${c.failed + c.timedOut} / skipped: ${c.skipped}`,
            `archivedAt: ${new Date().toISOString()}`,
            `E2E_ARCHIVE: ${process.env.E2E_ARCHIVE ?? ''}`,
            `source files: ${[...this._files].join(', ')}`
        ].join('\n');
        fs.writeFileSync(path.join(destDir, 'summary.txt'), summary + '\n', 'utf8');

        let model = null;
        try {
            const report = writeReport({
                destDir,
                specFiles: [...this._files],
                tag,
                nn,
                cwd: process.cwd(),
                filtered: this._filtered,
                testDir: this._testDir,
                settings
            });
            model = report.model;
            console.log(
                `[archive] report: ${path.relative(process.cwd(), report.reportPath)}${report.mdPath ? ` · ${report.mdPath}` : ''}`
            );
        } catch (e) {
            console.log(`[archive] report failed: ${e?.message ?? e} — add the json reporter (see e2e-init)`);
        }

        console.log(`[archive] saved: ${path.relative(process.cwd(), destDir)}`);
        return model;
    }
}
