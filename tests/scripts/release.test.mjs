import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../scripts/config-load.mjs';

const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(PLUGIN, rel), 'utf8');

test('plugin, kit and CHANGELOG versions agree', () => {
    const plugin = JSON.parse(read('.claude-plugin/plugin.json')).version;
    assert.equal(plugin, '0.4.0');
    // kit/index.js imports @playwright/test, which the plugin repo does not install
    const kitVersion = read('kit/index.js').match(/KIT_VERSION = '([^']+)'/)[1];
    assert.equal(read('kit/VERSION').trim(), kitVersion);
    assert.match(read('CHANGELOG.md'), new RegExp(`^## ${plugin.replaceAll('.', '\\.')}\\b`, 'm'));
});

test('example config validates without errors or warnings', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'release-'));
    try {
        mkdirSync(path.join(dir, '.agents'));
        writeFileSync(path.join(dir, '.agents/pipeline.config.json'), read('examples/config/pipeline.config.btv-webui.json'));
        const res = loadConfig(dir);
        // the keyboard adapter lives in the origin project, not in this temp repo
        const warnings = res.warnings.filter((w) => !w.startsWith('e2e.interaction is "keyboard"'));
        assert.deepEqual([res.errors, warnings], [[], []]);
        // red-gate adds --project per test and --all must reach every project
        assert.ok(!res.resolved.unitTest.runnerArgs.includes('--project'));
        assert.ok(res.resolved.source.aliases);
        assert.ok(res.resolved.e2e.bootFixtures.length > 0);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
