import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findConsumers } from '../../scripts/field-consumers.mjs';
import { listSourceFiles } from '../../scripts/lib/source-scan.mjs';

const config = { source: { roots: ['src'], extensions: ['.js', '.ts', '.vue'], aliases: null } };
const repo = (files) => {
    const root = mkdtempSync(path.join(tmpdir(), 'field-consumers-'));
    for (const [rel, text] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        writeFileSync(path.join(root, rel), text);
    }
    return root;
};
const run = (fields, root) => findConsumers(fields, root, listSourceFiles(root, config).files);

test('lines that split or parse the field are parsers; the rest are counted per file', () => {
    const root = repo({
        'src/router/utils.js': [
            'if (item.call_url) {',
            "    let callUrlParams = item.call_url.split('/');",
            '}'
        ].join('\n'),
        'src/a.js': 'const x = { call_url: v };\nsend(x.call_url);\n',
        'src/a.test.js': "item.call_url.split('/');\n",
        'src/mocks/data.js': "item.call_url.split('/');\n"
    });
    const [result] = run(['call_url'], root);
    assert.equal(result.field, 'call_url');
    assert.deepEqual(result.parsers, [
        {
            file: 'src/router/utils.js',
            line: 2,
            text: "let callUrlParams = item.call_url.split('/');",
            fn: null,
            segments: []
        }
    ]);
    assert.deepEqual(result.others, [
        { file: 'src/a.js', count: 2 },
        { file: 'src/router/utils.js', count: 1 }
    ]);
});

test('destructure-then-split and JSON.parse are parsers; .ts files are scanned', () => {
    const root = repo({
        'src/b.ts': "const { call_url } = item;\nconst no = call_url.split('=')[1];\n",
        'src/c.js': 'const v = JSON.parse(extras.link_value);\n'
    });
    const [callUrl, linkValue] = run(['call_url', 'link_value'], root);
    assert.deepEqual(
        callUrl.parsers.map((p) => p.line),
        [2]
    );
    assert.deepEqual(
        linkValue.parsers.map((p) => p.file),
        ['src/c.js']
    );
});

test('per parser, reports the segments read from the split and the enclosing function', () => {
    const root = repo({
        'src/nav.js': [
            'class Nav {',
            '    landAt(item) {',
            "        const p = item.call_url.split('/');",
            "        type = map[p[0]] || '';",
            '        id = p[3];',
            '        last = p[p.length - 1];',
            '    }',
            '    other() {',
            '        return p[9];',
            '    }',
            '}'
        ].join('\n'),
        'src/a.js': [
            'const go = (call_url) => {',
            "    const no = call_url.split('=')[1];",
            "    const [x, , z] = call_url.split('|');",
            '};'
        ].join('\n')
    });
    const [{ parsers }] = run(['call_url'], root);
    const view = parsers.map((p) => [
        p.fn,
        p.segments.map((s) => `${s.delimiter}${s.index}@${s.line}`)
    ]);
    assert.deepEqual(view, [
        ['go', ['=[1]@2']],
        ['go', ['|[0]@3', '|[2]@3']],
        ['landAt', ['/[0]@4', '/[3]@5', '/[-1]@6']]
    ]);
});

test('a B-TV-shaped repo with no src/ reports no-targets instead of empty findings', () => {
    const root = repo({ 'app/a.js': "item.call_url.split('/');\n" });
    assert.deepEqual(run(['call_url'], root), { error: 'no-targets' });
});
