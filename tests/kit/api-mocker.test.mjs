import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markRouted, mockCategoryOf, mock, mockByRequest, mockAll, mockHits } from '../../kit/utils/api-mocker.js';

test('a request answered by a route records its source; others are undefined', () => {
    const fixtureReq = {};
    const emptyReq = {};
    markRouted(fixtureReq, 'fixture');
    markRouted(emptyReq, 'empty');
    assert.equal(mockCategoryOf(fixtureReq), 'fixture');
    assert.equal(mockCategoryOf(emptyReq), 'empty');
    assert.equal(mockCategoryOf({}), undefined);
});

// Fake page: routes are kept in order; fire() runs the latest matching pattern like Playwright does.
const fakePage = () => {
    const routes = [];
    return {
        routes,
        unroute: async (p) => {
            const i = routes.findIndex((r) => r.pattern === p);
            if (i >= 0) routes.splice(i, 1);
        },
        route: async (pattern, handler) => routes.push({ pattern, handler })
    };
};
const fakeRoute = ({ type = 'fetch', url = 'http://h/api/a', body = {} } = {}) => {
    const calls = [];
    const request = { resourceType: () => type, url: () => url, postDataJSON: () => body };
    return {
        calls,
        request: () => request,
        fulfill: (o) => calls.push(['fulfill', o]),
        fallback: () => calls.push(['fallback']),
        continue: () => calls.push(['continue'])
    };
};
const handlerOf = (page, pattern) => page.routes.find((r) => r.pattern === pattern).handler;

test('mock counts each fulfilled request', async () => {
    const page = fakePage();
    await mock(page, '**/api/a', {});
    const h = handlerOf(page, '**/api/a');
    h(fakeRoute());
    h(fakeRoute());
    assert.deepEqual(mockHits(page), { '**/api/a': 2 });
});

test('a registered but unused pattern is reported with 0', async () => {
    const page = fakePage();
    await mock(page, '**/api/a', {});
    await mock(page, '**/api/b', {});
    handlerOf(page, '**/api/a')(fakeRoute());
    assert.deepEqual(mockHits(page), { '**/api/a': 1, '**/api/b': 0 });
});

test('re-registering a pattern keeps its count', async () => {
    const page = fakePage();
    await mock(page, '**/api/a', {});
    handlerOf(page, '**/api/a')(fakeRoute());
    await mock(page, '**/api/a', { v: 2 });
    assert.equal(mockHits(page)['**/api/a'], 1);
    handlerOf(page, '**/api/a')(fakeRoute());
    assert.equal(mockHits(page)['**/api/a'], 2);
    assert.equal(page.routes.filter((r) => r.pattern === '**/api/a').length, 1);
});

test('mockByRequest counts fulfills only; a null resolver falls back with no count', async () => {
    const page = fakePage();
    await mockByRequest(page, '**/api/a', (body) => (body.x ? { ok: 1 } : null));
    const h = handlerOf(page, '**/api/a');
    const miss = fakeRoute({ body: {} });
    h(miss);
    assert.deepEqual(miss.calls, [['fallback']]);
    assert.equal(mockHits(page)['**/api/a'], 0);
    const hit = fakeRoute({ body: { x: 1 } });
    h(hit);
    assert.equal(hit.calls[0][0], 'fulfill');
    assert.equal(mockHits(page)['**/api/a'], 1);
});

test('mockAll isolate: the catch-all is not a key and its fulfills do not count', async () => {
    const page = fakePage();
    await mockAll(page, { '**/api/a': {} }, { isolate: true });
    assert.deepEqual(mockHits(page), { '**/api/a': 0 });
    const catchAll = handlerOf(page, '**/*');
    const r = fakeRoute({ url: 'http://h/api/other' });
    catchAll(r);
    assert.equal(r.calls[0][0], 'fulfill');
    assert.deepEqual(mockHits(page), { '**/api/a': 0 });
});

test('counts are per page', async () => {
    const p1 = fakePage();
    const p2 = fakePage();
    await mock(p1, '**/api/a', {});
    await mock(p2, '**/api/a', {});
    handlerOf(p1, '**/api/a')(fakeRoute());
    assert.equal(mockHits(p1)['**/api/a'], 1);
    assert.equal(mockHits(p2)['**/api/a'], 0);
});

test('a page with no registrations has no hits', () => {
    assert.deepEqual(mockHits(fakePage()), {});
});

test('mockHits returns a copy', async () => {
    const page = fakePage();
    await mock(page, '**/api/a', {});
    mockHits(page)['**/api/a'] = 99;
    assert.equal(mockHits(page)['**/api/a'], 0);
});
