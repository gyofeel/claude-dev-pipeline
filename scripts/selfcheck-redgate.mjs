#!/usr/bin/env node
/**
 * selfcheck-redgate — exercises red-gate.mjs against a fake runner in a temp project.
 *   node scripts/selfcheck-redgate.mjs
 * Exits 1 on the first failed assertion.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCommand, normalize } from './red-gate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const gate = path.join(here, 'red-gate.mjs');
const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'redgate-selfcheck-')));
mkdirSync(path.join(tmp, '.agents'), { recursive: true });
writeFileSync(path.join(tmp, 'package.json'), '{"name":"selfcheck","private":true}\n');
writeFileSync(path.join(tmp, '.agents', 'pipeline.config.json'), JSON.stringify({ $schema: 'dev-pipeline/1', commands: { unitTest: 'x' } }));
writeFileSync(path.join(tmp, 'plan.md'), '# plan\n');
const testFile = path.join(tmp, 'a.test.js');
writeFileSync(testFile, '// placeholder\n');

// Fake runner: copies $FAKE_RESULT to --outputFile, prints $FAKE_STDERR, exits $FAKE_EXIT.
const shim = path.join(tmp, 'fake-runner.mjs');
writeFileSync(
    shim,
    `import { copyFileSync } from 'node:fs';
const out = process.argv.find((a) => a.startsWith('--outputFile='))?.slice(13);
if (process.env.FAKE_RESULT && out) copyFileSync(process.env.FAKE_RESULT, out);
if (process.env.FAKE_STDERR) process.stderr.write(process.env.FAKE_STDERR);
process.exit(Number(process.env.FAKE_EXIT ?? 0));
`
);

const report = (assertions, fileMessage = '') => ({
    numTotalTests: assertions.length,
    testResults: [{ name: testFile, message: fileMessage, assertionResults: assertions }]
});
const t = (title, status, failureMessages = []) => ({ title, fullName: `suite ${title}`, status, failureMessages, duration: 1 });

let n = 0;
const runGate = (args, env = {}) => {
    const resultPath = path.join(tmp, `r${++n}.json`);
    if (env.result) writeFileSync(resultPath, JSON.stringify(env.result));
    const r = spawnSync('node', [gate, ...args, '--runner-cmd', `node ${shim}`], {
        cwd: tmp,
        encoding: 'utf8',
        env: { ...process.env, FAKE_RESULT: env.result ? resultPath : '', FAKE_STDERR: env.stderr ?? '', FAKE_EXIT: String(env.exit ?? 0) }
    });
    assert.equal(r.status, 0, `exit code must be 0\n${r.stderr}`);
    return JSON.parse(r.stdout);
};
const red = (test, env) => runGate(['--phase', 'red', '--plan', 'plan.md', '--task', '1', '--file', testFile, '--test', test], env);
const green = (test, env) => runGate(['--phase', 'green', '--plan', 'plan.md', '--task', '1', '--file', testFile, '--test', test], env);

try {
    // command builders
    assert.deepEqual(buildCommand({ runner: 'vitest', runnerArgs: ['--project', 'unit'], file: '/f.test.js', outputFile: '/o.json' }), {
        cmd: 'npx',
        argv: ['vitest', 'run', '--reporter=json', '--outputFile=/o.json', '--project', 'unit', '/f.test.js']
    });
    assert.deepEqual(buildCommand({ runner: 'jest', file: '/f.test.js', outputFile: '/o.json' }), {
        cmd: 'npx',
        argv: ['jest', '--json', '--outputFile=/o.json', '--runTestsByPath', '/f.test.js']
    });
    assert.equal(normalize(report([t('UCP-01: x', 'failed', ['AssertionError: expected 1 to be 2'])])).tests[0].message, 'AssertionError: expected 1 to be 2');

    // ENV: no result + EACCES on stderr
    let out = red('UCP-01: adds', { exit: 1, stderr: 'EACCES: permission denied, unlink node_modules/.x' });
    assert.equal(out.failureClass, 'ENV');
    assert.equal(out.consumesFixRound, false);
    assert.equal(out.routeTo, 'user:env');

    // TARGET_NOT_FOUND
    out = red('UCP-09: nope', { result: report([t('UCP-01: adds', 'failed', ['AssertionError: expected 1 to be 2'])]) });
    assert.equal(out.failureClass, 'TARGET_NOT_FOUND');
    assert.deepEqual(out.availableTests, ['UCP-01: adds']);

    // WRONG_REASON{module}
    out = red('UCP-01: adds', { result: report([], "SyntaxError: Unexpected token '}'") });
    assert.equal(out.failureClass, 'WRONG_REASON{module}');

    // GREEN_WITHOUT_RED
    out = red('UCP-01: adds', { result: report([t('UCP-01: adds', 'passed')]) });
    assert.equal(out.failureClass, 'GREEN_WITHOUT_RED');
    assert.equal(out.routeTo, 'controller:halt');

    // green before any RED on record → NO_RED_ON_RECORD
    out = green('UCP-01: adds', { result: report([t('UCP-01: adds', 'passed')]) });
    assert.equal(out.failureClass, 'NO_RED_ON_RECORD');

    // OK_RED (assertion failure) + ledger line; prefix form "UCP-01" also matches
    out = red('UCP-01', { result: report([t('UCP-01: adds', 'failed', ['AssertionError: expected 1 to be 2'])]) });
    assert.equal(out.failureClass, 'OK_RED');
    assert.equal(out.ok, true);
    assert.equal(out.routeTo, null);
    const ledger = path.join(tmp, '.superpowers', 'sdd', 'plan', 'red-evidence.jsonl');
    const lines = readFileSync(ledger, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.at(-1).failureClass, 'OK_RED');
    assert.equal(readFileSync(path.join(tmp, '.superpowers', 'sdd', '.gitignore'), 'utf8'), '*\n');

    // WRONG_REASON (TypeError at RED)
    out = red('UCP-02: b', { result: report([t('UCP-02: b', 'failed', ['TypeError: x is not a function'])]) });
    assert.equal(out.failureClass, 'WRONG_REASON');

    // STILL_RED after a recorded RED (same --test string as the RED run)
    out = green('UCP-01', { result: report([t('UCP-01: adds', 'failed', ['AssertionError: expected 1 to be 2'])]) });
    assert.equal(out.failureClass, 'STILL_RED');

    // COLLATERAL_RED: target passes, sibling fails
    out = green('UCP-01', { result: report([t('UCP-01: adds', 'passed'), t('UCP-03: other', 'failed', ['AssertionError: boom'])]) });
    assert.equal(out.failureClass, 'COLLATERAL_RED');
    assert.equal(out.collateral.newFailures.length, 1);

    // OK_GREEN
    out = green('UCP-01', { result: report([t('UCP-01: adds', 'passed')]) });
    assert.equal(out.failureClass, 'OK_GREEN');
    assert.equal(out.ok, true);

    // --all with known-failures baseline
    writeFileSync(path.join(tmp, 'known.json'), JSON.stringify({ failures: ['a.test.js::suite UCP-03: other'] }));
    writeFileSync(path.join(tmp, '.agents', 'pipeline.config.json'), JSON.stringify({ $schema: 'dev-pipeline/1', commands: { unitTest: 'x' }, unitTest: { knownFailuresFile: 'known.json' } }));
    out = runGate(['--phase', 'green', '--plan', 'plan.md', '--all'], { result: report([t('UCP-01: adds', 'passed'), t('UCP-03: other', 'failed', ['AssertionError: boom'])]) });
    assert.equal(out.failureClass, 'OK_GREEN');
    assert.equal(out.collateral.knownFailuresSkipped, 1);

    // GATE_ERROR: relative --file
    out = runGate(['--phase', 'red', '--plan', 'plan.md', '--file', 'a.test.js', '--test', 'x']);
    assert.equal(out.failureClass, 'GATE_ERROR');

    console.log('selfcheck-redgate: all 15 checks passed');
} finally {
    rmSync(tmp, { recursive: true, force: true });
}
