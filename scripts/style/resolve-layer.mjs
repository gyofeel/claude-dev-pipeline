/**
 * resolve-layer — map file paths to development layers (<style.layersDir>/catalog.json)
 *
 *   node resolve-layer.mjs [--catalog <f>] <path...>   → {"<path>":["ui"],...}
 *   node resolve-layer.mjs --check [--catalog <f>]      → {"errors":[],"unmapped":[]}
 *
 * --check lists tracked code files that belong to no layer plus catalog errors; any of either → exit 1.
 * Which files count as code comes from pipeline.config.json `style` (codeRoots, codeExtensions, extraCodeFiles).
 */

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULTS, loadConfig } from '../config-load.mjs';

const REQUIRED_HEADINGS = ['## Fixed', '## Methodology'];
const IMPORT_SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g;

/** `style` section of the project config; defaults when the config is missing or invalid */
export const styleConfig = (cwd = process.cwd()) => loadConfig(cwd).resolved?.style ?? DEFAULTS.style;

export const loadCatalog = (file) => JSON.parse(readFileSync(file, 'utf8'));

const matchesAny = (file, globs = []) => globs.some((g) => path.matchesGlob(file, g));

const importSpecs = (content) => [...content.matchAll(IMPORT_SPEC)].map((m) => m[1]);

export const resolveLayers = (file, catalog, { content } = {}) => {
    if (matchesAny(file, catalog.excluded)) return [];
    const specs = content ? importSpecs(content) : [];
    return catalog.layers
        .filter(
            (layer) =>
                !matchesAny(file, layer.exclude) &&
                (matchesAny(file, layer.paths) ||
                    (layer.imports ?? []).some((re) => specs.some((s) => new RegExp(re).test(s))))
        )
        .map((layer) => layer.id);
};

export const checkCatalog = (catalog, { layersDir, trackedFiles }) => {
    const errors = [];
    const seen = new Set();
    for (const layer of catalog.layers) {
        if (seen.has(layer.id)) errors.push(`duplicate layer id: ${layer.id}`);
        seen.add(layer.id);
        if (layersDir === null) continue;
        const doc = path.join(layersDir, layer.doc ?? '');
        if (!layer.doc || !existsSync(doc)) {
            errors.push(`${layer.id}: layer doc not found (${layer.doc})`);
            continue;
        }
        const text = readFileSync(doc, 'utf8');
        for (const h of REQUIRED_HEADINGS) {
            if (!text.split('\n').some((line) => line.trim() === h))
                errors.push(`${layer.id}: ${layer.doc} has no "${h}" section`);
        }
    }
    const unmapped = trackedFiles.filter(
        (f) => !matchesAny(f, catalog.excluded) && resolveLayers(f, catalog).length === 0
    );
    return { errors, unmapped };
};

/** Tracked files that count as code: extension match under codeRoots (null = anywhere), plus extraCodeFiles */
export const trackedCodeFiles = ({ codeRoots, codeExtensions, extraCodeFiles = [], cwd } = {}) => {
    const r = spawnSync('git', ['-c', 'core.quotepath=false', 'ls-files'], { cwd, encoding: 'utf8' });
    // outside a repo the list would be empty and --check would pass for the wrong reason
    if (r.status !== 0) throw new Error(`git ls-files failed: ${r.stderr.trim()}`);
    const ext = new Set(codeExtensions);
    return r.stdout
        .split('\n')
        .filter(
            (f) =>
                extraCodeFiles.includes(f) ||
                (ext.has(path.extname(f).slice(1)) &&
                    (codeRoots === null || codeRoots.some((root) => f.startsWith(root))))
        );
};

const main = (argv) => {
    const style = styleConfig();
    const at = argv.indexOf('--catalog');
    const catalogFile = at > -1 ? argv[at + 1] : path.join(style.layersDir, 'catalog.json');
    const catalog = loadCatalog(catalogFile);
    if (argv.includes('--check')) {
        const result = checkCatalog(catalog, {
            layersDir: path.dirname(catalogFile),
            trackedFiles: trackedCodeFiles(style)
        });
        console.log(JSON.stringify(result, null, 2));
        process.exitCode = result.errors.length || result.unmapped.length ? 1 : 0;
        return;
    }
    const files = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--catalog');
    const out = Object.fromEntries(
        files.map((f) => [
            f,
            resolveLayers(f, catalog, {
                content: existsSync(f) ? readFileSync(f, 'utf8') : undefined
            })
        ])
    );
    console.log(JSON.stringify(out));
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        main(process.argv.slice(2));
    } catch (e) {
        console.error(e.message);
        process.exitCode = 2;
    }
}
