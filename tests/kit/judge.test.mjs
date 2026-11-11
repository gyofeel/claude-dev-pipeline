import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judge } from '../../kit/services/judge.js';

const BTV = ['^(ServerResultError|ServerError)\\b'];

const cp = (id, passed) => ({ id, desc: `${id} 설명`, passed });
const run = (runtimeData, testMeta = {}, testStatus = 'passed') =>
    judge({ runtimeData, testMeta, testStatus, backendErrorPatterns: BTV, locale: 'ko' });

// 과거 아카이브(2026-09) 실측 잔여 콘솔 에러 원문
const PAST_ERRORS = [
    'Failed to load resource: the server responded with a status of 404 ()',
    'ServerResultError: No Result Data: invalid EPS010 result/ Server: EPS\n    at http://localhost:5555/_nuxt/utils/blockUtils.js:1390:23',
    'ServerResultError: No Result Data: {"transactionId":"AAA"}/ Server: SMD\n    at Proxy.updateCouponsPointCash (http://localhost:5555/_nuxt/store/x.js:1:1)'
];

test('skip 된 테스트는 SKIP 이고 status 는 PASS 라 afterEach 가 throw 하지 않는다', () => {
    const r = run(
        { consoleErrors: [{ text: 'TypeError: boom' }] },
        { acceptanceCriteria: [cp('cp-01', false)] },
        'skipped'
    );
    assert.equal(r.verdict, 'SKIP');
    assert.equal(r.status, 'PASS');
    assert.deepEqual(r.issues, []);
});

test('fixture 모드의 ServerResultError 는 BE 응답 처리로 제외한다', () => {
    const r = run({ consoleErrors: [{ text: PAST_ERRORS[1] }] }, { testMode: 'fixture' });
    assert.equal(r.verdict, 'PASS');
    assert.equal(r.excluded[0].reason, 'be-response');
});

test('real-api·hybrid 모드의 ServerResultError 는 FAIL', () => {
    for (const testMode of ['real-api', 'hybrid']) {
        const r = run({ consoleErrors: [{ text: PAST_ERRORS[1] }] }, { testMode });
        assert.equal(r.verdict, 'FAIL', testMode);
        assert.equal(r.issues[0].type, 'console_error');
    }
});

test('Failed to load resource 는 콘솔 판정에서 제외한다 (모드 무관)', () => {
    const r = run({ consoleErrors: [{ text: PAST_ERRORS[0] }] }, { testMode: 'real-api' });
    assert.equal(r.verdict, 'PASS');
    assert.equal(r.excluded[0].reason, 'resource-load');
});

test('그 밖의 콘솔 에러는 FAIL', () => {
    const r = run({
        consoleErrors: [{ text: "TypeError: Cannot read properties of undefined (reading 'x')" }]
    });
    assert.equal(r.verdict, 'FAIL');
});

test('uncaught 예외는 스택 첫 줄로 분류한다', () => {
    const be = run(
        {
            exceptions: [
                { message: 'No Result Data', stack: 'ServerResultError: No Result Data\n at a' }
            ]
        },
        { testMode: 'fixture' }
    );
    assert.equal(be.verdict, 'PASS');
    const client = run({
        exceptions: [{ message: 'x is not a function', stack: 'TypeError: x is not a function' }]
    });
    assert.equal(client.verdict, 'FAIL');
    assert.equal(client.issues[0].type, 'exception');
});

test('api 4xx 는 real-api 에서만 FAIL, asset 은 항상 제외', () => {
    const api = { url: 'http://h/api/x', status: 500, kind: 'api' };
    const asset = { url: 'http://h/a.png', status: 404, kind: 'asset' };
    assert.equal(run({ networkErrors: [api] }, { testMode: 'real-api' }).verdict, 'FAIL');
    const fixture = run({ networkErrors: [api, asset] }, { testMode: 'fixture' });
    assert.equal(fixture.verdict, 'PASS');
    assert.deepEqual(
        fixture.excluded.map((e) => e.reason),
        ['mock-scope', 'asset']
    );
});

test('통과한 테스트에서 플래그가 false 인 cp 는 판정 누락으로 남기되 FAIL 시키지 않는다 (soft-track)', () => {
    const r = run({}, { acceptanceCriteria: [cp('cp-01', true), cp('cp-02', false)] });
    assert.equal(r.verdict, 'PASS');
    assert.equal(r.status, 'PASS');
    assert.deepEqual(r.issues, []);
    assert.deepEqual(r.unmarked, ['cp-02']);
});

test('이미 실패한 테스트는 cp 를 다시 세지 않는다', () => {
    const r = run({}, { acceptanceCriteria: [cp('cp-01', false)] }, 'failed');
    assert.equal(r.verdict, 'PASS');
    assert.deepEqual(r.unmarked, []);
});

test('testStatus 를 모르면 cp 규칙을 건너뛴다', () => {
    const r = run({}, { acceptanceCriteria: [cp('cp-01', false)] }, 'unknown');
    assert.equal(r.verdict, 'PASS');
});

test('과거 아카이브 잔여 에러 3종은 fixture 모드에서 FAIL 0건', () => {
    const r = run(
        { consoleErrors: PAST_ERRORS.map((text) => ({ text })) },
        { testMode: 'fixture', acceptanceCriteria: [cp('cp-01', true)] }
    );
    assert.equal(r.verdict, 'PASS');
    assert.equal(r.excluded.length, 3);
});

test('summary 는 cp·클라이언트 에러·제외 사유별 건수를 담는다', () => {
    const r = run(
        { consoleErrors: [{ text: PAST_ERRORS[1] }, { text: PAST_ERRORS[2] }] },
        {
            testMode: 'fixture',
            acceptanceCriteria: [cp('cp-01', true), cp('cp-02', true)],
            whitelistedErrors: { filteredCount: 2, patterns: ['net::ERR_FAILED'] }
        }
    );
    assert.equal(r.summary, 'cp 2/2 통과 · 클라이언트 에러 0 · 제외 4 (화이트리스트 2 · BE 2)');
});

test('without backendErrorPatterns a ServerResultError is a client error even in fixture mode', () => {
    const r = judge({ runtimeData: { consoleErrors: [{ text: PAST_ERRORS[1] }] }, testMeta: {}, testStatus: 'passed' });
    assert.equal(r.verdict, 'FAIL');
    assert.equal(r.issues[0].type, 'console_error');
});

test('legacy live-data mode is strict like real-api', () => {
    const r = judge({
        runtimeData: { networkErrors: [{ kind: 'api', status: 404, url: 'http://x/api/a' }] },
        testMeta: { testMode: 'live-data' },
        testStatus: 'passed'
    });
    assert.equal(r.verdict, 'FAIL');
});

test('english summary by default', () => {
    const r = judge({ runtimeData: {}, testMeta: { acceptanceCriteria: [{ id: 'cp-01', desc: 'd', passed: true }] }, testStatus: 'passed' });
    assert.equal(r.summary, 'cp 1/1 passed · client errors 0');
});

test('mockHits from the caller is carried unchanged; absent means {}', () => {
    const mockHits = { '**/api/a': 2, '**/api/b': 0 };
    assert.deepEqual(judge({ runtimeData: {}, testMeta: { mockHits }, testStatus: 'passed' }).mockHits, mockHits);
    assert.deepEqual(judge({ runtimeData: { mockHits }, testMeta: {}, testStatus: 'passed' }).mockHits, mockHits);
    assert.deepEqual(judge({ runtimeData: {}, testMeta: {}, testStatus: 'passed' }).mockHits, {});
    assert.equal(judge({ runtimeData: {}, testMeta: { mockHits: { x: 0 } }, testStatus: 'passed' }).verdict, 'PASS');
});

test('an exception recorded by the collector (text, no message) is judged by its text', () => {
    const r = run({ exceptions: [{ type: 'exception', text: 'x is not a function' }] });
    assert.equal(r.verdict, 'FAIL');
    assert.equal(r.issues[0].detail, 'x is not a function');
});
