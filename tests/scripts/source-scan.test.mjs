import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listSourceFiles, readAliases, resolveAlias } from '../../scripts/lib/source-scan.mjs';

const repo = (files) => {
    const root = mkdtempSync(path.join(tmpdir(), 'source-scan-'));
    for (const [rel, text] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        writeFileSync(path.join(root, rel), text);
    }
    return root;
};
const cfg = (source = {}) => ({
    source: { roots: ['src'], extensions: ['.js', '.ts', '.vue'], aliases: null, ...source }
});

test('lists files under configured roots by extension, skipping node_modules and .git', () => {
    const root = repo({
        'src/a.ts': '',
        'src/b/c.vue': '',
        'src/d.css': '',
        'src/node_modules/x.js': '',
        'lib/e.js': ''
    });
    assert.deepEqual(listSourceFiles(root, cfg()).files.sort(), ['src/a.ts', 'src/b/c.vue']);
});

test('missing or empty root is a no-targets error', () => {
    const root = repo({ 'app/a.js': '' });
    assert.deepEqual(listSourceFiles(root, cfg()), { files: [], error: 'no-targets' });
});

test('tsconfig paths resolve; comments and trailing commas are tolerated', () => {
    const root = repo({
        'tsconfig.json': `{
            // path map
            "compilerOptions": {
                /* block */ "baseUrl": ".",
                "paths": { "@/*": ["src/*"], },
            },
        }`
    });
    assert.equal(resolveAlias('@/a/b', 'src/x.ts', root, cfg()), 'src/a/b');
    assert.equal(resolveAlias('./y', 'src/x/z.ts', root, cfg()), 'src/x/y');
    assert.equal(resolveAlias('vue', 'src/x.ts', root, cfg()), null);
});

test('extends without paths gives empty aliases and a warning', () => {
    const root = repo({ 'tsconfig.json': '{ "extends": "./.nuxt/tsconfig.json" }' });
    const { aliases, warning } = readAliases(root, cfg());
    assert.deepEqual(aliases, {});
    assert.match(warning, /paths/);
});

test('source.aliases overrides tsconfig', () => {
    const root = repo({
        'tsconfig.json': '{ "compilerOptions": { "paths": { "@/*": ["src/*"] } } }'
    });
    const c = cfg({ aliases: { '~/': 'app/' } });
    assert.deepEqual(readAliases(root, c).aliases, { '~/': 'app/' });
    assert.equal(resolveAlias('~/m/n', 'src/x.ts', root, c), 'app/m/n');
    assert.equal(resolveAlias('@/m', 'src/x.ts', root, c), null);
});

const APP = '{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } } }';

test('solution-style root tsconfig: paths come from referenced files', () => {
    const root = repo({
        'tsconfig.json':
            '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }] }',
        'tsconfig.app.json': APP,
        'tsconfig.node.json': '{ "compilerOptions": { "paths": { "@/*": ["other/*"] } } }'
    });
    const { aliases, warning } = readAliases(root, cfg());
    assert.deepEqual(aliases, { '@/': 'src/' });
    assert.equal(warning, undefined);
    assert.equal(resolveAlias('@/a', 'src/x.ts', root, cfg()), 'src/a');
});

test('root paths win over references', () => {
    const root = repo({
        'tsconfig.json':
            '{ "compilerOptions": { "paths": { "@/*": ["lib/*"] } }, "references": [{ "path": "./tsconfig.app.json" }] }',
        'tsconfig.app.json': APP
    });
    assert.deepEqual(readAliases(root, cfg()).aliases, { '@/': 'lib/' });
});

test('references to a missing file warn without crashing', () => {
    const root = repo({ 'tsconfig.json': '{ "references": [{ "path": "./nope.json" }] }' });
    const { aliases, warning } = readAliases(root, cfg());
    assert.deepEqual(aliases, {});
    assert.match(warning, /paths/);
});
