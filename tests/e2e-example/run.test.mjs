// End-to-end regression: example PRD/TC → coverage-gate → assembler → spec-lint → Playwright on the kit → report.
// Each locale runs in its own copy of the project under .runs/, laid out the way /dev-pipeline:e2e-init leaves it.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { labelsFor } from '../../kit/artifact-labels.mjs';
import { labels } from '../../kit/report/labels.mjs';
import { parseTarget } from '../../scripts/spec-template.mjs';

const HERE = import.meta.dirname;
const PLUGIN = path.join(HERE, '../..');
const KIT = path.join(PLUGIN, 'kit');
const RUNS = path.join(HERE, '.runs');
const PW_CLI = path.join(HERE, 'node_modules/@playwright/test/cli.js');
const PW_VERSION = '1.65.0';
const TEMPLATES = ['adapter.template.js', 'playwright.config.template.js'];

const requireDeps = () => {
    const pkg = path.join(HERE, 'node_modules/@playwright/test/package.json');
    const version = existsSync(pkg) ? JSON.parse(readFileSync(pkg, 'utf8')).version : null;
    if (version !== PW_VERSION)
        throw new Error(`@playwright/test ${PW_VERSION} missing in tests/e2e-example — run: npm install --prefix tests/e2e-example`);
};

const freePort = () =>
    new Promise((resolve) => {
        const server = net.createServer().listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });

const node = (args, cwd, env = {}) => {
    const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, output: `${r.stdout}\n${r.stderr}` };
};
const script = (name, args, cwd) => node([path.join(PLUGIN, 'scripts', name), ...args], cwd);

const write = (file, text) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
};

// Example project for one locale, with the kit, adapter and Playwright config installed as e2e-init does
const createProject = async (locale, { language = null } = {}) => {
    mkdirSync(RUNS, { recursive: true });
    const root = mkdtempSync(path.join(RUNS, `${locale}-`));
    const project = { root, locale, language };
    projects.push(project);
    const port = String(await freePort());
    const config = JSON.parse(readFileSync(path.join(HERE, `.agents/pipeline.config.${locale}.json`), 'utf8').replaceAll('4317', port));
    if (language) config.language = language;
    write(path.join(root, '.agents/pipeline.config.json'), JSON.stringify(config, null, 4));
    const e2e = { kitDir: 'e2e/kit', adapterModule: 'e2e/e2e.adapter.js', specsDir: 'e2e/specs', fixturesDir: 'e2e/fixtures', resultsJson: 'e2e/reports/results.json', ...config.e2e };

    cpSync(path.join(HERE, 'app'), path.join(root, 'app'), { recursive: true });
    cpSync(path.join(HERE, 'e2e/fixtures'), path.join(root, e2e.fixturesDir), { recursive: true });
    for (const kind of ['prd', 'tc'])
        cpSync(path.join(HERE, `works/sample/${kind}.${locale}.md`), path.join(root, config.worksDir, 'sample', `${kind}.md`));

    cpSync(KIT, path.join(root, e2e.kitDir), { recursive: true, filter: (src) => !TEMPLATES.includes(path.basename(src)) });
    cpSync(path.join(KIT, 'utils/adapter.template.js'), path.join(root, e2e.adapterModule));
    const pw = JSON.parse(script('e2e-init.mjs', ['write-playwright-config'], root).stdout);
    assert.ok(pw.ok, pw.errors?.join('\n'));
    return Object.assign(project, { config, e2e, L: labelsFor(locale) });
};

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cells = (line) =>
    line
        .split(/(?<!\\)\|/)
        .slice(1, -1)
        .map((c) => c.replace(/\\\|/g, '|').trim().replace(/^`(.*)`$/, '$1'));
const subsection = (block, title) => block.split(new RegExp(`^#### ${esc(title)}\\s*$`, 'm'))[1]?.split(/^#{2,4} |^---$/m)[0] ?? '';
const field = (block, name) => block.match(new RegExp(`^\\|\\s*\\*\\*${esc(name)}\\*\\*\\s*\\|\\s*(.*?)\\s*\\|`, 'm'))?.[1] ?? '';

// Entry-path steps the example uses; spec-writer compiles the rest from the navigation plan
const stepCode = (step) => {
    const click = step.match(/^click\((.+)\)$/);
    if (click) return `await adapter.locator(page, ${JSON.stringify(parseTarget(click[1]))}).click();`;
    if (/^(goto\(.*\)|waitForAppReady\(\))$/.test(step)) return null;
    throw new Error(`entry step not supported by the example harness: ${step}`);
};

// tc.md → one assembler input per e2e TC, mapped as skills/e2e-test/references/batch-mode.md describes
const tcInputs = (tcMd, { L, e2e }) =>
    tcMd
        .split(/^(?=### TC-\d+)/m)
        .filter((b) => /^### TC-\d+/.test(b))
        .filter((b) => field(b, L['tc.field.e2eSuitability']).includes(L['tc.e2eFit.e2e']))
        .map((block) => {
            const fixtures = Object.fromEntries(
                [...subsection(block, L['tc.preconditions']).matchAll(/`([^`]+)`\s*→\s*`([^`]+)`/g)].map((m) => [m[1], m[2]])
            );
            const verifications = subsection(block, L['tc.checkpoints'])
                .split('\n')
                .filter((l) => /^\|\s*CP-\d+/.test(l))
                .map((l) => {
                    const [, type, target, condition, desc] = cells(l);
                    const isSelector = [L['tc.cp.dom'], L['tc.cp.observe']].includes(type);
                    return { type, [isSelector ? 'selector' : 'path']: target, condition, desc };
                });
            const steps = [...subsection(block, L['tc.entryPath']).matchAll(/^\d+\.\s*`([^`]+)`/gm)].map((m) => m[1]);
            return {
                tcName: block.match(/^### (.+)$/m)[1].trim(),
                outputPath: path.posix.join(e2e.specsDir, 'sample', field(block, L['tc.field.specFile'])),
                screen: field(block, L['tc.field.screen']),
                startUrl: field(block, L['tc.field.startUrl']),
                renderSelector: subsection(block, L['tc.renderReady']).match(/`([^`]+)`/)?.[1] ?? null,
                fixtures,
                verifications,
                successCriteriaText: subsection(block, L['tc.successCriteria']).replace(/^>\s?/gm, '').trim(),
                slotBody: steps.map(stepCode).filter(Boolean).join('\n')
            };
        });

// Assemble with the CLI spec-writer uses, writing into the project
const assemble = (project, input) => {
    const file = path.join(project.root, '.input.json');
    writeFileSync(file, JSON.stringify(input));
    const r = script('spec-template.mjs', [file, '--write'], project.root);
    assert.equal(r.status, 0, r.output);
    return path.join(project.root, input.outputPath);
};

const playwright = (project, target) => {
    const env = { CI: '1', E2E_ARCHIVE: '' };
    // Playwright puts test-results next to the nearest package.json (tests/e2e-example), not the config
    const output = path.join(project.root, 'test-results');
    const r = node([PW_CLI, 'test', target, '--workers=1', '--output', output], project.root, env);
    const results = JSON.parse(readFileSync(path.join(project.root, project.e2e.resultsJson), 'utf8'));
    return { ...r, results };
};

const flatTests = (results) => {
    const out = [];
    const walk = (suite) => {
        for (const spec of suite.specs ?? []) for (const t of spec.tests) out.push({ spec, result: t.results.at(-1) });
        for (const child of suite.suites ?? []) walk(child);
    };
    for (const s of results.suites ?? []) walk(s);
    return out;
};
const verdictOf = (result) => {
    const att = result.attachments.find((a) => a.name === 'verdict.json');
    return att ? JSON.parse(Buffer.from(att.body, 'base64').toString('utf8')) : null;
};
const archiveDir = (project, tag) => {
    const base = path.join(project.root, path.posix.dirname(project.e2e.resultsJson), 'archive');
    const found = readdirSync(base).flatMap((d) => readdirSync(path.join(base, d)).filter((n) => n.startsWith(`${tag}-`)).map((n) => path.join(base, d, n)));
    assert.equal(found.length, 1, `one archive for ${tag}, found ${found.join(', ') || 'none'}`);
    return found[0];
};

const projects = [];
after(() => {
    for (const p of projects) rmSync(p.root, { recursive: true, force: true });
});

for (const locale of ['en', 'ko']) {
    describe(`example pipeline (${locale})`, () => {
        let project;
        let specs;

        test('PRD and TC pass coverage-gate lint with every AC covered', async () => {
            project = await createProject(locale);
            const works = path.join(project.root, project.config.worksDir, 'sample');
            const r = script('coverage-gate.mjs', ['--prd', path.join(works, 'prd.md'), '--tc', path.join(works, 'tc.md'), '--lint'], project.root);
            const out = JSON.parse(r.stdout);
            assert.equal(out.ok, true, r.output);
            assert.equal(out.acTotal, 3);
            assert.equal(out.tcTotal, 3);
            assert.deepEqual(out.uncovered, []);
            assert.deepEqual(out.lint, { errors: [], warnings: [] });
        });

        test('every e2e TC assembles into a spec that passes spec-lint', () => {
            const inputs = tcInputs(readFileSync(path.join(project.root, project.config.worksDir, 'sample/tc.md'), 'utf8'), project);
            assert.equal(inputs.length, 3);
            specs = inputs.map((input) => {
                const spec = assemble(project, input);
                const lint = JSON.parse(script('spec-lint.mjs', [spec], project.root).stdout);
                assert.equal(lint.pass, true, JSON.stringify(lint.violations));
                return { input, spec };
            });
        });

        test('Playwright runs the specs on the kit fixture: all PASS, report written', () => {
            requireDeps();
            const run = playwright(project, `${project.e2e.specsDir}/sample/`);
            assert.equal(run.status, 0, run.output.slice(-4000));
            const tests = flatTests(run.results);
            assert.equal(tests.length, 3);
            for (const { spec, result } of tests) {
                assert.equal(result.status, 'passed', spec.title);
                const verdict = verdictOf(result);
                // test.use({ e2e }) reached the fixture
                assert.equal(verdict.testName, spec.title);
                assert.equal(verdict.verdict, 'PASS');
                assert.ok(verdict.cp.every((c) => c.passed), JSON.stringify(verdict.cp));
                assert.ok(verdict.mockHits && typeof verdict.mockHits === 'object');
            }
            const list = verdictOf(tests.find((t) => t.spec.file.endsWith('tc02-item-list.spec.js')).result);
            assert.deepEqual(list.mockHits, { '**/api/items': 1 });
            // the fetch happens during beforeEach's goto, so a collector started later would count 0
            assert.equal(list.mockBoundary.fixture, 1);

            const archive = archiveDir(project, 'sample');
            const html = readFileSync(path.join(archive, 'e2e-report.html'), 'utf8');
            assert.ok(html.includes(labels(locale).gate.ok));
            const md = readFileSync(path.join(project.root, project.config.worksDir, 'sample/e2e-report.md'), 'utf8');
            assert.ok(md.includes(`**${labels(locale).gate.ok}**`), md);
        });
    });
}

describe('example pipeline (language ko, locale en)', () => {
    test('tc.md is read in the artifact locale while the report text is ko (language ko, locale en)', async () => {
        requireDeps();
        const project = await createProject('en', { language: 'ko' });
        const works = path.join(project.root, project.config.worksDir, 'sample');
        for (const input of tcInputs(readFileSync(path.join(works, 'tc.md'), 'utf8'), project)) assemble(project, input);
        const run = playwright(project, `${project.e2e.specsDir}/sample/`);
        assert.equal(run.status, 0, run.output.slice(-4000));
        const md = readFileSync(path.join(works, 'e2e-report.md'), 'utf8');
        const ko = labels('ko');
        assert.ok(md.includes(`**${ko.gate.ok}**`), md);
        // every AC has an e2e row, so the en tc.md was not misread as having no e2e TCs
        const acRows = md.split('\n').filter((l) => /^\| AC-\d+ \|/.test(l));
        assert.equal(acRows.length, 3, md);
        assert.ok(acRows.every((l) => l.includes(ko.acState.passed)), md);
    });
});

describe('example pipeline (regressions)', () => {
    test('service worker on list.html does not bypass the page.route mock', () => {
        requireDeps();
        const project = projects.find((p) => p.locale === 'en' && !p.language);
        assert.ok(project, 'en project not created');
        const run = playwright(project, `${project.e2e.specsDir}/sample/tc02-item-list.spec.js`);
        assert.equal(run.status, 0, run.output.slice(-4000));
        const verdict = verdictOf(flatTests(run.results)[0].result);
        assert.match(verdict.cp.find((c) => c.id === 'cp-02').actual, /First mocked item/);
    });

    test('a mock no test uses fails its spec file as mock-unused', () => {
        requireDeps();
        const project = projects.find((p) => p.locale === 'en' && !p.language);
        assert.ok(project, 'en project not created');
        const works = path.join(project.root, project.config.worksDir);
        // a tc.md beside the slug makes the reporter write e2e-report.md, whose result cell names the failure kind
        cpSync(path.join(works, 'sample/tc.md'), path.join(works, 'unused/tc.md'));
        const home = tcInputs(readFileSync(path.join(works, 'sample/tc.md'), 'utf8'), project)[0];
        assemble(project, { ...home, outputPath: `${project.e2e.specsDir}/unused/tc01-home-title.spec.js`, fixtures: { '**/api/items': 'items.json' } });
        const run = playwright(project, `${project.e2e.specsDir}/unused/`);
        // The test and the judge pass; the file-level mock count fails it in the report, and the reporter fails the run
        assert.notEqual(run.status, 0, run.output.slice(-4000));
        assert.match(run.output, /run status set to failed/);
        const [only] = flatTests(run.results);
        assert.equal(only.result.status, 'passed');
        const verdict = verdictOf(only.result);
        assert.equal(verdict.verdict, 'PASS');
        assert.deepEqual(verdict.mockHits, { '**/api/items': 0 });
        const unused = labels('en').failure['mock-unused'];
        const md = readFileSync(path.join(works, 'unused/e2e-report.md'), 'utf8');
        assert.ok(md.includes(`| ${unused}: \`**/api/items\` |`), md);
        const html = readFileSync(path.join(archiveDir(project, 'tc01-home-title'), 'e2e-report.html'), 'utf8');
        assert.ok(html.includes(`<b>${unused}</b><pre>`));
    });

    test('a multi-case spec with an Observe checkpoint shares one beforeEach mock and passes', () => {
        requireDeps();
        const project = projects.find((p) => p.locale === 'en' && !p.language);
        assert.ok(project, 'en project not created');
        const spec = assemble(project, {
            outputPath: `${project.e2e.specsDir}/multi/list-bundle.spec.js`,
            screen: 'item list',
            startUrl: '/list.html',
            renderSelector: '[data-testid="item"]',
            fixtures: { '**/api/items': 'items.json' },
            cases: [
                { tcName: 'TC-02: list labels', slotBody: '', verifications: [{ type: 'DOM', selector: 'testid:item-list', condition: "hasText('First mocked item')" }] },
                { tcName: 'TC-04: items stay listed', slotBody: '', verifications: [{ type: 'Observe', selector: '[data-testid="item"]', condition: 'peak toBe(2)', window: 600 }] }
            ]
        });
        const lint = JSON.parse(script('spec-lint.mjs', [spec], project.root).stdout);
        assert.equal(lint.pass, true, JSON.stringify(lint.violations));
        const run = playwright(project, `${project.e2e.specsDir}/multi/`);
        assert.equal(run.status, 0, run.output.slice(-4000));
        const tests = flatTests(run.results);
        assert.equal(tests.length, 2);
        for (const { spec: s, result } of tests) {
            assert.equal(result.status, 'passed', s.title);
            const verdict = verdictOf(result);
            assert.equal(verdict.verdict, 'PASS');
            // each test runs the shared beforeEach, so each records its own hit
            assert.deepEqual(verdict.mockHits, { '**/api/items': 1 });
        }
        const observe = verdictOf(tests.find((t) => t.spec.title.startsWith('TC-04')).result).cp[0];
        assert.match(observe.actual, /^peak 2 · First mocked item \| Second mocked item$/);
        const html = readFileSync(path.join(archiveDir(project, 'list-bundle'), 'e2e-report.html'), 'utf8');
        assert.ok(!html.includes(labels('en').failure['mock-unused']));
    });

    test('field-consumers reports no-targets when source.roots matches nothing', () => {
        mkdirSync(RUNS, { recursive: true });
        const root = mkdtempSync(path.join(RUNS, 'roots-'));
        projects.push({ root });
        const config = JSON.parse(readFileSync(path.join(HERE, '.agents/pipeline.config.en.json'), 'utf8'));
        write(path.join(root, '.agents/pipeline.config.json'), JSON.stringify({ ...config, source: { roots: ['no-such-dir'] } }));
        const r = script('field-consumers.mjs', ['display_name'], root);
        assert.equal(r.status, 1);
        assert.deepEqual(JSON.parse(r.stdout), { error: 'no-targets' });
    });
});
