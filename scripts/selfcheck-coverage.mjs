#!/usr/bin/env node
/**
 * selfcheck-coverage — exercises coverage-gate.mjs on synthetic PRD / TC / plan files.
 *   node scripts/selfcheck-coverage.mjs
 * Exits 1 on the first failed assertion.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const gate = path.join(path.dirname(fileURLToPath(import.meta.url)), 'coverage-gate.mjs');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'coverage-selfcheck-'));
const file = (name, text) => {
    const p = path.join(tmp, name);
    writeFileSync(p, text);
    return p;
};
const run = (...args) => JSON.parse(spawnSync('node', [gate, ...args], { encoding: 'utf8' }).stdout);

const prd = file('prd.md', ['## Acceptance Criteria', '- [ ] **AC-01**: a', '- [ ] **AC-02**: b', '- [ ] **AC-03**: c', '- [ ] **AC-04**: d', '- [ ] **AC-05**: e', ''].join('\n'));
const tcBlock = (id, acs, unit) => `### ${id}: x\n\n| Field | Value |\n|---|---|\n| **Related AC** | ${acs} |\n| **Unit target** | ${unit} |\n\n`;
const tcText = '# TC\n\n' + tcBlock('TC-01', 'AC-01', 'src/a.test.js') + tcBlock('TC-02', 'AC-02', '(none)') + tcBlock('TC-03', 'AC-03', '(none)') + tcBlock('TC-04', 'AC-04, AC-99', '(none)');

try {
    // G2: AC-05 has no TC; AC-99 is referenced but not in the PRD
    let out = run('--prd', prd, '--tc', file('tc.md', tcText));
    assert.equal(out.ok, true);
    assert.deepEqual(out.uncovered, ['AC-05']);
    assert.deepEqual(out.unknownRefs, ['AC-99']);

    // G2 with the AC excluded
    const tcEx = file('tc-ex.md', `${tcText}## AC exclusions\n| AC | Reason |\n|---|---|\n| AC-05 | later |\n`);
    out = run('--prd', prd, '--tc', tcEx);
    assert.deepEqual(out.uncovered, []);
    assert.deepEqual(out.excluded, ['AC-05']);

    // completion: TC-01 task title, TC-02 bracketed in a body, TC-03 bare mention, TC-04 split owner
    const plan = file(
        'plan.md',
        [
            '## Tasks',
            '### Task 1: [TC-01] a',
            'body',
            '### Task 2: [TC-01] wiring',
            'Also owns [TC-02]. TC-03 is checked by E2E only.',
            '## Implementation owners',
            '| TC | Owner | Reason |',
            '|---|---|---|',
            '| TC-04 | split ABC-123 | later |',
            ''
        ].join('\n')
    );
    out = run('--prd', prd, '--tc', tcEx, '--plan', plan);
    assert.equal(out.mode, 'completion');
    assert.equal(out.taskCount, 2);
    const state = Object.fromEntries(out.table.map((r) => [r.ac, r.state]));
    assert.deepEqual(state, { 'AC-01': 'implemented', 'AC-02': 'implemented', 'AC-03': 'verifyOnly', 'AC-04': 'split', 'AC-05': 'excluded' });
    assert.deepEqual(out.missing, []);

    // completion: titles only → the (none) TCs without an owner are missing
    out = run('--prd', prd, '--tc', tcEx, '--plan', file('plan2.md', '### Task 1: [TC-01] a\n'));
    assert.deepEqual(out.missing, ['AC-02', 'AC-03', 'AC-04']);

    // `existing` owner → verifyOnly
    out = run('--prd', prd, '--tc', tcEx, '--plan', file('plan3.md', '### Task 1: [TC-01] a\n## Implementation owners\n| TC | Owner | Reason |\n|---|---|---|\n| TC-02 | existing | x |\n'));
    assert.equal(out.table.find((r) => r.ac === 'AC-02').state, 'verifyOnly');

    // empty parse is an error, not success
    out = run('--prd', file('empty.md', '# nothing\n'), '--tc', tcEx);
    assert.equal(out.ok, false);

    console.log('selfcheck-coverage: all checks passed');
} finally {
    rmSync(tmp, { recursive: true, force: true });
}
