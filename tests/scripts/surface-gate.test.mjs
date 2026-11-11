import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve('scripts/surface-gate.mjs');
const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const sh = (repo, ...argv) => execFileSync('git', argv, { cwd: repo, encoding: 'utf8' }).trim();
const commit = (repo, file, body) => {
    writeFileSync(path.join(repo, file), body);
    sh(repo, 'add', file);
    sh(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', file);
    return sh(repo, 'rev-parse', '--short', 'HEAD');
};
// default branch `trunk`, then a feature branch with two commits
const setup = (defaultBranch = 'trunk') => {
    const repo = mkdtempSync(path.join(tmpdir(), 'surface-'));
    dirs.push(repo);
    sh(repo, 'init', '-q', '-b', defaultBranch);
    const root = commit(repo, 'a.js', 'export const a = 1;\n');
    sh(repo, 'checkout', '-qb', 'feat');
    const start = commit(repo, 'b.js', 'export const b = 2;\n');
    commit(repo, 'c.js', 'export const c = 3;\n');
    return { repo, root, start };
};
const run = (repo, ...args) => JSON.parse(execFileSync('node', [SCRIPT, ...args], { cwd: repo, encoding: 'utf8' }));

test('state baseCommit wins over default-branch guessing', () => {
    const { repo, start } = setup('master');
    writeFileSync(path.join(repo, 'state.json'), JSON.stringify({ baseCommit: start }));
    const r = run(repo, '--state', 'state.json');
    assert.deepEqual([r.ok, r.base, r.baseSource], [true, start, 'state.baseCommit']);
});

test('no state: falls back to merge-base with master', () => {
    const { repo, root } = setup('master');
    const r = run(repo);
    assert.deepEqual([r.ok, r.base, r.baseSource], [true, root, 'merge-base master']);
});

test('baseCommit that is no longer an ancestor is ignored', () => {
    const { repo, root } = setup('main');
    writeFileSync(path.join(repo, 'state.json'), JSON.stringify({ baseCommit: 'deadbeef' }));
    const r = run(repo, '--state', 'state.json');
    assert.deepEqual([r.ok, r.base, r.baseSource], [true, root, 'merge-base main']);
});

test('unknown default branch and no state: ok false, asks for --base', () => {
    const { repo, start } = setup('trunk');
    const r = run(repo);
    assert.equal(r.ok, false);
    assert.match(r.error, /--base/);
    assert.equal(run(repo, '--base', start).baseSource, '--base');
});
