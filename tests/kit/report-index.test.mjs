import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeReport, findPrevHref } from '../../kit/report/index.mjs';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
const settingsFor = (cwd) => ({
    worksDir: path.join(cwd, '.agents/works'),
    locale: 'ko',
    loopThreshold: 3,
    specFilePrefix: 'btc-',
    platformLabel: null,
    openCommand: 'node e2e/kit/report/open.mjs'
});

const setup = () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'g4-'));
    const testDir = path.join(cwd, 'playwright/ui-tests/scenarios');
    mkdirSync(path.join(testDir, 'feat'), { recursive: true });
    writeFileSync(path.join(testDir, 'feat/btc-tc14-toast.spec.js'), '// btc-tc14-toast.spec.js\n');
    writeFileSync(
        path.join(testDir, 'feat/btc-bundle.spec.js'),
        '// btc-bundle.spec.js\n// TC-09 — 홈\n'
    );
    mkdirSync(path.join(cwd, '.agents/works/feat'), { recursive: true });
    writeFileSync(
        path.join(cwd, '.agents/works/feat/tc.md'),
        '# 기능 테스트 케이스\n\n- [ ] **AC-12**: 토스트\n\n### TC-14: 토스트\n\n| **관련 AC** | AC-12 |\n| **E2E 적합성** | E2E 가능 |\n'
    );
    const archiveRoot = path.join(cwd, 'playwright/ui-tests/reports/archive');
    const destDir = path.join(archiveRoot, '261006/feat-02');
    mkdirSync(destDir, { recursive: true });
    mkdirSync(path.join(archiveRoot, '261005/feat-01'), { recursive: true });
    const result = {
        status: 'passed',
        duration: 5000,
        errors: [],
        steps: [{ title: 'cp-01: 노출', duration: 10 }],
        annotations: [],
        attachments: [
            {
                name: 'verdict.json',
                body: b64({
                    verdict: 'PASS',
                    cp: [{ id: 'cp-01', desc: '노출', passed: true }],
                    commentary: { state: 'no-key' }
                })
            }
        ]
    };
    const results = {
        config: { rootDir: testDir },
        suites: [
            {
                specs: [
                    {
                        title: '토스트',
                        file: 'feat/btc-tc14-toast.spec.js',
                        line: 1,
                        id: 'x',
                        tests: [{ annotations: [], results: [result] }]
                    }
                ]
            }
        ]
    };
    writeFileSync(path.join(destDir, 'results.json'), JSON.stringify(results));
    return { cwd, testDir, destDir, archiveRoot };
};

test('findPrevHref: 이전 날짜의 같은 태그를 찾는다', () => {
    const { archiveRoot, destDir } = setup();
    assert.equal(
        findPrevHref(archiveRoot, 'feat', destDir),
        '../../261005/feat-01/e2e-report.html'
    );
    assert.equal(findPrevHref(archiveRoot, 'none', destDir), null);
});

test('findPrevHref: 아카이브 루트의 파일(.DS_Store)은 건너뛴다', () => {
    const { archiveRoot, destDir } = setup();
    writeFileSync(path.join(archiveRoot, '.DS_Store'), '');
    assert.equal(
        findPrevHref(archiveRoot, 'feat', destDir),
        '../../261005/feat-01/e2e-report.html'
    );
});

test('부분 실행이면 e2e-report.html 만 쓰고 e2e-report.md 는 건드리지 않는다', () => {
    const { cwd, testDir, destDir } = setup();
    const out = writeReport({
        destDir,
        specFiles: [path.join(testDir, 'feat/btc-tc14-toast.spec.js')],
        tag: 'btc-tc14-toast',
        nn: '02',
        cwd,
        settings: settingsFor(cwd)
    });
    assert.ok(existsSync(path.join(destDir, 'e2e-report.html')));
    assert.equal(out.mdPath, null);
    assert.equal(existsSync(path.join(cwd, '.agents/works/feat/e2e-report.md')), false);
});

test('디렉토리 전체 실행이면 e2e-report.md 를 쓴다', () => {
    const { cwd, testDir, destDir } = setup();
    const results = JSON.parse(readFileSync(path.join(destDir, 'results.json'), 'utf8'));
    results.suites[0].specs.push({
        title: '홈',
        file: 'feat/btc-bundle.spec.js',
        line: 1,
        id: 'y',
        tests: [
            {
                annotations: [],
                results: [
                    {
                        status: 'passed',
                        duration: 1,
                        errors: [],
                        steps: [],
                        annotations: [],
                        attachments: []
                    }
                ]
            }
        ]
    });
    writeFileSync(path.join(destDir, 'results.json'), JSON.stringify(results));
    const out = writeReport({
        destDir,
        specFiles: ['btc-tc14-toast.spec.js', 'btc-bundle.spec.js'].map((f) =>
            path.join(testDir, 'feat', f)
        ),
        tag: 'feat',
        nn: '02',
        cwd,
        settings: settingsFor(cwd)
    });
    assert.equal(out.mdPath, '.agents/works/feat/e2e-report.md');
    const md = readFileSync(path.join(cwd, out.mdPath), 'utf8');
    assert.match(md, /# E2E 리포트 — 기능/);
    assert.match(md, /playwright\/ui-tests\/reports\/archive\/261006\/feat-02\/e2e-report\.html/);
});

test('필터 실행이면 디렉토리 전체 파일을 돌렸어도 e2e-report.md 를 쓰지 않는다', () => {
    const { cwd, testDir, destDir } = setup();
    const out = writeReport({
        destDir,
        specFiles: ['btc-tc14-toast.spec.js', 'btc-bundle.spec.js'].map((f) =>
            path.join(testDir, 'feat', f)
        ),
        tag: 'feat',
        nn: '02',
        cwd,
        filtered: true,
        settings: settingsFor(cwd)
    });
    assert.equal(out.mdPath, null);
    assert.match(readFileSync(path.join(destDir, 'e2e-report.html'), 'utf8'), /일부 테스트만 실행/);
});

test('an en tc.md read under a ko report locale fills the AC table and blocks approval on a missing spec', () => {
    const { cwd, testDir, destDir } = setup();
    writeFileSync(
        path.join(cwd, '.agents/works/feat/tc.md'),
        '# Feature Test Cases\n\n- [ ] **AC-12**: toast\n- [ ] **AC-13**: loading\n\n### TC-14: toast\n\n| **Related AC** | AC-12 |\n| **E2E suitability** | e2e |\n\n### TC-15: loading\n\n| **Related AC** | AC-13 |\n| **E2E suitability** | e2e |\n'
    );
    // the run covers the whole directory, so a TC with no spec is a defect rather than "not in this run"
    const results = JSON.parse(readFileSync(path.join(destDir, 'results.json'), 'utf8'));
    results.suites[0].specs.push({ ...results.suites[0].specs[0], title: 'home', file: 'feat/btc-bundle.spec.js', id: 'y' });
    writeFileSync(path.join(destDir, 'results.json'), JSON.stringify(results));
    const out = writeReport({
        destDir,
        specFiles: [path.join(testDir, 'feat/btc-tc14-toast.spec.js'), path.join(testDir, 'feat/btc-bundle.spec.js')],
        tag: 'feat',
        nn: '02',
        cwd,
        settings: { ...settingsFor(cwd), artifactLocale: 'en' }
    });
    assert.equal(out.gate, 'defect');
    const html = readFileSync(path.join(destDir, 'e2e-report.html'), 'utf8');
    assert.match(html, /AC-13/);
    assert.match(html, /TC-15 — spec 없음/);
});

test('the reporter testDir wins over results.config.rootDir for slug and spec lookup', () => {
    const { cwd, testDir, destDir } = setup();
    const results = JSON.parse(readFileSync(path.join(destDir, 'results.json'), 'utf8'));
    results.config.rootDir = cwd;
    writeFileSync(path.join(destDir, 'results.json'), JSON.stringify(results));
    const out = writeReport({
        destDir,
        specFiles: [path.join(testDir, 'feat/btc-tc14-toast.spec.js')],
        tag: 'btc-tc14-toast',
        nn: '02',
        cwd,
        testDir,
        settings: settingsFor(cwd)
    });
    assert.notEqual(out.model.slug, null);
    assert.equal(out.model.slug, 'feat');
});

test('a slug with no tc.md adds a review note with the expected path', () => {
    const { cwd, testDir, destDir } = setup();
    const out = writeReport({
        destDir,
        specFiles: [path.join(testDir, 'feat/btc-tc14-toast.spec.js')],
        tag: 'btc-tc14-toast',
        nn: '02',
        cwd,
        settings: { ...settingsFor(cwd), worksDir: path.join(cwd, 'nowhere') }
    });
    assert.ok(out.model.gate.reasons.some((r) => r.level === 'check' && r.text.includes(path.join('nowhere', 'feat', 'tc.md'))));
});
