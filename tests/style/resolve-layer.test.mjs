import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLayers, checkCatalog, trackedCodeFiles } from '../../scripts/style/resolve-layer.mjs';

const catalog = {
    version: 1,
    layers: [
        { id: 'ui', name: 'UI', doc: 'ui.md', paths: ['app/components/**'] },
        {
            id: 'motion',
            name: '모션',
            doc: 'motion.md',
            paths: ['app/utils/animation/**'],
            imports: ['^(gsap|three)(/|$)']
        },
        {
            id: 'platform',
            name: '플랫폼',
            doc: 'platform.md',
            paths: ['app/utils/stbInterface.js']
        },
        { id: 'server', name: '서버', doc: 'server.md', paths: ['server/**'] },
        {
            id: 'observability',
            name: '로그',
            doc: 'observability.md',
            paths: ['server/core/logger.js']
        }
    ],
    excluded: ['app/mocks/**', '**/*.test.js']
};

test('maps a path to its layer', () => {
    assert.deepEqual(resolveLayers('app/components/home/Block.vue', catalog), ['ui']);
});

test('returns every overlapping layer in catalog order', () => {
    assert.deepEqual(resolveLayers('server/core/logger.js', catalog), ['server', 'observability']);
});

test('adds motion when content imports a motion library', () => {
    const content = "import gsap from 'gsap';\nexport default {}";
    assert.deepEqual(resolveLayers('app/components/home/Banner.vue', catalog, { content }), [
        'ui',
        'motion'
    ]);
});

test('excluded paths resolve to nothing', () => {
    assert.deepEqual(resolveLayers('app/components/home/Block.test.js', catalog), []);
    assert.deepEqual(resolveLayers('app/mocks/responses/a.js', catalog), []);
});

test('leaves unlisted app/utils files unmapped', () => {
    const { unmapped } = checkCatalog(catalog, {
        layersDir: null,
        trackedFiles: ['app/utils/stbInterface.js', 'app/utils/newThing.js']
    });
    assert.deepEqual(unmapped, ['app/utils/newThing.js']);
});

test('reports duplicate ids and missing docs', () => {
    const broken = {
        ...catalog,
        layers: [...catalog.layers, { id: 'ui', name: 'UI2', doc: 'none.md', paths: [] }]
    };
    const { errors } = checkCatalog(broken, { layersDir: '/nonexistent', trackedFiles: [] });
    assert.ok(errors.some((e) => e.includes('ui') && e.includes('duplicate')));
    assert.ok(errors.some((e) => e.includes('none.md')));
});

test('a layer exclude moves a file out of that layer only', () => {
    const cat = {
        layers: [
            {
                id: 'controller',
                paths: ['app/controller/**'],
                exclude: ['app/controller/**/*FocusArea.js']
            },
            { id: 'ui', paths: ['app/controller/**/*FocusArea.js'] }
        ],
        excluded: []
    };
    assert.deepEqual(resolveLayers('app/controller/search/searchFocusArea.js', cat), ['ui']);
    assert.deepEqual(resolveLayers('app/controller/search/searchController.js', cat), [
        'controller'
    ]);
});

test('trackedCodeFiles honours codeRoots, extensions and extra files', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'style-tracked-'));
    try {
        const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
        git('init', '-q');
        for (const f of ['src/a.js', 'src/b.md', 'lib/c.js', 'vite.config.js']) {
            mkdirSync(path.join(dir, path.dirname(f)), { recursive: true });
            writeFileSync(path.join(dir, f), '');
        }
        git('add', '.');
        const opts = { codeExtensions: ['js'], extraCodeFiles: ['vite.config.js'] };
        assert.deepEqual(trackedCodeFiles({ ...opts, codeRoots: ['src/'], cwd: dir }), ['src/a.js', 'vite.config.js']);
        assert.deepEqual(trackedCodeFiles({ ...opts, codeRoots: null, cwd: dir }), ['lib/c.js', 'src/a.js', 'vite.config.js']);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('layer docs need the Fixed and Methodology sections', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'style-docs-'));
    try {
        writeFileSync(path.join(dir, 'ui.md'), '# UI\n\n## Fixed\n\n## Methodology\n');
        writeFileSync(path.join(dir, 'motion.md'), '# Motion\n\n## Fixed\n');
        const cat = { layers: [{ id: 'ui', doc: 'ui.md', paths: [] }, { id: 'motion', doc: 'motion.md', paths: [] }] };
        const { errors } = checkCatalog(cat, { layersDir: dir, trackedFiles: [] });
        assert.deepEqual(errors, ['motion: motion.md has no "## Methodology" section']);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
