import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const RESOLVE = path.join(ROOT, 'scripts/style/resolve-layer.mjs');
const COLLECT = path.join(ROOT, 'scripts/style/collect.mjs');
const PLAN_CONTEXT = path.join(ROOT, 'scripts/style/plan-context.mjs');
const node = (args, cwd = ROOT) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });

test('--check fails instead of passing when git cannot list files', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'style-cli-'));
    try {
        const catalog = path.join(dir, 'catalog.json');
        writeFileSync(catalog, JSON.stringify({ excluded: [], layers: [] }));
        const r = node([RESOLVE, '--check', '--catalog', catalog], dir);
        assert.notEqual(r.status, 0);
        assert.match(r.stderr, /git/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('collect rejects malformed dates and counts', () => {
    const base = [COLLECT, '--emails', 'a@x', '--out', path.join(tmpdir(), 'never.json')];
    for (const bad of [
        ['--until', '2026-3-12'],
        ['--until', '2026-03-12', '--since', '23-01-01'],
        ['--until', '2026-03-12', '--per-layer', 'abc'],
        ['--until', '2026-03-12', '--baseline-per-layer', '0']
    ]) {
        const r = node([...base, ...bad]);
        assert.equal(r.status, 2, bad.join(' '));
        assert.match(r.stderr, /usage|format/);
    }
});

test('modules can be imported without a script path', () => {
    for (const file of [RESOLVE, COLLECT, PLAN_CONTEXT]) {
        const r = node(['-e', `import(${JSON.stringify(file)}).then(() => console.log('ok'))`]);
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /ok/);
    }
});

test('plan-context stops with exit 2 when the plan or style is missing', () => {
    const r = node([PLAN_CONTEXT, '--plan', 'no/such-plan.md']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /usage/);
    const s = node([PLAN_CONTEXT, '--plan', 'README.md', '--style', 'no-such-person']);
    assert.equal(s.status, 2);
    assert.match(s.stderr, /no-such-person/);
});

test('collect reports a missing catalog as a message, not a stack trace', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'style-collect-'));
    try {
        spawnSync('git', ['init', '-q'], { cwd: dir });
        const r = node([COLLECT, '--emails', 'a@x', '--until', '2026-01-01', '--out', path.join(dir, 'ev.json')], dir);
        assert.equal(r.status, 2);
        assert.match(r.stderr, /catalog\.json/);
        assert.doesNotMatch(r.stderr, /^\s+at /m);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
