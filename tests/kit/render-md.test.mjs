import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMd } from '../../kit/report/render-md.mjs';

const model = {
    locale: 'ko',
    title: '기능',
    slug: 'feat',
    runLabel: '3회차',
    generatedAt: '2026-10-06T05:02:00.000Z',
    counts: { passed: 1, failed: 1, skipped: 0 },
    gate: {
        level: 'rerun',
        reasons: [
            { level: 'rerun', text: 'TC-09 홈 — cp 도달 전 실패 (setup·환경)', anchor: 't-0' }
        ]
    },
    acs: [
        {
            id: 'AC-08',
            text: '유지 | 확인',
            category: 'e2e',
            rows: [
                {
                    tcId: 'TC-09',
                    tcName: '홈',
                    state: 'unverified',
                    cpPassed: 0,
                    cpTotal: 2
                }
            ]
        }
    ],
    otherAcs: [{ id: 'AC-01', text: '회신', category: 'unit', rows: [] }],
    tests: [
        {
            tcId: 'TC-09',
            title: '홈',
            status: 'failed',
            failure: { kind: 'setup' },
            durationMs: 60600,
            loops: 3,
            timeline: [{ key: 'cp-01', state: 'unreached' }]
        }
    ]
};

test('결론·AC 표·테스트 표·아카이브 경로를 담고 표 안의 | 를 이스케이프한다', () => {
    process.env.TZ = 'Asia/Seoul';
    const md = renderMd(model, {
        archivePath: 'playwright/ui-tests/reports/archive/261006/feat-03',
        openCommand: 'node e2e/kit/report/open.mjs'
    });
    assert.match(md, /^# E2E 리포트 — 기능/);
    assert.match(md, /- 실행: 2026-10-06 14:02 \(UTC\+09:00\) · 3회차/);
    assert.match(md, /- 결론: \*\*승인 불가 — 재실행 필요\*\*/);
    assert.match(md, /\| AC-08 \| 유지 \\\| 확인 \| TC-09 홈 \| 미검증 \(환경\) 0\/2 \|/);
    assert.match(
        md,
        /\| TC-09 \| 홈 \| cp 도달 전 실패 \(setup·환경\) \| 0\/1 \| — \| 60\.6s \| 3 \|/
    );
    assert.match(md, /E2E 대상 아님: AC-01 단위 테스트/);
    assert.match(md, /`playwright\/ui-tests\/reports\/archive\/261006\/feat-03\/e2e-report\.html`/);
});

test('테스트 표에 요청 열(총 N · 중복 n)을 둔다', () => {
    const api = {
        total: 7,
        byEndpoint: [],
        duplicates: [{ key: 'k', count: 3 }],
        duplicateCount: 2,
        idle: null,
        idleCount: null
    };
    const md = renderMd({ ...model, tests: [{ ...model.tests[0], api }] }, { archivePath: 'x', openCommand: 'open' });
    assert.match(md, /\| TC \| 테스트 \| 결과 \| cp \| 요청 \| 소요 \| 루프 \|/);
    assert.match(md, /\| 총 7 · 중복 2 \|/);
});

test('mock-unused row carries the unused mock list', () => {
    const t = {
        ...model.tests[0],
        status: 'failed',
        failure: { kind: 'mock-unused' },
        unusedMocks: ['**/api/a', '**/api/b']
    };
    const md = renderMd({ ...model, tests: [t] }, { archivePath: 'x', openCommand: 'open' });
    assert.match(md, /\| 목업 미사용: `\*\*\/api\/a`, `\*\*\/api\/b` \|/);
});

test('unusedMocks show on a test with another failure kind too', () => {
    const t = { ...model.tests[0], unusedMocks: ['**/api/a'] };
    const md = renderMd({ ...model, tests: [t] }, { archivePath: 'x', openCommand: 'open' });
    assert.match(md, /cp 도달 전 실패 \(setup·환경\): `\*\*\/api\/a` \|/);
});
