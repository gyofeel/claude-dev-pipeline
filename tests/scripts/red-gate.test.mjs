import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { labelsFor } from '../../kit/artifact-labels.mjs';
import {
    auditLedger,
    buildCommand,
    classifyFailureText,
    incompleteRun,
    isPlannedModuleMiss,
    isPlannedSymbolMiss,
    taskContract,
    taskSection,
    thrownInSource
} from '../../scripts/red-gate.mjs';

const gate = path.join(import.meta.dirname, '../../scripts/red-gate.mjs');
const ko = labelsFor('ko');

const roots = [];
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));
const repo = (files = {}) => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'red-gate-')));
    roots.push(root);
    for (const [rel, text] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        writeFileSync(path.join(root, rel), text);
    }
    return root;
};
const noAliases = { source: { roots: ['src'], extensions: ['.js', '.ts'], aliases: null } };

// Shape of a real tdd-implement plan: Files: Create and Interfaces: Produces per task
const plan = `# Plan

### Task 1: [TC-02] parse link_value

**Files:**
- Create: \`app/controller/adot/action/webLink.js\`
- Test: \`app/controller/adot/action/webLink.test.js\`

**Interfaces:**
- Produces: \`parseLinkValue(linkValue: string | object | undefined) => object | null\`

### Task 2: [TC-01] web_link landing

**Files:**
- Modify: \`app/controller/adot/action/webLink.js\`

**Interfaces:**
- Produces: \`resolveWebLinkTarget(extras: object | undefined) => { kind, params } | null\`

### Task 5: [TC-05] channel landing

**Interfaces:**
- Produces: \`parseChannelNo(callUrl: string) => string | null\`
`;
const contractOf = (n) => taskContract(taskSection(plan, n));

test('a missing module the task declares under Create is a legitimate RED', () => {
    const root = repo();
    const msg =
        'Failed to resolve import "./webLink" from "app/controller/adot/action/webLink.test.js". Does the file exist?';
    const testFile = path.join(root, 'app/controller/adot/action/webLink.test.js');
    assert.equal(isPlannedModuleMiss(msg, { root, testFile, contract: contractOf(1), config: noAliases }), true);
});

test('a missing undeclared path (import typo) is not accepted as RED', () => {
    const root = repo();
    const msg =
        'Failed to resolve import "./webLnk" from "app/controller/adot/action/webLink.test.js". Does the file exist?';
    const testFile = path.join(root, 'app/controller/adot/action/webLink.test.js');
    const opts = { root, testFile, config: noAliases };
    assert.equal(isPlannedModuleMiss(msg, { ...opts, contract: contractOf(1) }), false);
    assert.equal(isPlannedModuleMiss(msg, { ...opts, contract: contractOf(2) }), false);
});

test('a TypeError for a new export listed in Produces is a legitimate RED', () => {
    const msg = 'TypeError: (0 , __vite_ssr_import_1__.resolveWebLinkTarget) is not a function';
    assert.equal(classifyFailureText(msg), 'WRONG_REASON');
    assert.equal(isPlannedSymbolMiss(msg, contractOf(2)), true);
    assert.equal(
        isPlannedSymbolMiss('TypeError: (0 , __vite_ssr_import_1__.parseChannelNo) is not a function', contractOf(5)),
        true
    );
});

test('a TypeError for a name outside Produces stays WRONG_REASON', () => {
    // a missing mock of an existing module, not a new export
    assert.equal(isPlannedSymbolMiss('TypeError: focusManager.createFocusArea is not a function', contractOf(2)), false);
    // a name another task produces is not this task's RED
    assert.equal(
        isPlannedSymbolMiss('TypeError: (0 , __vite_ssr_import_1__.parseChannelNo) is not a function', contractOf(2)),
        false
    );
});

test('names inside test code are not contract — code fences are excluded from Produces', () => {
    const section = [
        '### Task 9: [TC-09] x',
        '- Produces: `alpha()`',
        '```javascript',
        'expect(beta()).toBe(1); // looks like a Produces line',
        '```'
    ].join('\n');
    const c = taskContract(section);
    assert.equal(isPlannedSymbolMiss('TypeError: beta is not a function', c), false);
    assert.equal(isPlannedSymbolMiss('TypeError: alpha is not a function', c), true);
});

test('the characterization marker is read from the task section only, in the configured locale', () => {
    const en = '### Task 1: a\n**characterization** pins current behaviour\n### Task 2: b\nbody';
    assert.equal(taskContract(taskSection(en, 1)).characterization, true);
    assert.equal(taskContract(taskSection(en, 2)).characterization, false);
    const kp = '### Task 1: a\n**특성화** 기존 동작 고정\n### Task 2: b\n본문';
    assert.equal(taskContract(taskSection(kp, 1), ko).characterization, true);
    assert.equal(taskContract(taskSection(kp, 1)).characterization, false);
});

test('audit: counts GREEN records without an earlier RED and tasks without evidence', () => {
    const p = '### Task 1: a\n### Task 2: b\n### Task 3: c\n**RED exempt:** focus movement';
    const e = (ts, task, phase, test, ok = true) => ({ ts, task, phase, file: 'f', test, ok });
    const audit = auditLedger(
        [
            e('2026-01-01T00:00:01Z', 1, 'red', 'UCP-01'),
            e('2026-01-01T00:00:02Z', 1, 'green', 'UCP-01'),
            e('2026-01-01T00:00:03Z', 2, 'green', 'UCP-02'),
            e('2026-01-01T00:00:04Z', 2, 'red', 'UCP-02')
        ],
        p
    );
    assert.deepEqual(audit.violations, [{ task: 2, test: 'UCP-02', reason: 'no RED record before GREEN' }]);
    assert.deepEqual(audit.tasksWithoutEvidence, []);
    assert.deepEqual(audit.exemptTasks, [3]);
    const kp = '### Task 1: a\n**RED 면제:** 포커스 이동';
    assert.deepEqual(auditLedger([], kp, null, ko).exemptTasks, [1]);
    assert.deepEqual(auditLedger([], kp).tasksWithoutEvidence, [1]);
});

test('a TypeError thrown by production code reports its location; test files and dependencies give null', () => {
    const root = '/repo';
    const fromSource = [
        'TypeError: callUrl.split is not a function',
        `    at resolveWebLinkLanding (${root}/app/controller/adot/utils/webLinkUtils.js:20:30)`,
        `    at ${root}/app/controller/adot/utils/webLinkUtils.test.js:88:16`
    ].join('\n');
    assert.equal(classifyFailureText(fromSource), 'WRONG_REASON');
    assert.equal(thrownInSource(fromSource, root), 'app/controller/adot/utils/webLinkUtils.js');

    for (const name of ['a.test.js', 'a.test.ts', 'a.test.tsx', 'a.spec.jsx', 'a.spec.mjs']) {
        const fromTest = `TypeError: Cannot read properties of undefined (reading 'id')\n    at ${root}/src/${name}:12:3`;
        assert.equal(thrownInSource(fromTest, root), null, name);
    }

    const fromDeps = [
        'TypeError: x is not a function',
        `    at Proxy.<anonymous> (file://${root}/node_modules/.pnpm/@vitest+expect@4.1.11/node_modules/@vitest/expect/dist/index.js:1552:16)`
    ].join('\n');
    assert.equal(thrownInSource(fromDeps, root), null);
});

test('asserting with not.toThrow turns a production exception into an assertion failure (OK_RED)', () => {
    const msg =
        "AssertionError: expected [Function] to not throw an error but 'TypeError: v.call_url.split is not a …' was thrown";
    assert.equal(classifyFailureText(msg), 'OK_RED');
});

test('asserting an async target with resolves also gives OK_RED', () => {
    const msg = [
        'Error: promise rejected "TypeError: Cannot read properties of null (reading \'values\')" instead of resolving',
        '    at /repo/app/controller/adot/action/actionEssence.test.js:117:13'
    ].join('\n');
    assert.equal(classifyFailureText(msg), 'OK_RED');
});

test('audit: flags tests whose last record failed, ignoring tests that no longer exist', () => {
    const p = '### Task 1: a';
    const e = (ts, phase, test, failureClass, ok) => ({ ts, task: 1, phase, file: 'f', test, failureClass, ok });
    const entries = [
        e('2026-01-01T00:00:01Z', 'red', 'UCP-01', 'OK_RED', true),
        e('2026-01-01T00:00:02Z', 'green', 'UCP-01', 'OK_GREEN', true),
        e('2026-01-01T00:00:03Z', 'red', 'null when call_url is not a string', 'WRONG_REASON', false),
        e('2026-01-01T00:00:04Z', 'green', 'null when call_url is not a string', 'NO_RED_ON_RECORD', false)
    ];
    assert.deepEqual(auditLedger(entries, p).violations, [
        {
            task: 1,
            test: 'null when call_url is not a string',
            reason: 'last record failed (NO_RED_ON_RECORD)'
        }
    ]);
    const live = [{ file: 'f', fullName: 'resolveWebLinkLanding UCP-01' }];
    assert.deepEqual(auditLedger(entries, p, live).violations, []);
});

test('whole run: exit 1 without failed tests, file-level errors or unfinished tests are not a complete run', () => {
    const passed = { status: 'passed' };
    const done = {
        numTotalTests: 2,
        numPassedTests: 2,
        numFailedTests: 0,
        testResults: [{ name: '/r/a.test.js', status: 'passed', assertionResults: [passed, passed] }]
    };
    assert.equal(incompleteRun({ exitCode: 0, report: done }), null);
    assert.deepEqual(incompleteRun({ exitCode: 1, report: done }), { exitCode: 1, unrun: 0, suiteErrors: [] });
    const crashed = {
        numTotalTests: 5,
        numPassedTests: 2,
        numFailedTests: 0,
        testResults: [
            { name: '/r/a.test.js', status: 'passed', assertionResults: [passed, passed] },
            { name: '/r/b.test.js', status: 'failed', message: 'Error: worker exited\nstack', assertionResults: [] }
        ]
    };
    assert.deepEqual(incompleteRun({ exitCode: 1, report: crashed }), {
        exitCode: 1,
        unrun: 3,
        suiteErrors: [{ file: '/r/b.test.js', message: 'Error: worker exited' }]
    });
    // with baseline failures, exit 1 is expected
    const knownRed = { ...done, numPassedTests: 1, numFailedTests: 1 };
    assert.equal(incompleteRun({ exitCode: 1, report: knownRed }), null);
});

test('--project is forwarded to the runner; --all runs every project with two workers', () => {
    assert.deepEqual(buildCommand({ runner: 'vitest', project: 'unit', file: '/f.test.ts', outputFile: '/o.json' }), {
        cmd: 'npx',
        argv: ['vitest', 'run', '--reporter=json', '--outputFile=/o.json', '--coverage.enabled=false', '--project', 'unit', '/f.test.ts']
    });
    assert.deepEqual(buildCommand({ runner: 'jest', project: 'unit', file: '/f.test.ts', outputFile: '/o.json' }), {
        cmd: 'npx',
        argv: ['jest', '--json', '--outputFile=/o.json', '--coverage=false', '--selectProjects', 'unit', '--runTestsByPath', '/f.test.ts']
    });
    assert.deepEqual(buildCommand({ runner: 'vitest', maxWorkers: 2, outputFile: '/o.json' }).argv, [
        'vitest',
        'run',
        '--reporter=json',
        '--outputFile=/o.json',
        '--coverage.enabled=false',
        '--maxWorkers=2'
    ]);
});

// ── CLI against a fake runner ───────────────────────────────────

// Copies $FAKE_RESULT to --outputFile, like vitest/jest JSON reporters do
const SHIM = `import { copyFileSync } from 'node:fs';
const out = process.argv.find((a) => a.startsWith('--outputFile='))?.slice(13);
if (process.env.FAKE_RESULT && out) copyFileSync(process.env.FAKE_RESULT, out);
process.exit(Number(process.env.FAKE_EXIT || 0));
`;

const cliProject = (config, files = {}) =>
    repo({ '.agents/pipeline.config.json': JSON.stringify({ $schema: 'dev-pipeline/1', ...config }), 'fake-runner.mjs': SHIM, ...files });

const runGate = (root, args, result, exit = 0) => {
    const resultPath = path.join(root, 'result.json');
    if (result) writeFileSync(resultPath, JSON.stringify(result));
    const r = spawnSync('node', [gate, ...args, '--runner-cmd', `node ${path.join(root, 'fake-runner.mjs')}`], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, FAKE_RESULT: result ? resultPath : '', FAKE_EXIT: String(exit) }
    });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
};

test('TS project: a planned module imported through a tsconfig alias is a legitimate RED', () => {
    const root = cliProject(
        { locale: 'en' },
        {
            'tsconfig.json': '{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } } }',
            'w/f/f-plan.md': '### Task 1: [TC-01] x\n\n**Files:**\n- Create: `src/lib/x.ts`\n- Test: `src/a.test.ts`\n'
        }
    );
    const testFile = path.join(root, 'src/a.test.ts');
    const out = runGate(
        root,
        ['--phase', 'red', '--plan', 'w/f/f-plan.md', '--task', '1', '--file', testFile, '--test', 'UCP-01: x', '--project', 'unit'],
        {
            numTotalTests: 0,
            testResults: [
                {
                    name: testFile,
                    status: 'failed',
                    message: 'Error: Failed to resolve import "@/lib/x" from "src/a.test.ts". Does the file exist?',
                    assertionResults: []
                }
            ]
        }
    );
    assert.equal(out.failureClass, 'OK_RED');
    assert.equal(out.plannedMiss, 'module');
    const ledger = readFileSync(path.join(root, 'w/f/red-evidence.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(ledger.at(-1).failureClass, 'OK_RED');
    assert.equal(ledger.at(-1).file, testFile);
});

test('NOT_COLLECTED advice names the configured testFileGlobs', () => {
    const root = cliProject({ unitTest: { testFileGlobs: ['src/**/*.test.ts', 'lib/**/*.spec.ts'] } }, { 'plan.md': '# p\n' });
    const out = runGate(
        root,
        ['--phase', 'red', '--plan', 'plan.md', '--task', '1', '--file', path.join(root, 'test/a.test.ts'), '--test', 'x', '--project', 'unit'],
        { numTotalTests: 0, testResults: [{ name: path.join(root, 'src/other.test.ts'), assertionResults: [] }] }
    );
    assert.equal(out.failureClass, 'NOT_COLLECTED');
    assert.match(out.advice, /src\/\*\*\/\*\.test\.ts, lib\/\*\*\/\*\.spec\.ts/);
});

test('--project is optional: omitted sends no project filter, given is forwarded', () => {
    const root = cliProject({}, { 'plan.md': '# p\n' });
    const testFile = path.join(root, 'a.test.ts');
    const result = { numTotalTests: 1, testResults: [{ name: testFile, assertionResults: [{ title: 'UCP-01: x', fullName: 'UCP-01: x', status: 'failed', failureMessages: ['AssertionError: expected 1 to be 2'] }] }] };
    const args = ['--phase', 'red', '--plan', 'plan.md', '--task', '1', '--file', testFile, '--test', 'UCP-01'];
    let out = runGate(root, args, result);
    assert.equal(out.failureClass, 'OK_RED');
    assert.doesNotMatch(out.run.command, /--project/);
    out = runGate(root, [...args, '--project', 'unit'], result);
    assert.equal(out.failureClass, 'OK_RED');
    assert.match(out.run.command, /--project unit /);
});

const oneTest = (file, status, failureMessages = []) => ({
    numTotalTests: 1,
    numPassedTests: status === 'passed' ? 1 : 0,
    numFailedTests: status === 'failed' ? 1 : 0,
    testResults: [{ name: file, status, assertionResults: [{ title: 'UCP-01: x', fullName: 'UCP-01: x', status, failureMessages }] }]
});

test('green: the target passes but the runner exits non-zero with no failed test → RUN_INCOMPLETE, not OK_GREEN', () => {
    const root = cliProject({}, { 'plan.md': '# p\n' });
    const testFile = path.join(root, 'a.test.ts');
    const args = (phase) => ['--phase', phase, '--plan', 'plan.md', '--task', '1', '--file', testFile, '--test', 'UCP-01'];
    assert.equal(runGate(root, args('red'), oneTest(testFile, 'failed', ['AssertionError: expected 1 to be 2'])).failureClass, 'OK_RED');
    const out = runGate(root, args('green'), oneTest(testFile, 'passed'), 1);
    assert.equal(out.failureClass, 'RUN_INCOMPLETE');
    assert.equal(out.ok, false);
    assert.equal(out.routeTo, 'controller:rerun');
    assert.equal(runGate(root, args('green'), oneTest(testFile, 'passed')).failureClass, 'OK_GREEN');
});

test('an unreadable alias config is reported in config.warnings', () => {
    const root = cliProject({}, { 'plan.md': '### Task 1: x\n- Create: `src/lib/x.ts`\n', 'tsconfig.json': '{ not json' });
    const testFile = path.join(root, 'src/a.test.ts');
    const out = runGate(
        root,
        ['--phase', 'red', '--plan', 'plan.md', '--task', '1', '--file', testFile, '--test', 'UCP-01'],
        { numTotalTests: 0, testResults: [{ name: testFile, status: 'failed', message: 'Error: Failed to resolve import "@/lib/x" from "src/a.test.ts". Does the file exist?', assertionResults: [] }] }
    );
    assert.equal(out.failureClass, 'WRONG_REASON{module}');
    assert.ok(out.config.warnings.some((w) => /tsconfig\.json could not be parsed/.test(w)), JSON.stringify(out.config.warnings));
});

test('--phase char without --task gets its own GATE_ERROR', () => {
    const root = cliProject({}, { 'plan.md': '# p\n' });
    const out = runGate(root, ['--phase', 'char', '--plan', 'plan.md', '--file', path.join(root, 'a.test.ts'), '--test', 'x']);
    assert.equal(out.failureClass, 'GATE_ERROR');
    assert.match(out.advice, /--phase char needs --task/);
});

test('--all with zero collected tests is never OK_GREEN', () => {
    const root = cliProject({}, { 'plan.md': '# p\n' });
    const out = runGate(root, ['--phase', 'green', '--plan', 'plan.md', '--all'], { numTotalTests: 0, testResults: [] });
    assert.notEqual(out.failureClass, 'OK_GREEN');
    assert.equal(out.failureClass, 'NOT_COLLECTED');
    assert.equal(out.ok, false);
});

test('a --file given through a symlinked directory matches the runner\'s real path', () => {
    const root = cliProject({}, { 'plan.md': '# p\n', 'src/a.test.ts': '' });
    symlinkSync(path.join(root, 'src'), path.join(root, 'link'));
    const real = path.join(root, 'src/a.test.ts');
    const args = ['--phase', 'red', '--plan', 'plan.md', '--task', '1', '--file', path.join(root, 'link/a.test.ts'), '--test', 'UCP-01'];
    const out = runGate(root, args, oneTest(real, 'failed', ['AssertionError: expected 1 to be 2']));
    assert.equal(out.failureClass, 'OK_RED');
});

test('the ledger sits beside the root-relative plan even when run from a subdirectory', () => {
    const root = cliProject({}, { 'w/f/plan.md': '# p\n', 'sub/.keep': '' });
    const testFile = path.join(root, 'a.test.ts');
    const resultPath = path.join(root, 'result.json');
    writeFileSync(resultPath, JSON.stringify(oneTest(testFile, 'failed', ['AssertionError: expected 1 to be 2'])));
    const r = spawnSync('node', [gate, '--phase', 'red', '--plan', 'w/f/plan.md', '--task', '1', '--file', testFile, '--test', 'UCP-01', '--runner-cmd', `node ${path.join(root, 'fake-runner.mjs')}`], {
        cwd: path.join(root, 'sub'),
        encoding: 'utf8',
        env: { ...process.env, FAKE_RESULT: resultPath, FAKE_EXIT: '0' }
    });
    assert.equal(JSON.parse(r.stdout).failureClass, 'OK_RED');
    assert.match(readFileSync(path.join(root, 'w/f/red-evidence.jsonl'), 'utf8'), /OK_RED/);
});
