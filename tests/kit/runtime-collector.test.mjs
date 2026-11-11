import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeCollector } from '../../kit/services/runtime-collector.js';

const req = (url) => ({ url: () => url });

test('mock boundary: asset and text fetches are not live; counts come before truncation', async () => {
    const c = new RuntimeCollector({});
    c.apiRequests = [
        req('http://h/img/a.png?x=1'),
        req('http://h/sound/click.wav'),
        req('http://h/version.txt'),
        ...Array.from({ length: 25 }, (_, i) => req(`http://h/api/live/${i}`))
    ];
    const { mockBoundary } = await c.collect();
    assert.equal(mockBoundary.liveCount, 25);
    assert.equal(mockBoundary.live.length, 20);
    assert.ok(mockBoundary.live.every((u) => u.includes('/api/live/')));
});

test('collect builds api from the request log and input times', async () => {
    const c = new RuntimeCollector({});
    c.requestLog = [
        { method: 'GET', url: 'http://h/api/a', ts: 1000, request: {} },
        { method: 'GET', url: 'http://h/api/a', ts: 9000, request: {} }
    ];
    c.inputTimes = [2000];
    const out = await c.collect();
    assert.equal(out.api.total, 2);
    assert.equal(out.api.duplicates[0].count, 2);
    assert.deepEqual(out.api.idle, [{ endpoint: '/api/a', afterInputMs: 7000 }]);
    assert.ok('slowRequests' in out && 'durationMs' in out);
});

test('start registers the __e2eInput hook and records xhr/fetch requests', async () => {
    const handlers = {};
    const exposed = {};
    let initScript = null;
    const page = {
        on: (e, fn) => (handlers[e] = fn),
        exposeFunction: async (name, fn) => (exposed[name] = fn),
        addInitScript: async (fn) => (initScript = fn)
    };
    const c = new RuntimeCollector(page);
    await c.start();
    assert.equal(typeof exposed.__e2eInput, 'function');
    assert.equal(typeof initScript, 'function');
    exposed.__e2eInput();
    assert.equal(c.inputTimes.length, 1);
    const mk = (type) => ({ resourceType: () => type, method: () => 'GET', url: () => 'http://h/api/a' });
    handlers.request(mk('fetch'));
    handlers.request(mk('image'));
    assert.equal(c.apiRequests.length, 1);
    assert.equal(c.requestLog.length, 1);
});

test('clear resets request and input logs', () => {
    const c = new RuntimeCollector({});
    c.apiRequests.push({});
    c.requestLog.push({});
    c.inputTimes.push(1);
    c.clear();
    assert.deepEqual([c.apiRequests, c.requestLog, c.inputTimes], [[], [], []]);
});

test('settle waits for responses and for requests that start during the quiet window', async () => {
    const c = new RuntimeCollector({});
    const done = [];
    const later = (name, ms) => {
        const res = new Promise((r) => setTimeout(() => r(done.push(name)), ms));
        return { response: () => res };
    };
    c.apiRequests = [later('a', 30)];
    setTimeout(() => c.apiRequests.push(later('b', 30)), 40);
    await c.settle({ quietMs: 30, timeout: 1000 });
    assert.deepEqual(done, ['a', 'b']);
});

test('settle returns at timeout when a response never arrives', async () => {
    const c = new RuntimeCollector({});
    c.apiRequests = [{ response: () => new Promise(() => {}) }];
    const at = Date.now();
    await c.settle({ quietMs: 10, timeout: 100 });
    assert.ok(Date.now() - at < 500);
});

test('settle tolerates a rejected response', async () => {
    const c = new RuntimeCollector({});
    c.apiRequests = [{ response: () => Promise.reject(new Error('gone')) }];
    await c.settle({ quietMs: 5, timeout: 200 });
});

test('an error status a fixture mock returned on purpose is not a network error', async () => {
    const { markRouted } = await import('../../kit/utils/api-mocker.js');
    const handlers = {};
    const c = new RuntimeCollector({ on: (e, fn) => (handlers[e] = fn) });
    await c.start();
    const request = (url) => ({ resourceType: () => 'fetch', method: () => 'GET', url: () => url });
    const mocked = request('http://h/api/err');
    const live = request('http://h/api/live');
    markRouted(mocked, 'fixture');
    for (const r of [mocked, live]) handlers.response({ request: () => r, status: () => 500, url: () => r.url() });
    assert.deepEqual(c.networkErrors.map((e) => e.url), ['http://h/api/live']);
});
