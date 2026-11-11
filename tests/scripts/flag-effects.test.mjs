import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findFlagEffects } from '../../scripts/flag-effects.mjs';
import { listSourceFiles } from '../../scripts/lib/source-scan.mjs';

const config = { source: { roots: ['src'], extensions: ['.js', '.ts', '.vue'], aliases: null } };
const repo = (files) => {
    const root = mkdtempSync(path.join(tmpdir(), 'flag-effects-'));
    for (const [rel, text] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        writeFileSync(path.join(root, rel), text);
    }
    return root;
};
const run = (targets, root) => findFlagEffects(targets, root, listSourceFiles(root, config).files);

test('lists values other files write while a flag set by the changed file is true', () => {
    const root = repo({
        'src/finish.js':
            'export const done = () => {\n    Utils.KEY_BLOCK = false;\n    let local = true;\n};\n',
        'src/pages/[v]/main.vue': [
            '<script setup>',
            'const keyDownHandler = () => {',
            '    if (Utils.KEY_BLOCK) {',
            '        purchase.updateFlag({ isAvailable: false });',
            '        return true;',
            '    }',
            '    if (!Utils.KEY_BLOCK) {',
            '        other.count = 1;',
            '    }',
            '};',
            '</script>'
        ].join('\n'),
        'src/reader.js': 'if (Utils.KEY_BLOCK) {\n    console.log("blocked");\n}\n',
        'src/local.js': 'if (local) {\n    x.y = 1;\n}\n',
        'src/finish.test.js': 'if (Utils.KEY_BLOCK) {\n    spy.called = true;\n}\n'
    });
    assert.deepEqual(run(['src/finish.js'], root), [
        {
            flag: 'KEY_BLOCK',
            file: 'src/pages/[v]/main.vue',
            line: 3,
            condition: 'Utils.KEY_BLOCK',
            writes: ['isAvailable']
        }
    ]);
});

test('Vue ref .value assignments are not shared flags', () => {
    const root = repo({
        'src/a.vue': 'isOpen.value = true;\n',
        'src/b.vue': 'if (state.value) {\n    other.x = 1;\n}\n'
    });
    assert.deepEqual(run(['src/a.vue'], root), []);
});

test('no files under the configured roots is a no-targets error', () => {
    const root = repo({ 'app/a.js': 'Utils.F = true;\n' });
    assert.deepEqual(findFlagEffects(['app/a.js'], root, []), { error: 'no-targets' });
});
