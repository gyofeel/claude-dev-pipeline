#!/usr/bin/env node
/**
 * e2e-init — the file operations of /dev-pipeline:e2e-init that must not be done by hand.
 *
 *   node e2e-init.mjs check-kit-dir             → { ok, kitDir, errors[] }  (safe to rm -rf and replace?)
 *   node e2e-init.mjs write-playwright-config   → { ok, path, errors[] }    (from kit/playwright.config.template.js)
 *   node e2e-init.mjs gitignore                 → { ok, path, added[] }     (run outputs the docs call gitignored)
 *
 * All read .agents/pipeline.config.json from the cwd's repo. stdout is one JSON object; exit 0 always.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CONFIG_REL, PATH_KEYS, get, loadConfig } from './config-load.mjs';

const TEMPLATE = fileURLToPath(new URL('../kit/playwright.config.template.js', import.meta.url));
const PLACEHOLDER = /__[A-Z]+(?:_[A-Z]+)*__/g;

const posixRel = (root, abs) => path.relative(root, abs).split(path.sep).join('/');
const isWithin = (dir, p) => p === dir || p.startsWith(dir + path.sep);

// Symlinks resolved; a path that does not exist yet resolves through its nearest existing parent
const real = (p) => {
    const tail = [];
    let head = p;
    while (!existsSync(head) && path.dirname(head) !== head) {
        tail.unshift(path.basename(head));
        head = path.dirname(head);
    }
    return path.join(realpathSync(head), ...tail);
};

/** Whether `<kitDir>` can be deleted and recreated without taking project files with it. */
export const checkKitDir = (root, cfg) => {
    const kitDir = posixRel(root, cfg.e2e.kitDir);
    const realRoot = real(root);
    const kit = real(cfg.e2e.kitDir);
    const errors = [];
    if (kit === realRoot) errors.push('e2e.kitDir is the repo root');
    else if (!isWithin(realRoot, kit)) errors.push(`e2e.kitDir is outside the repo: ${cfg.e2e.kitDir}`);
    else {
        const owned = [
            ...PATH_KEYS.filter((k) => k !== 'e2e.kitDir' && k !== 'e2e.resultsJson').map((k) => [k, get(cfg, k)]),
            ['dirname(e2e.resultsJson)', path.dirname(cfg.e2e.resultsJson)],
            [path.dirname(CONFIG_REL), path.join(root, path.dirname(CONFIG_REL))]
        ];
        for (const [key, p] of owned)
            if (typeof p === 'string' && isWithin(kit, real(p))) errors.push(`e2e.kitDir contains ${key} (${posixRel(root, p)})`);
        // An empty directory loses nothing; anything else without VERSION was not installed by e2e-init
        if (existsSync(kit) && readdirSync(kit).length && !existsSync(path.join(kit, 'VERSION')))
            errors.push(`e2e.kitDir (${kitDir}) exists but has no VERSION file — it is not a kit installed by e2e-init`);
    }
    return { ok: errors.length === 0, kitDir, errors };
};

// Escaped for the template's single-quoted literals
const quoted = (value) => JSON.stringify(String(value)).slice(1, -1).replace(/'/g, "\\'");

/** playwright.config.js text for the resolved config; throws when the template has a placeholder this script does not fill. */
export const renderPlaywrightConfig = (root, cfg, template = readFileSync(TEMPLATE, 'utf8')) => {
    const rel = (abs) => posixRel(root, abs);
    const values = {
        __SPECS_DIR__: rel(cfg.e2e.specsDir),
        __BASE_URL__: cfg.e2e.baseUrl,
        __HEALTH_PATH__: cfg.e2e.healthUrlPath,
        __REPORTS_DIR__: path.posix.dirname(rel(cfg.e2e.resultsJson)),
        __RESULTS_JSON__: rel(cfg.e2e.resultsJson),
        __KIT_DIR__: rel(cfg.e2e.kitDir)
    };
    // checked on the template, so a value that happens to contain __X__ is not mistaken for one
    const known = new Set([...Object.keys(values), '__DEV_COMMAND__', '__WEBSERVER_START__', '__WEBSERVER_END__']);
    const unknown = (template.match(PLACEHOLDER) ?? []).find((p) => !known.has(p));
    if (unknown) throw new Error(`placeholder left in playwright.config.js: ${unknown}`);
    const dev = cfg.commands.dev;
    // function replacements: a value containing $& or $' must land verbatim
    const text = dev
        ? template
        : template.replace(/\n\s*\/\/ __WEBSERVER_START__[\s\S]*?\/\/ __WEBSERVER_END__/, () => '');
    return text
        .replace(PLACEHOLDER, (p) => (p in values ? quoted(values[p]) : p))
        .replace("'__DEV_COMMAND__'", () => JSON.stringify(dev));
};

const writePlaywrightConfig = (root, cfg) => {
    const existing = readdirSync(root).find((f) => /^playwright\.config\./.test(f));
    if (existing) return { ok: false, path: null, errors: [`${existing} exists — not overwriting`] };
    const out = path.join(root, 'playwright.config.js');
    writeFileSync(out, renderPlaywrightConfig(root, cfg));
    return { ok: true, path: out, errors: [] };
};

const gitignore = (root, cfg) => {
    const file = path.join(root, '.gitignore');
    const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
    const have = new Set(text.split('\n').map((l) => l.trim()));
    const lines = [
        `${posixRel(root, cfg.worksDir)}/**/e2e-loops.json`,
        `${path.posix.dirname(posixRel(root, cfg.e2e.resultsJson))}/`,
        // Playwright writes it next to the nearest package.json
        'test-results/'
    ];
    const added = lines.filter((l) => !have.has(l));
    if (added.length) writeFileSync(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${added.join('\n')}\n`);
    return { ok: true, path: file, added };
};

const COMMANDS = { 'check-kit-dir': checkKitDir, 'write-playwright-config': writePlaywrightConfig, gitignore };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const cmd = COMMANDS[process.argv[2]];
    let res;
    if (!cmd) res = { ok: false, errors: [`usage: e2e-init.mjs ${Object.keys(COMMANDS).join(' | ')}`] };
    else {
        const cfg = loadConfig();
        try {
            res = cfg.ok ? cmd(cfg.root, cfg.resolved) : { ok: false, errors: cfg.errors };
        } catch (e) {
            res = { ok: false, errors: [e.message] };
        }
    }
    console.log(JSON.stringify(res, null, 2));
}
