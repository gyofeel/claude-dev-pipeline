import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateVerdict } from '../../kit/report/gate.mjs';

const t = (over = {}) => ({
    anchor: 't-0',
    label: 'TC-09 홈',
    status: 'passed',
    failure: null,
    skipReason: null,
    timeline: [{ state: 'passed' }],
    loops: null,
    tcId: 'TC-09',
    ...over
});
const gate = (tests, acs = [], extra = {}) =>
    gateVerdict({ tests, acs, hasTcMd: true, partial: null, locale: 'ko', ...extra });

test('모두 깨끗하면 승인 가능', () => {
    assert.deepEqual(gate([t()]), { level: 'ok', reasons: [] });
});

test('TC 가 기대값을 확인 필요로 둔 cp 는 통과해도 실측값과 함께 확인 필요로 올린다', () => {
    const r = gate([
        t({
            timeline: [
                { key: 'cp-02', state: 'passed', desc: '메뉴 화면으로 이동' },
                {
                    key: 'cp-03',
                    state: 'passed',
                    desc: '상위 메뉴로 착지 [확인 필요: 착지 menu_id]',
                    actual: '/jump/home?menu_id=M2'
                }
            ]
        })
    ]);
    assert.equal(r.level, 'check');
    assert.deepEqual(
        r.reasons.map((x) => x.text),
        ['TC-09 홈 — cp-03 기대값 확인 필요 (실측: /jump/home?menu_id=M2)']
    );
});

test('통과한 cp 라도 실측값에 undefined·NaN 이 있으면 결함으로 올린다', () => {
    const r = gate([
        t({
            timeline: [
                {
                    key: 'cp-04',
                    state: 'passed',
                    desc: '대상 메뉴 ID 로 랜딩 [확인 필요: 실측 필요]',
                    actual: '/jump/home/0/U52_20/undefined?call_url=NM1'
                },
                { key: 'cp-05', state: 'passed', desc: '채널 번호', actual: 'ch=NaN' },
                { key: 'cp-06', state: 'passed', desc: '응답', actual: '{"undefinedFlag":null}' }
            ]
        })
    ]);
    assert.equal(r.level, 'defect');
    assert.deepEqual(
        r.reasons.filter((x) => x.level === 'defect').map((x) => x.text),
        [
            'TC-09 홈 — cp-04 실측값에 빈 값 (실측: /jump/home/0/U52_20/undefined?call_url=NM1)',
            'TC-09 홈 — cp-05 실측값에 빈 값 (실측: ch=NaN)'
        ]
    );
});

test('런타임 루프가 시험 데이터 부재로 판정한 실패는 결함이 아니라 확인 필요다', () => {
    const r = gate([
        t({
            status: 'failed',
            failure: { kind: 'assertion' },
            lastFailure: 'DATA: /api/home/menublock menu_id=NM1 → 9998 결과 값 없음',
            // 데이터가 없어 착지 경로에 빈 값이 찍혀도 결함으로 다시 세지 않는다
            timeline: [{ key: 'cp-02', state: 'failed', actual: '/jump/home/0/U52_20/undefined' }]
        })
    ]);
    assert.equal(r.level, 'check');
    assert.deepEqual(
        r.reasons.map((x) => x.text),
        ['TC-09 홈 — 시험 데이터 부재: /api/home/menublock menu_id=NM1 → 9998 결과 값 없음']
    );
});

test('cp 단언·판정·기타 실패는 결함', () => {
    for (const kind of ['assertion', 'judge', 'other']) {
        assert.equal(gate([t({ status: 'failed', failure: { kind } })]).level, 'defect', kind);
    }
});

test('setup·타임아웃·중단만 있으면 재실행 필요', () => {
    const r = gate([
        t({ status: 'failed', failure: { kind: 'setup' } }),
        t({ status: 'timedOut', failure: { kind: 'timeout' } })
    ]);
    assert.equal(r.level, 'rerun');
    assert.equal(r.reasons.length, 2);
});

test('결함과 재실행이 섞이면 결함이 이기고 이유는 모두 남는다', () => {
    const r = gate([
        t({ status: 'failed', failure: { kind: 'assertion' } }),
        t({ status: 'failed', failure: { kind: 'setup' } })
    ]);
    assert.equal(r.level, 'defect');
    assert.deepEqual(
        r.reasons.map((x) => x.level),
        ['defect', 'rerun']
    );
});

test('E2E 대상 AC 의 spec 이 없으면 결함, 부분 실행이면 평가하지 않는다', () => {
    const acs = [
        {
            id: 'AC-13',
            category: 'e2e',
            rows: [{ tcId: 'TC-15', state: 'missing', anchor: null }]
        }
    ];
    assert.equal(gate([t()], acs).level, 'defect');
    assert.equal(gate([t()], acs, { partial: { ran: 1, total: 2 } }).level, 'ok');
    assert.equal(gate([t()], acs, { hasTcMd: false }).level, 'ok');
});

test('확인 필요 항목: skip·판정 누락·매핑 불가·루프', () => {
    const r = gate([
        t({ status: 'skipped', skipReason: 'property 왕복 불가' }),
        t({ timeline: [{ state: 'unmarked' }] }),
        t({ tcId: null }),
        t({ loops: 3 })
    ]);
    assert.equal(r.level, 'check');
    assert.equal(r.reasons.length, 4);
    assert.match(r.reasons[0].text, /property 왕복 불가/);
});

test('루프 임계값 경계: 2회는 통과, 3회는 확인 필요', () => {
    assert.equal(gate([t({ loops: 2 })]).level, 'ok');
    assert.equal(gate([t({ loops: 3 })]).level, 'check');
});

test('tc.md 가 없으면 매핑 불가를 묻지 않는다', () => {
    assert.equal(gate([t({ tcId: null })], [], { hasTcMd: false }).level, 'ok');
});

test('같은 TC 때문에 빠진 AC 여러 개는 결론 한 줄로 묶는다', () => {
    const missing = (id) => ({
        id,
        category: 'e2e',
        rows: [{ tcId: 'TC-15', state: 'missing', anchor: null }]
    });
    const r = gate([t()], [missing('AC-13'), missing('AC-14')]);
    assert.equal(r.level, 'defect');
    assert.deepEqual(
        r.reasons.map((x) => x.text),
        ['TC-15 — spec 없음 (AC-13 · AC-14)']
    );
});

test('soft cp 는 확인 필요로 올리지 않는다 (dev 환경 한계)', () => {
    assert.equal(gate([t({ timeline: [{ state: 'soft' }] })]).level, 'ok');
});

test('en token in an en run raises needs-review; the ko token does not', () => {
    const tl = (desc) => [{ key: 'cp-03', state: 'passed', desc, actual: 'x' }];
    const en = gate([t({ timeline: tl('landing [verify: menu id]') })], [], { locale: 'en' });
    assert.deepEqual(en.reasons.map((x) => x.text), ['TC-09 홈 — cp-03 Expected value needs review (actual: x)']);
    assert.equal(gate([t({ timeline: tl('landing [확인 필요: x]') })], [], { locale: 'en' }).level, 'ok');
    assert.equal(gate([t({ timeline: tl('landing [verify: x]') })]).level, 'ok');
});

test('mock-unused is a defect', () => {
    const r = gate([t({ status: 'failed', failure: { kind: 'mock-unused' } })]);
    assert.equal(r.level, 'defect');
    assert.equal(r.reasons[0].text, 'TC-09 홈 — 목업 미사용');
});

test('the DATA: downgrade does not apply to mock-unused', () => {
    const r = gate([t({ status: 'failed', failure: { kind: 'mock-unused' }, lastFailure: 'DATA: x' })]);
    assert.equal(r.level, 'defect');
});
