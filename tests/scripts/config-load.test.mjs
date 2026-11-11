import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULTS, loadConfig } from '../../scripts/config-load.mjs';

const repo = (cfg) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cfgload-'));
    mkdirSync(path.join(dir, '.agents'));
    writeFileSync(path.join(dir, '.agents/pipeline.config.json'), JSON.stringify({ commands: { unitTest: 'x' }, ...cfg }));
    return dir;
};

test('defaults match the agreed values', () => {
    assert.equal(DEFAULTS.locale, 'en');
    assert.equal(DEFAULTS.e2e.report.locale, null);
    assert.equal(DEFAULTS.e2e.report.loopThreshold, 3);
    assert.deepEqual(DEFAULTS.e2e.judge.backendErrorPatterns, []);
    assert.equal(DEFAULTS.e2e.archiveDir, null);
    assert.deepEqual(DEFAULTS.e2e.bootFixtures, []);
    assert.deepEqual(DEFAULTS.source, { roots: ['src'], extensions: ['.js', '.ts', '.vue', '.jsx', '.tsx', '.svelte', '.mjs', '.cjs'], aliases: null });
    assert.equal(DEFAULTS.e2e.ai, undefined);
    assert.ok(DEFAULTS.style.layersDir);
});

test('locale outside en|ko is an ENUMS error', () => {
    const r = loadConfig(repo({ locale: 'fr' }));
    assert.ok(r.errors.some((e) => e.startsWith('locale must be one of')));
    assert.ok(loadConfig(repo({ e2e: { report: { locale: 'fr' } } })).errors.some((e) => e.startsWith('e2e.report.locale')));
    assert.equal(loadConfig(repo({ locale: 'ko' })).ok, true);
});

test('e2e.ai warns as a removed key', () => {
    const r = loadConfig(repo({ e2e: { ai: { provider: 'openai' } } }));
    assert.ok(r.warnings.some((w) => w.startsWith('e2e.ai is no longer used')));
    assert.equal(loadConfig(repo({})).warnings.length, 0);
});

test('archiveDir resolves to an absolute path, source.roots stays relative', () => {
    const dir = repo({ e2e: { archiveDir: 'arch' }, source: { roots: ['app', 'server'] } });
    const r = loadConfig(dir);
    assert.equal(r.resolved.e2e.archiveDir, path.join(r.root, 'arch'));
    assert.deepEqual(r.resolved.source.roots, ['app', 'server']);
    assert.equal(loadConfig(repo({})).resolved.e2e.archiveDir, null);
});

test('invalid report/judge/source values are errors', () => {
    const r = loadConfig(repo({
        e2e: { report: { loopThreshold: 0 }, judge: { backendErrorPatterns: ['('] }, bootFixtures: 'x' },
        source: { roots: 'src', aliases: [] }
    }));
    for (const p of ['e2e.report.loopThreshold', 'e2e.judge.backendErrorPatterns has an invalid', 'e2e.bootFixtures', 'source.roots', 'source.aliases'])
        assert.ok(r.errors.some((e) => e.startsWith(p)), p);
});

test('a project without Playwright or unit tests (null commands, as init writes them) loads with warnings', () => {
    const r = loadConfig(repo({ commands: { unitTest: null, e2eRun: null } }));
    assert.equal(r.ok, true, r.errors.join('\n'));
    assert.ok(r.warnings.some((w) => w.startsWith('commands.e2eRun is null')));
    assert.ok(r.warnings.some((w) => w.startsWith('commands.unitTest is null')));
});
