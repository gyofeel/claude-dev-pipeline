import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../../kit/services/analyze.js';

const settings = { backendErrorPatterns: [], locale: 'en' };

test('analyze judges with the current test status and keeps the legacy return shape', async () => {
    const r = await analyze(
        { consoleErrors: [{ text: 'TypeError: boom' }] },
        { testName: 't', domain: 'home', successCriteria: 's', acceptanceCriteria: [] },
        { currentTest: async () => ({ status: 'passed' }), settings }
    );
    assert.equal(r.status, 'FAIL');
    assert.equal(r.analysisError, false);
    assert.equal(r.testName, 't');
    assert.equal(r.domain, 'home');
});

test('a skipped test never fails, so legacy ACCEPTABLE_STATUSES = ["PASS"] passes', async () => {
    const r = await analyze({ consoleErrors: [{ text: 'TypeError' }] }, {}, { currentTest: async () => ({ status: 'skipped' }), settings });
    assert.equal(r.status, 'PASS');
    assert.equal(r.verdict, 'SKIP');
});

test('outside a Playwright test the status is unknown and cp rules are skipped', async () => {
    const r = await analyze({}, { acceptanceCriteria: [{ id: 'cp-01', desc: 'd', passed: false }] }, { settings });
    assert.equal(r.testStatus, 'unknown');
    assert.deepEqual(r.unmarked, []);
});
