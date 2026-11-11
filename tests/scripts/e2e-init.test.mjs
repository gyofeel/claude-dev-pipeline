import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { renderPlaywrightConfig } from '../../scripts/e2e-init.mjs';

const SCRIPT = path.join(import.meta.dirname, '../../scripts/e2e-init.mjs');
const roots = [];

const repo = (cfg) => {
    const root = mkdtempSync(path.join(tmpdir(), 'e2e-init-'));
    roots.push(root);
    mkdirSync(path.join(root, '.agents'));
    writeFileSync(path.join(root, '.agents/pipeline.config.json'), JSON.stringify({ commands: { unitTest: 'x' }, ...cfg }));
    return root;
};
const run = (sub, root) => {
    const r = spawnSync(process.execPath, [SCRIPT, sub], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
};

test.after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

test('check-kit-dir: the default layout is safe to replace', () => {
    const res = run('check-kit-dir', repo({}));
    assert.equal(res.ok, true);
    assert.equal(res.kitDir, 'e2e/kit');
});

for (const [name, e2e, reason] of [
    ['repo root', { kitDir: '.' }, /repo root/],
    ['outside the repo', { kitDir: '../kit' }, /outside/],
    ['contains specsDir', { kitDir: 'e2e', specsDir: 'e2e/specs' }, /e2e\.specsDir/],
    ['contains fixturesDir', { kitDir: 'pw', specsDir: 'specs', fixturesDir: 'pw/fixtures', resultsJson: 'r/results.json', adapterModule: 'a.js' }, /e2e\.fixturesDir/],
    ['contains the results directory', { kitDir: 'pw', specsDir: 'specs', fixturesDir: 'fx', resultsJson: 'pw/results.json', adapterModule: 'a.js' }, /resultsJson/],
    ['contains adapterModule', { kitDir: 'e2e/kit', adapterModule: 'e2e/kit/adapter.js' }, /e2e\.adapterModule/],
    ['contains the config directory', { kitDir: '.agents' }, /\.agents/]
]) {
    test(`check-kit-dir: refuses a kitDir — ${name}`, () => {
        const res = run('check-kit-dir', repo({ e2e: e2e }));
        assert.equal(res.ok, false);
        assert.match(res.errors.join('\n'), reason);
    });
}

for (const [name, cfg, reason] of [
    ['contains worksDir', { worksDir: 'e2e/kit/works' }, /worksDir/],
    ['contains archiveDir', { e2e: { archiveDir: 'e2e/kit/archive' } }, /e2e\.archiveDir/],
    ['contains style.stylesDir', { style: { stylesDir: 'e2e/kit/styles' } }, /style\.stylesDir/],
    ['contains knownFailuresFile', { unitTest: { knownFailuresFile: 'e2e/kit/known.json' } }, /unitTest\.knownFailuresFile/]
]) {
    test(`check-kit-dir: refuses a kitDir — ${name}`, () => {
        const res = run('check-kit-dir', repo(cfg));
        assert.equal(res.ok, false);
        assert.match(res.errors.join('\n'), reason);
    });
}

test('check-kit-dir: an existing kitDir without VERSION is not a kit and is refused', () => {
    const root = repo({});
    mkdirSync(path.join(root, 'e2e/kit'), { recursive: true });
    writeFileSync(path.join(root, 'e2e/kit/helpers.js'), '// mine');
    const res = run('check-kit-dir', root);
    assert.equal(res.ok, false);
    assert.match(res.errors.join('\n'), /VERSION/);
    writeFileSync(path.join(root, 'e2e/kit/VERSION'), '0.1.0\n');
    assert.equal(run('check-kit-dir', root).ok, true);
});

test('check-kit-dir: a kitDir symlinked onto the specs directory is refused', () => {
    const root = repo({ e2e: { kitDir: 'kitlink', specsDir: 'specs' } });
    mkdirSync(path.join(root, 'specs'));
    writeFileSync(path.join(root, 'specs/VERSION'), '0.1.0\n');
    symlinkSync(path.join(root, 'specs'), path.join(root, 'kitlink'));
    const res = run('check-kit-dir', root);
    assert.equal(res.ok, false);
    assert.match(res.errors.join('\n'), /e2e\.specsDir/);
});

test('write-playwright-config: substitutes every placeholder and keeps the dev command verbatim', () => {
    const dev = `node -e "require('http').createServer().listen(5555)" && echo '$& $' $$'`;
    const root = repo({
        commands: { unitTest: 'x', dev },
        e2e: { kitDir: 'pw/kit', specsDir: 'pw/specs', resultsJson: 'pw/reports/results.json', baseUrl: 'http://localhost:5555', healthUrlPath: '/favicon.ico' }
    });
    const res = run('write-playwright-config', root);
    assert.equal(res.ok, true);
    const text = readFileSync(path.join(root, 'playwright.config.js'), 'utf8');
    assert.doesNotMatch(text, /__(?!WEBSERVER_(START|END)__)[A-Z_]+__/);
    assert.match(text, /testDir: 'pw\/specs'/);
    assert.match(text, /baseURL: 'http:\/\/localhost:5555'/);
    assert.match(text, /outputFolder: 'pw\/reports\/html'/);
    assert.match(text, /outputFile: 'pw\/reports\/results\.json'/);
    assert.match(text, /\['\.\/pw\/kit\/utils\/archive-reporter\.mjs'\]/);
    assert.match(text, /url: 'http:\/\/localhost:5555\/favicon\.ico'/);
    assert.equal(JSON.parse(text.match(/command: (.*),\n/)[1]), dev);
});

test('write-playwright-config: a null dev command drops the webServer block', () => {
    const root = repo({});
    assert.equal(run('write-playwright-config', root).ok, true);
    const text = readFileSync(path.join(root, 'playwright.config.js'), 'utf8');
    assert.doesNotMatch(text, /webServer|__WEBSERVER/);
    assert.match(text, /archive-reporter\.mjs'\]\n {4}\],\n\}\);/);
});

test('write-playwright-config: never overwrites an existing Playwright config', () => {
    const root = repo({});
    writeFileSync(path.join(root, 'playwright.config.ts'), '// mine');
    const res = run('write-playwright-config', root);
    assert.equal(res.ok, false);
    assert.match(res.errors[0], /playwright\.config\.ts/);
    assert.equal(existsSync(path.join(root, 'playwright.config.js')), false);
});

test('both subcommands report an invalid config instead of guessing', () => {
    const root = repo({});
    writeFileSync(path.join(root, '.agents/pipeline.config.json'), '{bad');
    for (const sub of ['check-kit-dir', 'write-playwright-config']) {
        const res = run(sub, root);
        assert.equal(res.ok, false);
        assert.match(res.errors[0], /not valid JSON/);
    }
});

test('write-playwright-config: values with quotes and backslashes still give valid JavaScript', () => {
    const root = repo({
        commands: { unitTest: 'x', dev: 'echo __NOT_A_PLACEHOLDER__' },
        e2e: { specsDir: "it's/specs", baseUrl: "http://localhost:5555/a'b\\c" }
    });
    const res = run('write-playwright-config', root);
    assert.equal(res.ok, true, res.errors?.join('\n'));
    const file = path.join(root, 'check.mjs');
    writeFileSync(file, readFileSync(path.join(root, 'playwright.config.js'), 'utf8'));
    const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr);
    const text = readFileSync(file, 'utf8');
    assert.match(text, /testDir: 'it\\'s\/specs'/);
    assert.ok(text.includes('echo __NOT_A_PLACEHOLDER__'));
});

test('renderPlaywrightConfig: an unknown placeholder in the template is caught before values go in', () => {
    const cfg = { commands: { dev: null }, e2e: { specsDir: '/r/s', baseUrl: 'http://x', healthUrlPath: '/', resultsJson: '/r/o/r.json', kitDir: '/r/k' } };
    assert.throws(() => renderPlaywrightConfig('/r', cfg, "export default { a: '__MISSING__', b: '__SPECS_DIR__' };"), /__MISSING__/);
    assert.equal(renderPlaywrightConfig('/r', cfg, "export default { b: '__SPECS_DIR__' };"), "export default { b: 's' };");
});

test('gitignore: appends the loop record, results directory and test-results once', () => {
    const root = repo({ worksDir: 'works', e2e: { resultsJson: 'pw/reports/results.json' } });
    writeFileSync(path.join(root, '.gitignore'), 'node_modules/');
    const first = run('gitignore', root);
    assert.equal(first.ok, true);
    assert.deepEqual(first.added, ['works/**/e2e-loops.json', 'pw/reports/', 'test-results/']);
    assert.deepEqual(run('gitignore', root).added, []);
    assert.equal(readFileSync(path.join(root, '.gitignore'), 'utf8'), 'node_modules/\nworks/**/e2e-loops.json\npw/reports/\ntest-results/\n');
    assert.deepEqual(first.stillTracked, []);
});

test('gitignore: lists files git already tracks under the ignored paths', () => {
    const root = repo({ worksDir: 'works', e2e: { resultsJson: 'pw/reports/results.json' } });
    mkdirSync(path.join(root, 'pw/reports/html'), { recursive: true });
    writeFileSync(path.join(root, 'pw/reports/html/index.html'), 'x');
    writeFileSync(path.join(root, 'keep.txt'), 'x');
    spawnSync('git', ['init', '-q'], { cwd: root });
    spawnSync('git', ['add', '.'], { cwd: root });
    assert.deepEqual(run('gitignore', root).stillTracked, ['pw/reports/html/index.html']);
});
