import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHtml } from '../../kit/report/render-html.mjs';

const testModel = (over = {}) => ({
    anchor: 't-0',
    id: 'abc',
    file: 'feat/btc-a.spec.js',
    title: '홈 유지',
    label: 'TC-09 홈 유지',
    tcId: 'TC-09',
    status: 'passed',
    durationMs: 4900,
    failure: null,
    timeline: [{ key: 'cp-01', title: 'cp-01: 노출', state: 'passed', durationMs: 12 }],
    skipReason: null,
    verdict: 'PASS',
    summary: 'cp 1/1 통과',
    issues: [],
    excluded: [],
    mockBoundary: { fixture: 2, empty: [], live: ['http://h/api/gnb'] },
    runtime: { consoleErrors: [], consoleWarnings: [], exceptions: [], networkErrors: [] },
    loops: null,
    lastFailure: null,
    attention: false,
    ...over
});
const model = (tests, over = {}) => ({
    locale: 'ko',
    title: '기능',
    slug: 'feat',
    tag: 'feat',
    runLabel: '3회차',
    generatedAt: '2026-10-06T05:02:00.000Z',
    prevHref: '../../261005/feat-02/e2e-report.html',
    partial: null,
    hasTcMd: true,
    counts: { passed: 1, failed: 0, skipped: 0 },
    tests,
    acs: [
        {
            id: 'AC-08',
            text: '유지',
            category: 'e2e',
            rows: [
                {
                    tcId: 'TC-09',
                    tcName: '홈',
                    state: 'passed',
                    anchor: 't-0',
                    cpPassed: 1,
                    cpTotal: 1
                }
            ]
        }
    ],
    otherAcs: [{ id: 'AC-01', text: '회신', category: 'unit', rows: [] }],
    gate: { level: 'ok', reasons: [] },
    ...over
});

test('결론·AC 행 링크·직전 회차 링크·Playwright 링크를 담는다', () => {
    const html = renderHtml(model([testModel()]));
    assert.match(html, /<!doctype html>/i);
    assert.match(html, /승인 가능/);
    assert.match(html, /href="#t-0"/);
    assert.match(html, /href="\.\.\/\.\.\/261005\/feat-02\/e2e-report\.html"/);
    assert.match(html, /href="index\.html#\?testId=abc"/);
    assert.match(html, /prefers-color-scheme: dark/);
    assert.doesNotMatch(html, /<script src=|<link rel="stylesheet"/);
});

test('주의 카드는 펼치고 깨끗한 PASS 는 접는다', () => {
    const html = renderHtml(
        model([
            testModel({
                anchor: 't-0',
                attention: true,
                status: 'failed',
                failure: { kind: 'setup', message: 'Timeout', location: null }
            }),
            testModel({ anchor: 't-1', attention: false })
        ])
    );
    assert.match(html, /<details class="card" id="t-0" open>/);
    assert.match(html, /<details class="card" id="t-1">/);
    assert.match(html, /cp 도달 전 실패/);
});

test('로그 원문의 HTML 특수문자를 이스케이프한다', () => {
    const html = renderHtml(
        model([
            testModel({
                attention: true,
                issues: [
                    {
                        type: 'console_error',
                        message: '클라이언트 콘솔 에러',
                        detail: '<script>alert(1)</script> & "q"'
                    }
                ]
            })
        ])
    );
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;q&quot;/);
});

test('부분 실행이면 안내를 표시한다', () => {
    const html = renderHtml(model([testModel()], { partial: { ran: 1, total: 2 } }));
    assert.match(html, /부분 실행: spec 1\/2/);
});

test('cp 썸네일이 있으면 이미지로 넣는다', () => {
    const html = renderHtml(
        model([
            testModel({
                timeline: [
                    {
                        key: 'cp-01',
                        title: 'cp-01: 노출',
                        state: 'passed',
                        durationMs: 12,
                        thumb: 'data:image/jpeg;base64,AA'
                    }
                ]
            })
        ])
    );
    assert.match(html, /<img class="thumb" src="data:image\/jpeg;base64,AA" alt="cp-01">/);
});

test('time shows the UTC offset; body is centred', () => {
    process.env.TZ = 'Asia/Seoul';
    const html = renderHtml(model([testModel()]));
    assert.match(html, /2026-10-06 14:02 \(UTC\+09:00\)/);
    assert.match(html, /\.wrap\{max-width:1100px;margin:0 auto/);
});

test('AC 번호 열은 줄바꿈하지 않는다', () => {
    assert.match(renderHtml(model([testModel()])), /td\.mono\{white-space:nowrap/);
});

test('cp 실제 값과 soft 표시를 보여 준다', () => {
    const html = renderHtml(
        model([
            testModel({
                timeline: [
                    {
                        key: 'cp-01',
                        title: 'cp-01: 가격',
                        desc: '가격',
                        state: 'passed',
                        durationMs: 5,
                        actual: '7일간 0원'
                    },
                    {
                        key: 'cp-02',
                        title: 'cp-02: 재생',
                        desc: '재생',
                        state: 'soft',
                        durationMs: 5,
                        softReason: 'playStatus 미수신'
                    }
                ]
            })
        ])
    );
    assert.match(html, /실제: 7일간 0원/);
    assert.match(html, /실기기 재검증 필요/);
    assert.match(html, /playStatus 미수신/);
});

test('테스트 카드에 API 호출 요약을 보여 주고, 중복·유휴가 있으면 목록을 단다', () => {
    const html = renderHtml(
        model([
            testModel({
                api: {
                    total: 7,
                    byEndpoint: [{ endpoint: '/api/a', count: 5 }],
                    duplicates: [{ key: 'GET /api/a', count: 3 }],
                    duplicateCount: 2,
                    idle: [{ endpoint: '/api/b', afterInputMs: 4200 }],
                    idleCount: 25
                }
            })
        ])
    );
    assert.match(html, /API 호출 7 · 중복 2 · 유휴 25/);
    assert.match(html, /GET \/api\/a/);
    assert.match(html, /\/api\/b/);
});

test('API 기록이 없거나 keydown 이 없으면 — 로 표시한다', () => {
    assert.match(renderHtml(model([testModel({ api: null })])), /API 호출 기록 없음/);
    assert.match(
        renderHtml(
            model([
                testModel({
                    api: {
                        total: 2,
                        byEndpoint: [],
                        duplicates: [],
                        duplicateCount: 0,
                        idle: null,
                        idleCount: null
                    }
                })
            ])
        ),
        /API 호출 2 · 중복 0 · 유휴 —/
    );
});

test('english locale renders english labels and lang attribute', () => {
    const html = renderHtml({ ...model([testModel()]), locale: 'en' });
    assert.match(html, /<html lang="en">/);
    assert.match(html, /<title>E2E report · /);
    assert.match(html, />Conclusion</);
});

test('mock-unused failure row lists the unused mocks', () => {
    const html = renderHtml(
        model([
            testModel({
                attention: true,
                status: 'failed',
                failure: { kind: 'mock-unused', message: '', location: null },
                unusedMocks: ['**/api/a', '**/api/b&c']
            })
        ])
    );
    assert.match(html, /목업 미사용/);
    assert.match(html, /<code>\*\*\/api\/a<\/code>/);
    assert.match(html, /<code>\*\*\/api\/b&amp;c<\/code>/);
});

test('unusedMocks show on a test with another failure kind too', () => {
    const html = renderHtml(
        model([
            testModel({
                attention: true,
                status: 'failed',
                failure: { kind: 'setup', message: 'Timeout', location: null },
                unusedMocks: ['**/api/a']
            })
        ])
    );
    assert.match(html, /cp 도달 전 실패/);
    assert.match(html, /<code>\*\*\/api\/a<\/code>/);
});

test('JS exceptions render the collector text field', () => {
    const runtime = { consoleErrors: [], consoleWarnings: [], exceptions: [{ type: 'exception', text: 'boom in render', stack: 'Error: boom in render\n at x' }], networkErrors: [] };
    const html = renderHtml(model([testModel({ runtime })]));
    assert.match(html, /<code>boom in render<\/code>/);
});
