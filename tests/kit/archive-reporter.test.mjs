import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resetKitConfig } from '../../kit/config-loader.js';
import ArchiveReporter, { archiveTag, isFilteredRun, reporterPaths } from '../../kit/utils/archive-reporter.mjs';

test('archiveTag: one spec gives its name, one directory the directory, mixed gives run', () => {
    const d = '/r/scenarios';
    assert.equal(archiveTag([`${d}/feat/btc-a.spec.js`], d), 'btc-a');
    assert.equal(archiveTag([`${d}/feat/btc-a.spec.js`, `${d}/feat/btc-b.spec.js`], d), 'feat');
    assert.equal(archiveTag([`${d}/feat/btc-a.spec.js`, `${d}/other/btc-b.spec.js`], d), 'run');
});

test('isFilteredRun: grep and grepInvert mark a filtered run', () => {
    const base = { grep: /.*/, grepInvert: null, projects: [{ grep: /.*/, grepInvert: null }] };
    assert.equal(isFilteredRun(base), false);
    assert.equal(isFilteredRun({ ...base, grep: /toast/ }), true);
    assert.equal(isFilteredRun({ ...base, grepInvert: /x/ }), true);
    assert.equal(isFilteredRun({ ...base, projects: [{ grep: [/a/], grepInvert: null }] }), true);
});

test('reporterPaths resolves reporter options against the config file directory', () => {
    const p = reporterPaths({
        configFile: '/repo/sub/playwright.config.js',
        rootDir: '/repo/sub/e2e',
        reporter: [['list'], ['html', { outputFolder: 'out/html', open: 'never' }], ['json', { outputFile: 'out/r.json' }]]
    });
    assert.deepEqual(p, { htmlDir: '/repo/sub/out/html', resultsJson: '/repo/sub/out/r.json' });
});

test('reporterPaths: missing html reporter gives null instead of throwing', () => {
    const p = reporterPaths({ configFile: '/repo/playwright.config.js', reporter: [['json', { outputFile: 'r.json' }]] });
    assert.equal(p.htmlDir, null);
    assert.equal(p.resultsJson, '/repo/r.json');
});

const runIn = async (env, files) => {
    const cwd = process.cwd();
    const dir = mkdtempSync(path.join(tmpdir(), 'archive-'));
    process.env.E2E_ARCHIVE = env;
    process.chdir(dir);
    try {
        const r = new ArchiveReporter();
        r.onBegin({ projects: [{ testDir: dir }] }, { allTests: () => [] });
        for (const f of files) r.onTestEnd({ location: { file: f } }, { status: 'passed' });
        await r.onEnd({ status: 'passed' });
        return dir;
    } finally {
        process.chdir(cwd);
        delete process.env.E2E_ARCHIVE;
    }
};

test('a run where no test ran creates no archive', async () => {
    const dir = await runIn('1', []);
    assert.equal(existsSync(path.join(dir, 'e2e')), false);
});

test('E2E_ARCHIVE=0 creates no archive even when tests ran', async () => {
    const dir = await runIn('0', [path.join(tmpdir(), 'a.spec.js')]);
    assert.equal(existsSync(path.join(dir, 'e2e')), false);
});

test('config template blocks service workers inside use', () => {
    // @playwright/test is not installed here, so assert on the template text
    const src = readFileSync(new URL('../../kit/playwright.config.template.js', import.meta.url), 'utf8');
    const use = src.slice(src.indexOf('use: {'), src.indexOf('reporter:'));
    assert.match(use, /serviceWorkers: 'block'/);
});

// Full run with only a json reporter (no html), relative outputFile, config found via cwd.
const fullRun = async ({ withResults, archive = '1', attachments = [] }) => {
    const cwd = process.cwd();
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'archive-full-')));
    const testDir = path.join(dir, 'specs');
    mkdirSync(path.join(testDir, 'feat'), { recursive: true });
    const specFile = path.join(testDir, 'feat', 'a.spec.js');
    writeFileSync(specFile, '// a.spec.js\n');
    mkdirSync(path.join(dir, '.agents'), { recursive: true });
    writeFileSync(path.join(dir, '.agents/pipeline.config.json'), JSON.stringify({ e2e: { resultsJson: 'out/r.json' } }));
    if (withResults) {
        mkdirSync(path.join(dir, 'out'), { recursive: true });
        const result = { status: 'passed', duration: 10, errors: [], steps: [], annotations: [], attachments };
        const results = {
            config: { rootDir: testDir },
            suites: [{ specs: [{ title: 't', file: 'feat/a.spec.js', tests: [{ results: [result] }] }] }]
        };
        writeFileSync(path.join(dir, 'out/r.json'), JSON.stringify(results));
    }
    const logs = [];
    const origLog = console.log;
    console.log = (...a) => logs.push(a.join(' '));
    resetKitConfig();
    process.chdir(dir);
    process.env.E2E_ARCHIVE = archive;
    let ret;
    try {
        const r = new ArchiveReporter();
        r.onBegin(
            {
                configFile: path.join(dir, 'playwright.config.js'),
                rootDir: testDir,
                projects: [{ testDir }],
                reporter: [['list'], ['json', { outputFile: 'out/r.json' }]]
            },
            {}
        );
        r.onTestEnd({ location: { file: specFile } }, { status: 'passed' });
        ret = await r.onEnd({ status: 'passed' });
    } finally {
        console.log = origLog;
        process.chdir(cwd);
        resetKitConfig();
        delete process.env.E2E_ARCHIVE;
    }
    const archiveRoot = path.join(dir, 'out/archive');
    if (!existsSync(archiveRoot)) return { dest: null, logs, ret };
    const dateDir = path.join(archiveRoot, readdirSync(archiveRoot)[0]);
    return { dest: path.join(dateDir, 'a-01'), logs, ret };
};

test('full run with json reporter only archives results.json, summary.txt and e2e-report.html', async () => {
    const { dest } = await fullRun({ withResults: true });
    for (const f of ['results.json', 'summary.txt', 'e2e-report.html']) {
        assert.equal(existsSync(path.join(dest, f)), true, f);
    }
});

test('missing results.json still writes summary.txt and logs the json reporter hint', async () => {
    const { dest, logs } = await fullRun({ withResults: false });
    assert.equal(existsSync(path.join(dest, 'summary.txt')), true);
    assert.equal(existsSync(path.join(dest, 'results.json')), false);
    assert.ok(logs.some((l) => /\[archive\] report failed.*json reporter/.test(l)), logs.join('\n'));
});

const unusedMockVerdict = [
    {
        name: 'verdict.json',
        body: Buffer.from(JSON.stringify({ verdict: 'PASS', cp: [], mockHits: { '**/api/x': 0 } })).toString('base64')
    }
];

test('a test the report fails (mock-unused) fails the Playwright run', async () => {
    const { ret } = await fullRun({ withResults: true, attachments: unusedMockVerdict });
    assert.deepEqual(ret, { status: 'failed' });
});

test('E2E_ARCHIVE=0 skips the archive but still fails the run on a report-only failure', async () => {
    const { dest, ret } = await fullRun({ withResults: true, archive: '0', attachments: unusedMockVerdict });
    assert.equal(dest, null);
    assert.deepEqual(ret, { status: 'failed' });
});

test('a clean run leaves the Playwright status alone', async () => {
    const verdict = [{ name: 'verdict.json', body: Buffer.from(JSON.stringify({ verdict: 'PASS', cp: [], mockHits: { '**/api/x': 1 } })).toString('base64') }];
    const { ret } = await fullRun({ withResults: true, attachments: verdict });
    assert.equal(ret, undefined);
});

test('isFilteredRun: a file:line CLI argument marks a filtered run', () => {
    const base = { grep: /.*/, grepInvert: null, projects: [] };
    assert.equal(isFilteredRun(base, ['node', 'playwright', 'test', 'e2e/specs/a.spec.js']), false);
    assert.equal(isFilteredRun(base, ['node', 'playwright', 'test', 'e2e/specs/a.spec.js:12']), true);
    assert.equal(isFilteredRun(base, ['node', 'playwright', 'test', 'a.spec.js:12:5']), true);
    assert.equal(isFilteredRun(base, ['node', 'playwright', 'test', '--base-url=http://127.0.0.1:4317']), false);
});
