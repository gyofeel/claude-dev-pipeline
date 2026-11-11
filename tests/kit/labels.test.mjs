import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labels, formatTime } from '../../kit/report/labels.mjs';

const shape = (o) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v && typeof v === 'object' ? shape(v) : typeof v]));

test('en and ko expose the same keys with the same value kinds', () => {
    assert.deepEqual(shape(labels('ko')), shape(labels('en')));
});

test('unknown locale falls back to en', () => {
    assert.equal(labels('fr').gate.ok, labels('en').gate.ok);
});

test('soft step label names the platform when one is configured', () => {
    assert.equal(labels('en').stepState.soft, 'Recheck on device');
    assert.equal(labels('ko', { platformLabel: 'Native' }).stepState.soft, 'Native 응답 의존 — 실기기 재검증 필요');
});

test('judge summary keeps the original Korean wording', () => {
    const ko = labels('ko');
    assert.equal(
        ko.judgeSummary({ cpPassed: 2, cpTotal: 3, clientErrors: 0, excluded: [['be-response', 2], ['asset', 1]] }),
        'cp 2/3 통과 · 클라이언트 에러 0 · 제외 3 (BE 2 · 자산 1)'
    );
    assert.equal(ko.judgeSummary({ cpPassed: 1, cpTotal: 1, clientErrors: 0, excluded: [] }), 'cp 1/1 통과 · 클라이언트 에러 0');
});

test('formatTime prints local time with the UTC offset', () => {
    process.env.TZ = 'Asia/Seoul';
    assert.equal(formatTime('2026-10-29T05:04:00.000Z'), '2026-10-29 14:04 (UTC+09:00)');
    process.env.TZ = 'UTC';
    assert.equal(formatTime('2026-10-29T05:04:00.000Z'), '2026-10-29 05:04 (UTC+00:00)');
});

test('gate and failure keys added for data-absence and unused mocks', () => {
    const ko = labels('ko');
    const en = labels('en');
    assert.equal(ko.gate.testDataAbsent, '시험 데이터 부재');
    assert.equal(ko.gate.missingValue, '실측값에 빈 값');
    assert.equal(ko.gate.expectedNeedsCheck, '기대값 확인 필요');
    assert.equal(ko.failure['mock-unused'], '목업 미사용');
    assert.equal(en.failure['mock-unused'], 'mock never used');
    for (const k of ['testDataAbsent', 'missingValue', 'expectedNeedsCheck']) assert.ok(en.gate[k]);
});
