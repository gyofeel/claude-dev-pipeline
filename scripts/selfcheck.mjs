#!/usr/bin/env node
// Self-check: config-load defaults/validation, nav-plan-schema valid+invalid, state-probe path extraction.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePlan } from './nav-plan-schema.mjs';
import { extractPaths } from './state-probe.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const run = (script, args, opts = {}) => {
    try {
        return { code: 0, out: execFileSync('node', [path.join(here, script), ...args], { encoding: 'utf8', ...opts }) };
    } catch (e) {
        return { code: e.status, out: e.stdout };
    }
};

// --defaults
const defaults = JSON.parse(run('config-load.mjs', ['--defaults']).out);
assert.equal(defaults.$schema, 'dev-pipeline/1');
assert.equal(defaults.e2e.interaction, 'pointer');

// temp repo with minimal config
const tmp = mkdtempSync(path.join(os.tmpdir(), 'dp-selfcheck-'));
mkdirSync(path.join(tmp, '.agents'));
writeFileSync(path.join(tmp, '.agents/pipeline.config.json'), JSON.stringify({ $schema: 'dev-pipeline/1', commands: { unitTest: 'npx vitest run' } }));
writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ dependencies: { react: '1' } }));

const ok = JSON.parse(run('config-load.mjs', ['--cwd', tmp]).out);
assert.equal(ok.ok, true, ok.errors.join());
assert.equal(ok.resolved.ui.framework, 'react');
assert.equal(ok.resolved.e2e.specsDir, path.join(tmp, 'e2e/specs'));
assert.equal(run('config-load.mjs', ['--cwd', tmp, '--get', 'e2e.specsDir']).out.trim(), path.join(tmp, 'e2e/specs'));

// invalid: keyboard without adapter
writeFileSync(path.join(tmp, '.agents/pipeline.config.json'), JSON.stringify({ $schema: 'dev-pipeline/1', commands: { unitTest: 'x' }, e2e: { interaction: 'keyboard' } }));
const bad = run('config-load.mjs', ['--cwd', tmp, '--check']);
assert.equal(bad.code, 1);
assert.ok(JSON.parse(bad.out).errors.some((e) => e.includes('findAndEnter')));

// nav plans
const good = {
    startUrl: '/catalog',
    steps: [
        { action: 'waitFor', selector: '[data-testid=list]', timeout: 15000 },
        { action: 'click', target: { by: 'role', value: 'tab', name: 'Movies' } },
        { action: 'findAndEnter', target: { by: 'text', value: 'Inception' }, until: 'selectorVisible:[data-testid=detail-title]', timeout: 10000, fallback: 'skip' },
        { action: 'loop', max: 10, body: [{ action: 'press', key: 'ArrowDown' }], until: "expr:document.activeElement?.dataset?.kind === 'movie'" }
    ],
    postEnterCondition: null
};
assert.deepEqual(validatePlan(good, { interaction: 'pointer' }), { valid: true, errors: [] });
const invalid = validatePlan(
    {
        steps: [
            { action: 'jump' },
            { action: 'findAndEnter', target: { by: 'xpath', value: '<todo>' }, until: 'sometime', timeout: 100, fallback: 'retry' },
            { action: 'click', target: { by: 'predicate', value: 'item.id' } },
            { action: 'loop', max: 99, body: [], until: 'urlChanges' }
        ],
        postEnterCondition: { type: 'State', expr: 'x', timeout: 1000 }
    },
    { interaction: 'pointer', stateBridge: null }
);
assert.equal(invalid.valid, false);
for (const needle of ['unknown action', 'by — unknown', 'placeholder', 'until —', 'timeout —', 'fallback', 'source — required', 'require ui.stateBridge', 'max — integer 1..50', 'body — non-empty', 'State type requires'])
    assert.ok(invalid.errors.some((e) => e.includes(needle)), `missing error: ${needle}\n${invalid.errors.join('\n')}`);
// CLI path
writeFileSync(path.join(tmp, 'plan.json'), JSON.stringify(good));
writeFileSync(path.join(tmp, '.agents/pipeline.config.json'), JSON.stringify({ $schema: 'dev-pipeline/1', commands: { unitTest: 'x' } }));
assert.equal(run('nav-plan-schema.mjs', [path.join(tmp, 'plan.json'), '--cwd', tmp]).code, 0);

// state-probe extraction
const paths = extractPaths(
    "const a = await page.evaluate(() => window.$state?.home?.items ?? null); // @state-path detail.item.id\n x = window.$state.focus.id;",
    'window.$state'
);
assert.deepEqual(paths.sort(), ['detail.item.id', 'focus.id', 'home.items']);

rmSync(tmp, { recursive: true, force: true });
console.log('selfcheck ok');
