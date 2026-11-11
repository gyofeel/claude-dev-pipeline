import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pickLatestReport, listReportDirs } from '../../kit/report/latest.mjs';

const dirs = [
    { dir: 'a/261005/feat-01', mtimeMs: 100 },
    { dir: 'a/261006/feat-02', mtimeMs: 300 },
    { dir: 'a/261006/run-01', mtimeMs: 200 }
];

test('기준 시각이 없으면 가장 최근 report 를 고른다 (리포트만 열 때)', () => {
    assert.equal(pickLatestReport(dirs), 'a/261006/feat-02');
});

test('이번 실행 시작 이후에 생긴 report 만 고른다', () => {
    assert.equal(pickLatestReport(dirs, 250), 'a/261006/feat-02');
    assert.equal(pickLatestReport(dirs, 400), null);
});

test('후보가 없으면 null', () => {
    assert.equal(pickLatestReport([]), null);
});

test('아카이브 루트의 파일(.DS_Store)이 있어도 결과 리포트 디렉토리를 찾는다', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'report-latest-'));
    mkdirSync(path.join(root, '261006/feat-01'), { recursive: true });
    writeFileSync(path.join(root, '261006/feat-01/e2e-report.html'), '');
    writeFileSync(path.join(root, '.DS_Store'), '');
    assert.deepEqual(
        listReportDirs(root).map((d) => d.dir),
        [path.join(root, '261006/feat-01')]
    );
});
