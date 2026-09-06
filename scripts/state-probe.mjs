#!/usr/bin/env node
/**
 * state-probe — runtime check that every State path a spec reads actually resolves in the running app.
 *
 *   node state-probe.mjs <spec.js> [--url <startUrl>] [--cwd <dir>]
 *
 * Paths are collected from two sources:
 *   1. `<globalExpr>?.a?.b` / `<globalExpr>.a.b` occurrences (globalExpr = ui.stateBridge.globalExpr)
 *   2. `// @state-path a.b` markers emitted by spec-template
 * Output: { ok, checked: [{ path, status: 'ok'|'undefined'|'error', sample }], errors[] }
 *   exit 0 all resolved · exit 1 some undefined · exit 2 environment problem (no Playwright / app unreachable)
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config-load.mjs';

const HELP = `state-probe — evaluate each State path of a spec against the running app
  node state-probe.mjs <spec.js> [--url <startUrl>] [--cwd <dir>]
  exit 0 ok · 1 some path undefined · 2 env (Playwright missing / app unreachable)`;

export function extractPaths(src, globalExpr) {
    const paths = new Set();
    for (const m of src.matchAll(/\/\/\s*@state-path\s+([\w$.]+)/g)) paths.add(m[1]);
    if (globalExpr) {
        const g = globalExpr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\?\\\./g, '\\??\\.');
        // capture chained property access after the global: ?.a?.b or .a.b (stops at ( [ or non-ident)
        const re = new RegExp(`${g}((?:\\??\\.[A-Za-z_$][\\w$]*)+)`, 'g');
        for (const m of src.matchAll(re)) {
            const p = m[1].replace(/\?\./g, '.').replace(/^\./, '');
            if (p) paths.add(p);
        }
    }
    return [...paths];
}

async function main() {
    const a = process.argv.slice(2);
    if (!a[0] || a.includes('--help') || a.includes('-h')) {
        console.log(HELP);
        process.exit(a[0] ? 0 : 1);
    }
    const out = (obj, code) => {
        console.log(JSON.stringify(obj, null, 2));
        process.exit(code);
    };
    const cwdIdx = a.indexOf('--cwd');
    const cfg = loadConfig(cwdIdx >= 0 ? a[cwdIdx + 1] : process.cwd());
    if (!cfg.ok) out({ ok: false, env: true, checked: [], errors: cfg.errors }, 2);
    const { root, resolved } = cfg;
    const globalExpr = resolved.ui.stateBridge?.globalExpr ?? null;
    if (!globalExpr) out({ ok: false, env: true, checked: [], errors: ['ui.stateBridge is null — nothing to probe'] }, 2);

    let src;
    try {
        src = readFileSync(path.resolve(a[0]), 'utf8');
    } catch (e) {
        out({ ok: false, env: false, checked: [], errors: [`cannot read spec: ${e.message}`] }, 1);
    }
    const paths = extractPaths(src, globalExpr);
    if (paths.length === 0) out({ ok: true, checked: [], errors: [] }, 0);

    const urlIdx = a.indexOf('--url');
    const startUrl = urlIdx >= 0 ? a[urlIdx + 1] : '/';
    const target = /^https?:/.test(startUrl) ? startUrl : resolved.e2e.baseUrl.replace(/\/$/, '') + startUrl;

    let chromium;
    try {
        ({ chromium } = createRequire(path.join(root, 'package.json'))('@playwright/test'));
    } catch (e) {
        out({ ok: false, env: true, checked: [], errors: [`@playwright/test not resolvable from ${root}: ${e.message}`] }, 2);
    }

    let browser;
    try {
        browser = await chromium.launch({ headless: true });
    } catch (e) {
        out({ ok: false, env: true, checked: [], errors: [`browser launch failed: ${e.message.split('\n')[0]}`] }, 2);
    }
    try {
        const page = await browser.newPage();
        try {
            await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
            if (resolved.e2e.readyExpr) await page.waitForFunction(resolved.e2e.readyExpr, null, { timeout: 30000 });
        } catch (e) {
            out({ ok: false, env: true, checked: [], errors: [`app unreachable at ${target}: ${e.message.split('\n')[0]}`] }, 2);
        }
        const checked = [];
        for (const p of paths) {
            const expr = `${globalExpr}?.${p.split('.').join('?.')}`;
            try {
                const sample = await page.evaluate(`(() => { const v = ${expr}; if (v === undefined) return '__UNDEF__'; try { return JSON.stringify(v).slice(0, 120); } catch { return String(v).slice(0, 120); } })()`);
                checked.push(sample === '__UNDEF__' ? { path: p, status: 'undefined', sample: null } : { path: p, status: 'ok', sample });
            } catch (e) {
                checked.push({ path: p, status: 'error', sample: e.message.split('\n')[0] });
            }
        }
        const bad = checked.filter((c) => c.status !== 'ok');
        out({ ok: bad.length === 0, checked, errors: bad.map((c) => `${c.path}: ${c.status}`) }, bad.length ? 1 : 0);
    } finally {
        await browser.close().catch(() => {});
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
