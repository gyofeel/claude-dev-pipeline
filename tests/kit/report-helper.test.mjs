import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachAnalysisToReport, buildVerdictRecord } from '../../kit/utils/report-helper.js';

const result = {
    verdict: 'PASS',
    status: 'PASS',
    summary: 'cp 1/1 통과 · 클라이언트 에러 0',
    testMode: 'fixture',
    testStatus: 'passed',
    cp: [{ id: 'cp-01', desc: 'd', passed: true }],
    issues: [],
    excluded: [],
    testName: '홈 진입',
    domain: '홈',
    successCriteria: '홈이 보인다'
};

test('verdict 레코드는 런타임 원본을 잘라 담는다', () => {
    const long = 'x'.repeat(2000);
    const rec = buildVerdictRecord(
        result,
        {
            consoleErrors: Array.from({ length: 80 }, () => ({ text: long, timestamp: 't' })),
            consoleWarnings: [],
            exceptions: [],
            networkErrors: [],
            mockBoundary: { fixture: 2, empty: [], live: ['http://a/api'] }
        },
        result.cp
    );
    assert.equal(rec.schema, 1);
    assert.equal(rec.runtime.consoleErrors.length, 50);
    assert.equal(rec.runtime.consoleErrors[0].text.length, 500);
    assert.deepEqual(rec.mockBoundary.live, ['http://a/api']);
    assert.deepEqual(
        [rec.testName, rec.domain, rec.successCriteria],
        ['홈 진입', '홈', '홈이 보인다']
    );
});

test('attachAnalysisToReport 는 판정 annotation 1개와 verdict.json 을 붙인다', async () => {
    const attached = [];
    const testInfo = {
        annotations: [],
        attach: async (name, opts) => attached.push({ name, opts })
    };
    attachAnalysisToReport(testInfo, result, { consoleErrors: [] }, result.cp, { locale: 'ko' });
    assert.deepEqual(
        testInfo.annotations.map((a) => a.type),
        ['런타임 판정 ✅ PASS']
    );
    assert.equal(attached[0].name, 'verdict.json');
    assert.equal(JSON.parse(attached[0].opts.body).verdict, 'PASS');
});

test('verdict 레코드의 cp 에 실제 값과 soft 표시를 싣는다', () => {
    const rec = buildVerdictRecord(
        {
            ...result,
            cp: [
                { id: 'cp-01', desc: 'a', passed: true, actual: '0원' },
                { id: 'cp-02', desc: 'b', passed: false, soft: true, softReason: '미수신' }
            ]
        },
        {}
    );
    assert.deepEqual(rec.cp, [
        { id: 'cp-01', desc: 'a', passed: true, actual: '0원' },
        { id: 'cp-02', desc: 'b', passed: false, soft: true, softReason: '미수신' }
    ]);
});

test('buildVerdictRecord 는 api 를 그대로 싣고 없으면 null', () => {
    const api = { total: 1, byEndpoint: [], duplicates: [], idle: null };
    assert.deepEqual(buildVerdictRecord({ verdict: 'PASS' }, { api }).api, api);
    assert.equal(buildVerdictRecord({ verdict: 'PASS' }, {}).api, null);
});

test('verdict record carries mockHits from the judged result, else from runtime data, else {}', () => {
    const hits = { '**/api/a': 2, '**/api/b': 0 };
    assert.deepEqual(buildVerdictRecord({ ...result, mockHits: hits }, {}).mockHits, hits);
    assert.deepEqual(buildVerdictRecord(result, { mockHits: hits }).mockHits, hits);
    assert.deepEqual(buildVerdictRecord(result, {}).mockHits, {});
});

test('annotation text follows the locale', () => {
    const testInfo = { annotations: [], attach: () => {} };
    attachAnalysisToReport(testInfo, result, {}, result.cp);
    assert.equal(testInfo.annotations[0].type, 'Runtime verdict ✅ PASS');
});
