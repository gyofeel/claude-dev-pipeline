import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadKitConfig, resetKitConfig, reportSettings } from '../../kit/config-loader.js';

const repo = (cfg) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kitcfg-'));
    mkdirSync(path.join(dir, '.agents'));
    writeFileSync(path.join(dir, '.agents/pipeline.config.json'), JSON.stringify(cfg));
    resetKitConfig();
    return dir;
};

test('defaults fill locale, report, judge, archive and bootFixtures', () => {
    const { config } = loadKitConfig(repo({}));
    assert.equal(config.worksDir, '.agents/works');
    assert.equal(config.locale, 'en');
    assert.deepEqual(config.e2e.report, { locale: null, loopThreshold: 3 });
    assert.deepEqual(config.e2e.judge, { backendErrorPatterns: [] });
    assert.equal(config.e2e.archiveDir, null);
    assert.deepEqual(config.e2e.bootFixtures, []);
    assert.equal(config.e2e.ai, undefined);
});

test('nested report/judge objects merge with defaults', () => {
    const dir = repo({ e2e: { report: { locale: 'ko' }, judge: { backendErrorPatterns: ['^X'] } } });
    const { config } = loadKitConfig(dir);
    assert.deepEqual(config.e2e.report, { locale: 'ko', loopThreshold: 3 });
    assert.deepEqual(config.e2e.judge.backendErrorPatterns, ['^X']);
});

test('reportSettings resolves paths and derives archiveDir from resultsJson', () => {
    const dir = repo({
        worksDir: 'w',
        e2e: { resultsJson: 'out/r.json', kitDir: 'tests/kit', specFilePrefix: 'app.' },
        platformInterface: { enabled: true, label: 'Native bridge' }
    });
    const s = reportSettings(loadKitConfig(dir));
    assert.equal(s.worksDir, path.join(dir, 'w'));
    assert.equal(s.resultsJson, path.join(dir, 'out/r.json'));
    assert.equal(s.archiveDir, path.join(dir, 'out/archive'));
    assert.equal(s.specFilePrefix, 'app.');
    assert.equal(s.platformLabel, 'Native bridge');
    assert.equal(s.openCommand, 'node tests/kit/report/open.mjs');
});

test('reportSettings: explicit archiveDir wins, disabled platform gives null label', () => {
    const dir = repo({ e2e: { archiveDir: 'arch' } });
    const s = reportSettings(loadKitConfig(dir));
    assert.equal(s.archiveDir, path.join(dir, 'arch'));
    assert.equal(s.platformLabel, null);
});

test('locale: top-level applies, report.locale overrides, unknown falls back to en', () => {
    assert.equal(reportSettings(loadKitConfig(repo({ locale: 'ko' }))).locale, 'ko');
    assert.equal(reportSettings(loadKitConfig(repo({ locale: 'ko', e2e: { report: { locale: 'en' } } }))).locale, 'en');
    assert.equal(reportSettings({ e2e: { report: { locale: 'fr' } } }).locale, 'en');
    assert.equal(reportSettings({ locale: 'ko', e2e: { report: { locale: 'fr' } } }).locale, 'en');
});

test('artifactLocale follows the top-level locale only; report.locale changes report text', () => {
    const s = reportSettings(loadKitConfig(repo({ locale: 'en', e2e: { report: { locale: 'ko' } } })));
    assert.equal(s.locale, 'ko');
    assert.equal(s.artifactLocale, 'en');
    assert.equal(reportSettings({ locale: 'ko' }).artifactLocale, 'ko');
    assert.equal(reportSettings({ locale: 'fr' }).artifactLocale, 'en');
    assert.equal(reportSettings({}).artifactLocale, 'en');
});
