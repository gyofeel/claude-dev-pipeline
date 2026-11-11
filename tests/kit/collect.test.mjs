import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    classifyFailure,
    buildTimeline,
    resolveTcIds,
    collectRun
} from '../../kit/report/collect.mjs';
import { parseTcMd } from '../../kit/report/tc-md.mjs';
import { labelsFor } from '../../kit/artifact-labels.mjs';

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64');
const verdictOf = (over = {}) => ({
    schema: 1,
    verdict: 'PASS',
    status: 'PASS',
    summary: 's',
    testMode: 'fixture',
    cp: [
        { id: 'cp-01', desc: '첫째', passed: true },
        { id: 'cp-02', desc: '둘째', passed: true }
    ],
    issues: [],
    excluded: [],
    mockBoundary: { fixture: 1, empty: [], live: [] },
    runtime: { consoleErrors: [], consoleWarnings: [], exceptions: [], networkErrors: [] },
    ...over
});
const verdictAtt = (v) => ({ name: 'verdict.json', contentType: 'application/json', body: b64(v) });
const step = (title, error = false, duration = 10) => ({
    title,
    duration,
    ...(error ? { error: { message: 'x' } } : {})
});
const result = (over = {}) => ({
    status: 'passed',
    duration: 1000,
    errors: [],
    steps: [step('setup: 진입'), step('cp-01: 첫째'), step('cp-02: 둘째')],
    annotations: [],
    attachments: [verdictAtt(verdictOf())],
    ...over
});
const spec = (file, line, title, res) => ({
    title,
    file,
    line,
    id: `id-${line}`,
    tests: [{ annotations: [], results: [res] }]
});
const resultsOf = (specs) => ({
    config: { rootDir: '/r' },
    suites: [{ title: 'f', specs, suites: [] }]
});

test('classifyFailure: 우선순위 timeout > cp 단언 > 판정 > setup > 기타', () => {
    assert.equal(classifyFailure({ status: 'passed' }), null);
    assert.equal(
        classifyFailure({ status: 'timedOut', errors: [{ message: 'x' }] }).kind,
        'timeout'
    );
    assert.equal(classifyFailure({ status: 'interrupted' }).kind, 'interrupted');
    assert.equal(
        classifyFailure({
            status: 'failed',
            steps: [step('cp-01: a', true)],
            errors: [{ message: 'e' }]
        }).kind,
        'assertion'
    );
    assert.equal(
        classifyFailure({
            status: 'failed',
            steps: [step('cp-01: a')],
            verdict: { verdict: 'FAIL' }
        }).kind,
        'judge'
    );
    const setup = classifyFailure({
        status: 'failed',
        steps: [],
        errors: [
            {
                message: 'TimeoutError: page.waitForFunction: Timeout 60000ms exceeded.',
                location: { file: '/x/render-helper.js', line: 44 }
            }
        ]
    });
    assert.equal(setup.kind, 'setup');
    assert.equal(setup.location.line, 44);
    assert.equal(classifyFailure({ status: 'failed', steps: [step('cp-01: a')] }).kind, 'other');
});

test('buildTimeline: setup 실패면 cp 는 모두 미도달', () => {
    const v = verdictOf({
        cp: [
            { id: 'cp-01', desc: 'a', passed: false },
            { id: 'cp-02', desc: 'b', passed: false }
        ]
    });
    const tl = buildTimeline({
        steps: [],
        verdict: v,
        status: 'failed',
        failure: { kind: 'setup' },
        durationMs: 60600
    });
    assert.deepEqual(
        tl.map((s) => [s.key, s.state]),
        [
            ['setup', 'failed'],
            ['cp-01', 'unreached'],
            ['cp-02', 'unreached']
        ]
    );
});

test('buildTimeline: 통과한 테스트의 꺼진 플래그는 판정 누락, skip 은 미실행', () => {
    const v = verdictOf({
        cp: [
            { id: 'cp-01', desc: 'a', passed: true },
            { id: 'cp-02', desc: 'b', passed: false }
        ]
    });
    const passed = buildTimeline({
        steps: [step('cp-01: a'), step('cp-02: b')],
        verdict: v,
        status: 'passed'
    });
    assert.deepEqual(
        passed.map((s) => s.state),
        ['passed', 'unmarked']
    );
    const skipped = buildTimeline({ steps: [], verdict: v, status: 'skipped' });
    assert.deepEqual(
        skipped.map((s) => s.state),
        ['not-run', 'not-run']
    );
});

test('resolveTcIds: tc.md spec 파일명 > 파일명 tcNN > 헤더 TC 목록', () => {
    const tcMd = parseTcMd(
        '# X Test Cases\n\n### TC-03: a\n\n| **Spec file** | `btc-named.spec.js` |\n'
    );
    const none = () => '';
    assert.deepEqual(resolveTcIds('d/btc-named.spec.js', 1, { tcMd, readHeader: none, specFilePrefix: 'btc-' }), ['TC-03']);
    assert.deepEqual(resolveTcIds('d/btc-tc14-toast.spec.js', 1, { tcMd, readHeader: none, specFilePrefix: 'btc-' }), [
        'TC-14'
    ]);
    const header = () => '// btc-x.spec.js\n// TC-09 · TC-10 · TC-11 · TC-13 — 묶음\n';
    assert.deepEqual(resolveTcIds('d/btc-x.spec.js', 4, { tcMd, readHeader: header, specFilePrefix: 'btc-' }), [
        'TC-09',
        'TC-10',
        'TC-11',
        'TC-13'
    ]);
});

test('resolveTcIds: 묶음 헤더 TC 수와 테스트 수가 다르면 null', () => {
    const header = () => '// btc-x.spec.js\n// TC-09 · TC-10 — 묶음\n';
    assert.equal(resolveTcIds('d/btc-x.spec.js', 3, { tcMd: null, readHeader: header, specFilePrefix: 'btc-' }), null);
    assert.equal(
        resolveTcIds('d/btc-tc09-13-x.spec.js', 1, { tcMd: null, readHeader: () => '', specFilePrefix: 'btc-' }),
        null
    );
});

const TC_MD = `# Feature Test Cases

## 수용 기준

- [ ] **AC-08**: 화면 유지
- [ ] **AC-12**: 토스트 문구
- [ ] **AC-13**: 로딩 문구
- [ ] **AC-01**: 회신

### TC-01: 회신

| **Related AC** | AC-01 |
| **E2E suitability** | unit |

### TC-09: 홈 유지

| **Related AC** | AC-08 |
| **E2E suitability** | ${labelsFor('ko')['tc.e2eFit.e2e']} |

### TC-14: 토스트

| **Related AC** | AC-12 |
| **E2E suitability** | ${labelsFor('ko')['tc.e2eFit.e2e']} |

### TC-15: 로딩

| **Related AC** | AC-13 |
| **E2E suitability** | ${labelsFor('ko')['tc.e2eFit.e2e']} |
`;

test('collectRun: 실패 분류·TC 매핑·AC 행·게이트를 묶는다', () => {
    const results = resultsOf([
        spec(
            'feat/btc-bundle.spec.js',
            10,
            'B tv 홈 유지',
            result({
                status: 'failed',
                steps: [],
                errors: [
                    {
                        message: 'TimeoutError: page.waitForFunction',
                        location: { file: '/x/render-helper.js', line: 44 }
                    }
                ],
                attachments: [
                    verdictAtt(verdictOf({ cp: [{ id: 'cp-01', desc: 'a', passed: false }] }))
                ]
            })
        ),
        spec(
            'feat/btc-tc14-toast.spec.js',
            5,
            '토스트 노출',
            result({
                attachments: [
                    verdictAtt(verdictOf())
                ]
            })
        )
    ]);
    const model = collectRun({
        locale: 'ko',
        specFilePrefix: 'btc-',
        results,
        tcMd: parseTcMd(TC_MD),
        loops: { 'btc-tc14-toast.spec.js': { loops: 2, lastFailure: null } },
        slug: 'feat',
        tag: 'feat',
        nn: '03',
        dirSpecFiles: ['feat/btc-bundle.spec.js', 'feat/btc-tc14-toast.spec.js'],
        readHeader: (f) =>
            f.endsWith('btc-bundle.spec.js') ? '// btc-bundle.spec.js\n// TC-09 — 홈\n' : '',
        now: new Date('2026-10-06T05:02:00Z')
    });

    assert.equal(model.runLabel, '3회차');
    assert.equal(model.title, 'Feature');
    assert.deepEqual(model.counts, { passed: 1, failed: 1, skipped: 0 });
    assert.equal(model.tests[0].tcId, 'TC-09');
    assert.equal(model.tests[0].failure.kind, 'setup');
    assert.equal(model.tests[0].attention, true);
    assert.equal(model.tests[1].tcId, 'TC-14');
    assert.equal(model.tests[1].loops, 2);

    const row = (acId) => model.acs.find((a) => a.id === acId).rows[0];
    assert.equal(row('AC-08').state, 'unverified');
    assert.equal(row('AC-12').state, 'passed');
    assert.equal(row('AC-13').state, 'missing');
    assert.equal(model.otherAcs.find((a) => a.id === 'AC-01').category, 'unit');

    assert.equal(model.gate.level, 'defect');
    assert.equal(model.partial, null);
});

test('collectRun: 부분 실행이면 미실행 TC 는 이번 실행 제외', () => {
    const results = resultsOf([spec('feat/btc-tc14-toast.spec.js', 5, '토스트', result())]);
    const model = collectRun({
        locale: 'ko',
        specFilePrefix: 'btc-',
        results,
        tcMd: parseTcMd(TC_MD),
        slug: 'feat',
        tag: 'btc-tc14-toast',
        nn: '01',
        dirSpecFiles: ['feat/btc-bundle.spec.js', 'feat/btc-tc14-toast.spec.js'],
        readHeader: (f) => (f.endsWith('btc-bundle.spec.js') ? '// x\n// TC-09 — 홈\n' : '')
    });
    assert.deepEqual(model.partial, { ran: 1, total: 2 });
    assert.equal(model.acs.find((a) => a.id === 'AC-08').rows[0].state, 'not-in-run');
});

test('collectRun: 재시도가 있으면 마지막 결과를 쓰고, verdict 가 없어도 깨지지 않는다', () => {
    const first = result({ status: 'failed', steps: [step('cp-01: a', true)] });
    const last = result({ attachments: [] });
    const results = resultsOf([
        {
            ...spec('feat/btc-tc14-x.spec.js', 1, 't', first),
            tests: [{ annotations: [], results: [first, last] }]
        }
    ]);
    const model = collectRun({ results, tag: 'run', nn: '01', locale: 'ko', specFilePrefix: 'btc-' });
    assert.equal(model.tests[0].status, 'passed');
    assert.equal(model.tests[0].verdict, null);
    assert.deepEqual(
        model.tests[0].timeline.map((s) => s.key),
        ['setup', 'cp-01', 'cp-02']
    );
});

test('collectRun: thumbsFor 가 준 cp 썸네일을 타임라인에 붙인다', () => {
    const results = resultsOf([spec('feat/btc-tc14-x.spec.js', 1, 't', result())]);
    const model = collectRun({
        locale: 'ko',
        specFilePrefix: 'btc-',
        results,
        tag: 'run',
        nn: '01',
        thumbsFor: () => new Map([['cp-02', 'data:image/jpeg;base64,AA']])
    });
    const byKey = Object.fromEntries(model.tests[0].timeline.map((s) => [s.key, s.thumb]));
    assert.equal(byKey['cp-02'], 'data:image/jpeg;base64,AA');
    assert.equal(byKey['cp-01'], undefined);
});

test('collectRun: 헤더에 TC 가 없는 묶음 spec 은 describe 제목을 tc.md TC 이름과 대조해 매핑한다', () => {
    const tcMd = parseTcMd(`# Feature Test Cases

- [ ] **AC-01**: 노출
- [ ] **AC-02**: 미노출

### TC-01: 프로필 등록 타일 포커스 시 툴팁 노출

| **Related AC** | AC-01 |
| **E2E suitability** | ${labelsFor('ko')['tc.e2eFit.e2e']} |
| **Spec file** | \`btc-tc01-add-tile-tooltip-show.spec.js\` |

### TC-02: 포커스 이탈 시 툴팁 미노출

| **Related AC** | AC-02 |
| **E2E suitability** | ${labelsFor('ko')['tc.e2eFit.e2e']} |
`);
    const results = {
        config: { rootDir: '/r' },
        suites: [
            {
                title: 'feat/btc-tc01-02-add-tile-tooltip.spec.js',
                specs: [],
                suites: [
                    {
                        title: '프로필 등록 타일 포커스 시 툴팁 노출',
                        specs: [
                            spec(
                                'feat/btc-tc01-02-add-tile-tooltip.spec.js',
                                150,
                                '노출 확인',
                                result()
                            )
                        ]
                    },
                    {
                        title: '포커스 이탈 시 툴팁 미노출',
                        specs: [
                            spec(
                                'feat/btc-tc01-02-add-tile-tooltip.spec.js',
                                236,
                                '미노출 확인',
                                result()
                            )
                        ]
                    }
                ]
            }
        ]
    };
    const model = collectRun({
        locale: 'ko',
        specFilePrefix: 'btc-',
        results,
        tcMd,
        slug: 'feat',
        tag: 'feat',
        nn: '01',
        dirSpecFiles: ['feat/btc-tc01-02-add-tile-tooltip.spec.js'],
        readHeader: () => '// btc-tc01-02-add-tile-tooltip.spec.js\n// 설명만 있음\n'
    });
    assert.deepEqual(
        model.tests.map((t) => t.tcId),
        ['TC-01', 'TC-02']
    );
    assert.equal(model.gate.level, 'ok');
});

test('classifyFailure: cp 에 도달하지 못한 실패는 판정 FAIL 이 함께 있어도 setup 으로 본다', () => {
    const r = classifyFailure({
        status: 'failed',
        steps: [],
        errors: [{ message: 'TimeoutError: waitForAppReady' }],
        verdict: { verdict: 'FAIL' }
    });
    assert.equal(r.kind, 'setup');
});

test('classifyFailure: 에러 메시지의 ANSI 색상 코드를 지운다', () => {
    const r = classifyFailure({
        status: 'failed',
        steps: [step('cp-01: a', true)],
        errors: [
            {
                message:
                    '\u001b[2mexpect(\u001b[22m\u001b[31mlocator\u001b[39m\u001b[2m).\u001b[22mtoHaveText'
            }
        ]
    });
    assert.equal(r.message, 'expect(locator).toHaveText');
});

test('collectRun: verdict 의 해설용 메타를 싣는다', () => {
    const results = resultsOf([
        spec(
            'feat/btc-tc14-x.spec.js',
            1,
            't',
            result({
                attachments: [
                    verdictAtt(
                        verdictOf({ testName: '토스트', domain: '홈', successCriteria: 'sc' })
                    )
                ]
            })
        )
    ]);
    const model = collectRun({ results, tag: 'run', nn: '01', locale: 'ko', specFilePrefix: 'btc-' });
    assert.deepEqual(model.tests[0].meta, {
        testName: '토스트',
        domain: '홈',
        testMode: 'fixture',
        successCriteria: 'sc'
    });
    assert.equal(model.gate.level, 'ok');
});

test('buildTimeline: cp 실제 값을 싣고, soft cp 는 판정 누락 대신 soft 상태로 둔다', () => {
    const v = verdictOf({
        cp: [
            { id: 'cp-01', desc: 'a', passed: true, actual: '0원' },
            { id: 'cp-02', desc: 'b', passed: false, soft: true, softReason: '미수신' }
        ]
    });
    const tl = buildTimeline({
        steps: [step('cp-01: a'), step('cp-02: b')],
        verdict: v,
        status: 'passed'
    });
    assert.equal(tl[0].actual, '0원');
    assert.equal(tl[1].state, 'soft');
    assert.equal(tl[1].softReason, '미수신');
});

test('resolveTcIds escapes regex characters in the spec file prefix', () => {
    assert.deepEqual(resolveTcIds('dir/app.tc07-x.spec.js', 1, { specFilePrefix: 'app.' }), ['TC-07']);
    assert.equal(resolveTcIds('dir/appXtc07-x.spec.js', 1, { specFilePrefix: 'app.' }), null);
});

test('collectRun uses the english setup step and run label by default', () => {
    const model = collectRun({
        results: { suites: [{ title: 'a.spec.js', specs: [{ id: 'x', title: 't', file: 'd/a.spec.js', line: 1, tests: [{ results: [{ status: 'failed', errors: [{ message: 'boom' }], steps: [] }] }] }] }] },
        tag: 'a',
        nn: '02'
    });
    assert.equal(model.runLabel, 'run 2');
    assert.equal(model.tests[0].timeline[0].title, 'Entry / setup (beforeEach)');
});

const hitsSpec = (file, line, hits) =>
    spec(file, line, `t${line}`, result({ attachments: [verdictAtt(verdictOf(hits ? { mockHits: hits } : {}))] }));
const run = (specs) => collectRun({ results: resultsOf(specs), tag: 'x', nn: '01' });

test('mock hits summed per pattern across a file keep every test PASS', () => {
    const model = run([
        hitsSpec('d/a.spec.js', 1, { '**/api/a': 1, '**/api/b': 0 }),
        hitsSpec('d/a.spec.js', 2, { '**/api/a': 0, '**/api/b': 2 })
    ]);
    assert.deepEqual(model.tests.map((t) => t.status), ['passed', 'passed']);
    assert.equal(model.gate.level, 'ok');
});

test('a pattern no test of the file hit turns every test of that file into mock-unused FAIL', () => {
    const model = run([
        hitsSpec('d/a.spec.js', 1, { '**/api/a': 1, '**/api/b': 0 }),
        hitsSpec('d/a.spec.js', 2, { '**/api/a': 0, '**/api/b': 0 }),
        hitsSpec('d/b.spec.js', 1, { '**/api/a': 1 })
    ]);
    const [a1, a2, b1] = model.tests;
    for (const t of [a1, a2]) {
        assert.equal(t.status, 'failed');
        assert.equal(t.failure.kind, 'mock-unused');
        assert.deepEqual(t.unusedMocks, ['**/api/b']);
        assert.equal(t.attention, true);
    }
    assert.equal(b1.status, 'passed');
    assert.equal(model.counts.failed, 2);
    assert.equal(model.gate.level, 'defect');
});

test('a file whose verdicts carry no mock hits is left alone', () => {
    const model = run([hitsSpec('d/a.spec.js', 1, {}), hitsSpec('d/a.spec.js', 2, null)]);
    assert.deepEqual(model.tests.map((t) => t.status), ['passed', 'passed']);
    assert.equal(model.tests[0].unusedMocks, undefined);
});

test('collectRun categorises a ko tc.md with the run locale', () => {
    const K = labelsFor('ko');
    const row = (k, v) => `| **${K[k]}** | ${v} |`;
    const tcMd = parseTcMd(
        `# 기능 ${K['tc.titleSuffix']}\n\n- [ ] **AC-01**: a\n- [ ] **AC-02**: b\n\n` +
            `### TC-01: a\n\n${row('tc.relatedAc', 'AC-01')}\n${row('tc.field.e2eSuitability', K['tc.e2eFit.e2e'])}\n\n` +
            `### TC-02: b\n\n${row('tc.relatedAc', 'AC-02')}\n${row('tc.field.e2eSuitability', K['tc.e2eFit.manual'])}\n`,
        { locale: 'ko' }
    );
    const model = collectRun({
        results: resultsOf([spec('d/tc01-a.spec.js', 1, 'a', result())]),
        tcMd,
        tag: 'x',
        locale: 'ko'
    });
    assert.deepEqual(model.acs.map((a) => a.id), ['AC-01']);
    assert.equal(model.otherAcs.find((a) => a.id === 'AC-02').category, 'manual');
});

const hitsResult = (hits, over = {}) =>
    result({ attachments: [verdictAtt(verdictOf({ mockHits: hits }))], ...over });
const specWith = (file, line, res) => spec(file, line, `t${line}`, res);

test('an already failed test keeps its failure kind but still lists the unused mocks', () => {
    const model = run([
        specWith('d/a.spec.js', 1, hitsResult({ '**/api/b': 0 }, { status: 'failed', steps: [], errors: [{ message: 'boot' }] })),
        specWith('d/a.spec.js', 2, hitsResult({ '**/api/b': 0 }))
    ]);
    const [boot, ok] = model.tests;
    assert.equal(boot.failure.kind, 'setup');
    assert.equal(boot.status, 'failed');
    assert.deepEqual(boot.unusedMocks, ['**/api/b']);
    assert.equal(ok.status, 'failed');
    assert.equal(ok.failure.kind, 'mock-unused');
});

test('a skipped test in a marked file becomes failed mock-unused', () => {
    const model = run([
        specWith('d/a.spec.js', 1, hitsResult({ '**/api/b': 0 }, { status: 'skipped', steps: [] })),
        specWith('d/a.spec.js', 2, hitsResult({ '**/api/b': 0 }))
    ]);
    assert.equal(model.tests[0].status, 'failed');
    assert.equal(model.tests[0].failure.kind, 'mock-unused');
});

test('a null mockHits test adds nothing to the file sums', () => {
    const model = run([
        hitsSpec('d/a.spec.js', 1, { '**/api/a': 1 }),
        hitsSpec('d/a.spec.js', 2, null)
    ]);
    assert.deepEqual(model.tests.map((t) => t.status), ['passed', 'passed']);
});

const EN_TC_MD = `# Feature Test Cases

- [ ] **AC-01**: title
- [ ] **AC-02**: list

### TC-01: title

| **Related AC** | AC-01 |
| **E2E suitability** | e2e |

### TC-02: list

| **Related AC** | AC-02 |
| **E2E suitability** | e2e |
`;

test('an en tc.md with a ko report fills the AC table and a missing spec blocks approval', () => {
    const model = collectRun({
        results: resultsOf([spec('d/tc01-title.spec.js', 1, 'title', result())]),
        tcMd: parseTcMd(EN_TC_MD, { locale: 'en' }),
        slug: 'd',
        tag: 'd',
        dirSpecFiles: ['d/tc01-title.spec.js'],
        locale: 'ko',
        artifactLocale: 'en'
    });
    assert.deepEqual(model.acs.map((a) => a.id), ['AC-01', 'AC-02']);
    assert.equal(model.acs[1].rows[0].state, 'missing');
    assert.equal(model.gate.level, 'defect');
    assert.equal(model.runLabel, '1회차');
});

test('needs-check markers follow the artifact locale, not the report locale', () => {
    const verdict = verdictOf({ cp: [{ id: 'cp-01', desc: 'landing [verify: id]', passed: true, actual: '/x' }] });
    const model = collectRun({
        results: resultsOf([spec('d/a.spec.js', 1, 'a', result({ steps: [step('cp-01: landing')], attachments: [verdictAtt(verdict)] }))]),
        tag: 'a',
        locale: 'ko',
        artifactLocale: 'en'
    });
    assert.ok(model.gate.reasons.some((r) => r.level === 'check' && r.text.includes('cp-01')), JSON.stringify(model.gate.reasons));
});

test('a tc.md whose TC blocks yield no known field is a defect naming the labels and locale', () => {
    const koTc = `# 기능\n\n- [ ] **AC-01**: a\n\n### TC-01: a\n\n| **관련 AC** | AC-01 |\n| **E2E 적합성** | E2E 가능 |\n`;
    const model = collectRun({
        results: resultsOf([spec('d/tc01-a.spec.js', 1, 'a', result())]),
        tcMd: parseTcMd(koTc, { locale: 'en' }),
        slug: 'd',
        tag: 'd',
        artifactLocale: 'en'
    });
    const reason = model.gate.reasons.find((r) => r.level === 'defect' && r.text.includes('Related AC'));
    assert.ok(reason, JSON.stringify(model.gate.reasons));
    assert.match(reason.text, /E2E suitability/);
    assert.match(reason.text, /\ben\b/);
});

test('results.errors (a spec file failed to load) is a defect with the first message', () => {
    const results = { ...resultsOf([spec('d/a.spec.js', 1, 'a', result())]), errors: [{ message: 'SyntaxError: Unexpected token\n  at x' }, { message: 'second' }] };
    const model = collectRun({ results, tag: 'a' });
    assert.equal(model.gate.level, 'defect');
    assert.ok(model.gate.reasons.some((r) => r.text.includes('SyntaxError: Unexpected token') && !r.text.includes('second')));
});

test('a passed test without a verdict.json needs review (kit fixture not used)', () => {
    const model = collectRun({ results: resultsOf([spec('d/a.spec.js', 1, 'a', result({ attachments: [] }))]), tag: 'a' });
    assert.equal(model.gate.level, 'check');
    assert.ok(model.gate.reasons.some((r) => r.text.includes('no runtime verdict — kit fixture not used')));
});

test('a skipped test without a verdict is not flagged as fixture-less', () => {
    const model = collectRun({ results: resultsOf([spec('d/a.spec.js', 1, 'a', result({ status: 'skipped', steps: [], attachments: [] }))]), tag: 'a' });
    assert.ok(!model.gate.reasons.some((r) => r.text.includes('no runtime verdict')));
});

test('a slug without a tc.md adds a review note naming the expected path', () => {
    const model = collectRun({ results: resultsOf([spec('d/a.spec.js', 1, 'a', result())]), slug: 'd', tag: 'd', missingTcMd: 'works/d/tc.md' });
    assert.equal(model.gate.level, 'check');
    assert.ok(model.gate.reasons.some((r) => r.text.includes('works/d/tc.md')));
});

test('an unmapped TC row needs review', () => {
    const model = collectRun({
        results: resultsOf([spec('d/bundle.spec.js', 1, 'other', result())]),
        tcMd: parseTcMd(EN_TC_MD),
        slug: 'd',
        tag: 'd',
        dirSpecFiles: ['d/bundle.spec.js'],
        readHeader: (f) => (f.endsWith('bundle.spec.js') ? '// x\n// TC-01 · TC-02\n' : '')
    });
    const rows = model.acs.flatMap((a) => a.rows).filter((r) => r.state === 'unmapped');
    assert.ok(rows.length > 0, JSON.stringify(model.acs));
    assert.ok(model.gate.reasons.some((r) => r.level === 'check' && r.text.includes(rows[0].tcId) && r.text.includes("no test maps")), JSON.stringify(model.gate.reasons));
});

test('a filtered run does not mark unused mocks (the hitting test may not have run)', () => {
    const model = collectRun({ results: resultsOf([hitsSpec('d/a.spec.js', 1, { '**/api/b': 0 })]), tag: 'x', filtered: true });
    assert.equal(model.tests[0].status, 'passed');
    assert.equal(model.tests[0].unusedMocks, undefined);
});

test('unused mocks are grouped per project and file', () => {
    const withProject = (s, projectName) => ({ ...s, tests: s.tests.map((t) => ({ ...t, projectName })) });
    const model = run([
        withProject(hitsSpec('d/a.spec.js', 1, { '**/api/b': 1 }), 'chromium'),
        withProject(hitsSpec('d/a.spec.js', 2, { '**/api/b': 0 }), 'firefox')
    ]);
    assert.equal(model.tests.find((t) => t.projectName === 'chromium').status, 'passed');
    assert.equal(model.tests.find((t) => t.projectName === 'firefox').failure.kind, 'mock-unused');
});

test('collectRun: a title that already starts with the TC id is not prefixed again', () => {
    const results = resultsOf([
        spec('feat/btc-tc01-a.spec.js', 1, 'TC-01: first entry', result()),
        spec('feat/btc-tc02-b.spec.js', 1, 'switch filter', result()),
        spec('feat/btc-tc03-c.spec.js', 1, 'TC-030 other id', result())
    ]);
    const model = collectRun({ results, tag: 'feat', nn: '01', specFilePrefix: 'btc-' });
    assert.deepEqual(
        model.tests.map((t) => t.label),
        ['TC-01: first entry', 'TC-02 switch filter', 'TC-03 TC-030 other id']
    );
});
