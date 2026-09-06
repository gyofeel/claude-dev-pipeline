/**
 * API mocking via page.route().
 *
 *   await mock(page, '**\/api/list', 'list.json');            // fixture file in e2e.fixturesDir
 *   await mock(page, '**\/api/list', { items: [] });          // inline data
 *   await mockAll(page, { '**\/api/a': 'a.json' }, { isolate: true });
 */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { loadKitConfig } from '../config-loader.js';

// Binary assets fetched via fetch() (audio, fonts, images) must be loaded for real —
// overriding them with JSON breaks decoding.
const BINARY_ASSET_EXT_RE =
    /\.(wav|mp3|ogg|m4a|aac|flac|mp4|webm|woff2?|ttf|otf|eot|png|jpe?g|gif|webp|svg|ico)(\?|$)/i;

// App-shell / bundler requests that must never be stubbed or the app will not boot.
// A catch-all glob that swallows these (e.g. dev-server module requests) is a known
// failure class: the app stays blank and the only symptom is a waitForAppReady timeout.
const PASS_THROUGH_RE = /(\/@vite\/|\/@id\/|\/@fs\/|\/node_modules\/|\/builds\/meta\/|\.m?js(\?|$)|\.css(\?|$)|\.map(\?|$)|\.txt(\?|$))/;

function fixturesDir(override) {
    if (override) return path.resolve(override);
    const { root, config } = loadKitConfig();
    return path.resolve(root, config.e2e.fixturesDir);
}

function loadFixture(source, dir) {
    if (typeof source !== 'string') return source;
    return JSON.parse(readFileSync(path.join(dir, source), 'utf8'));
}

function fulfillJson(route, data, status) {
    return route.fulfill({
        status,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(data)
    });
}

/**
 * Register one URL pattern → fixture. Re-registering the same pattern replaces it.
 * @param {import('@playwright/test').Page} page
 * @param {string|RegExp} urlPattern
 * @param {string|Object} fixtureSource - file name relative to fixturesDir, or inline object
 * @param {{ status?: number, fixturesDir?: string }} [options]
 */
export async function mock(page, urlPattern, fixtureSource, options = {}) {
    const { status = 200 } = options;
    const data = loadFixture(fixtureSource, fixturesDir(options.fixturesDir));
    await page.unroute(urlPattern).catch(() => {});
    await page.route(urlPattern, (route) => fulfillJson(route, data, status));
}

/**
 * Same URL, different response depending on the request body.
 * `resolver(body, request)` returns a fixture source or null (null → route.fallback()).
 * Register AFTER mock()/mockAll() — later routes take precedence.
 */
export async function mockByRequest(page, urlPattern, resolver, options = {}) {
    const { status = 200 } = options;
    const dir = fixturesDir(options.fixturesDir);
    await page.unroute(urlPattern).catch(() => {});
    await page.route(urlPattern, (route) => {
        let body = {};
        try {
            body = route.request().postDataJSON() ?? {};
        } catch {
            body = {};
        }
        const source = resolver(body, route.request());
        if (source == null) return route.fallback();
        return fulfillJson(route, loadFixture(source, dir), status);
    });
}

/** @param {import('@playwright/test').Page} page */
export async function unmock(page, urlPattern) {
    await page.unroute(urlPattern);
}

/**
 * Isolation catch-all: unmatched xhr/fetch data requests get an empty JSON 200 so the
 * app never reaches a real backend; everything the app shell needs (documents, scripts,
 * styles, fonts, images, media, bundler internals, text files) continues for real.
 * Registered BEFORE fixture routes so fixtures always win (later route = higher priority).
 */
async function installIsolationCatchAll(page) {
    await page.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (type !== 'xhr' && type !== 'fetch') return route.continue();
        const url = route.request().url();
        if (PASS_THROUGH_RE.test(url) || BINARY_ASSET_EXT_RE.test(url)) return route.continue();
        return fulfillJson(route, {}, 200);
    });
}

/**
 * Register many patterns at once.
 * @param {import('@playwright/test').Page} page
 * @param {Object.<string, string|Object>} routeMap  pattern → fixture file or inline data
 * @param {{ isolate?: boolean, status?: number, fixturesDir?: string }} [options]
 *   isolate (default true): stub unmatched data requests (fixture-driven specs). Use false for live-API specs.
 */
export async function mockAll(page, routeMap, options = {}) {
    const { isolate = true, ...mockOptions } = options;
    if (isolate) await installIsolationCatchAll(page);
    for (const [pattern, source] of Object.entries(routeMap || {})) {
        await mock(page, pattern, source, mockOptions);
    }
}
