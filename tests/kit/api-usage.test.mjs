import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeApiUsage } from '../../kit/utils/api-usage.mjs';

const r = (url, ts = 0, extra = {}) => ({ method: 'GET', url, ts, category: 'fixture', ...extra });

test('static fetches and shell responses are not counted', () => {
    const s = summarizeApiUsage(
        [
            r('http://h/ui5vcs/v562/api/home/blockhome?a=1'),
            r('http://h/img/a.png'),
            r('http://h/version.txt'),
            r('http://h/_nuxt/x.js', 0, { category: 'shell' })
        ],
        []
    );
    assert.equal(s.total, 1);
    assert.deepEqual(s.byEndpoint, [{ endpoint: '/ui5vcs/v562/api/home/blockhome', count: 1 }]);
});

test('requests differing only in query order count as duplicates', () => {
    const s = summarizeApiUsage(
        [r('http://h/api/a?x=1&y=2'), r('http://h/api/a?y=2&x=1'), r('http://h/api/a?x=9')],
        []
    );
    assert.deepEqual(s.duplicates, [{ key: 'GET /api/a?x=1&y=2', count: 2 }]);
    assert.deepEqual(s.byEndpoint, [{ endpoint: '/api/a', count: 3 }]);
});

test('idle requests come 3s after the last input; null without input', () => {
    const reqs = [r('http://h/api/a', 1000), r('http://h/api/b', 4000), r('http://h/api/c', 9000)];
    assert.deepEqual(summarizeApiUsage(reqs, [500, 2000]).idle, [
        { endpoint: '/api/c', afterInputMs: 7000 }
    ]);
    assert.equal(summarizeApiUsage(reqs, []).idle, null);
});

test('endpoints sort by call count', () => {
    const s = summarizeApiUsage(
        [r('http://h/api/a'), r('http://h/api/b'), r('http://h/api/b')],
        []
    );
    assert.deepEqual(
        s.byEndpoint.map((e) => e.endpoint),
        ['/api/b', '/api/a']
    );
});

test('duplicate and idle counts ignore the list cap; duplicates exclude the first call', () => {
    const reqs = Array.from({ length: 25 }, (_, i) =>
        [0, 1, 2].map(() => r(`http://h/api/k${i}`, 10000))
    ).flat();
    const s = summarizeApiUsage(reqs, [1000]);
    assert.equal(s.duplicates.length, 20);
    assert.equal(s.duplicateCount, 50);
    assert.equal(s.idle.length, 20);
    assert.equal(s.idleCount, 75);
    assert.equal(summarizeApiUsage(reqs, []).idleCount, null);
});
