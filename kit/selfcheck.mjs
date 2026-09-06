// Smoke check without a browser: config defaults, target resolution, mocker route wiring.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'kit-'));
mkdirSync(path.join(dir, '.agents'));
writeFileSync(
    path.join(dir, '.agents/pipeline.config.json'),
    JSON.stringify({ ui: { testIdAttribute: 'data-qa' }, e2e: { fixturesDir: 'fx' } })
);
mkdirSync(path.join(dir, 'fx'));
writeFileSync(path.join(dir, 'fx/a.json'), '{"ok":1}');
process.chdir(dir);

const { loadKitConfig } = await import('./config-loader.js');
const { resolveTarget, defaultAdapter } = await import('./utils/default-adapter.js');
const { mockAll } = await import('./utils/api-mocker.js');
const { RuntimeCollector } = await import('./services/runtime-collector.js');

const { config } = loadKitConfig();
assert.equal(config.ui.testIdAttribute, 'data-qa');
assert.equal(config.e2e.ai.provider, 'none');
assert.equal(config.e2e.fixturesDir, 'fx');

const calls = [];
const fakeLoc = { nth: (n) => (calls.push(['nth', n]), fakeLoc) };
const page = {
    locator: (s) => (calls.push(['locator', s]), fakeLoc),
    getByRole: (r, o) => (calls.push(['role', r, o]), fakeLoc),
    getByText: (t) => (calls.push(['text', t]), fakeLoc)
};
resolveTarget(page, { by: 'testid', value: 'x' });
resolveTarget(page, '.a');
resolveTarget(page, { by: 'role', value: 'button', name: 'Go', nth: 1 });
resolveTarget(page, { by: 'text', value: 'Hi' });
assert.deepEqual(calls, [
    ['locator', '[data-qa="x"]'],
    ['locator', '.a'],
    ['role', 'button', { name: 'Go' }],
    ['nth', 1],
    ['text', 'Hi']
]);
assert.throws(() => resolveTarget(page, { by: 'predicate', value: 'x' }), /predicate/);
assert.equal(defaultAdapter.keyMap.ArrowDown, 'ArrowDown');

const routes = [];
const rpage = { route: async (p, h) => routes.push([p, h]), unroute: async () => {} };
await mockAll(rpage, { '**/api/a': 'a.json', '**/api/b': { b: 2 } });
assert.deepEqual(routes.map((r) => r[0]), ['**/*', '**/api/a', '**/api/b']);
const fulfilled = [];
const fakeRoute = (url, type) => ({
    request: () => ({ url: () => url, resourceType: () => type }),
    fulfill: async (r) => fulfilled.push(['fulfill', url, r.body]),
    continue: async () => fulfilled.push(['continue', url])
});
await routes[0][1](fakeRoute('http://x/@vite/client', 'fetch'));
await routes[0][1](fakeRoute('http://x/api/unknown', 'fetch'));
await routes[0][1](fakeRoute('http://x/img.png', 'image'));
await routes[1][1](fakeRoute('http://x/api/a', 'fetch'));
assert.deepEqual(fulfilled, [
    ['continue', 'http://x/@vite/client'],
    ['fulfill', 'http://x/api/unknown', '{}'],
    ['continue', 'http://x/img.png'],
    ['fulfill', 'http://x/api/a', '{"ok":1}']
]);

const handlers = {};
const cpage = { on: (ev, fn) => (handlers[ev] = fn) };
const c = new RuntimeCollector(cpage);
await c.start();
handlers.console({ type: () => 'error', text: () => 'boom', location: () => ({ url: 'u' }) });
handlers.console({ type: () => 'log', text: () => 'ignored', location: () => null });
handlers.pageerror(new Error('ex'));
handlers.response({ request: () => ({ resourceType: () => 'fetch' }), status: () => 500, url: () => 'http://x/api' });
const data = await c.collect();
assert.equal(data.consoleErrors.length, 1);
assert.equal(data.exceptions[0].text, 'ex');
assert.equal(data.networkErrors[0].kind, 'api');
assert.ok(data.durationMs >= 0);

console.log('kit selfcheck: ok');
