import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { collect, findAiCutoff, isNoiseSubject, truncateDiff } from '../../scripts/style/collect.mjs';

const catalog = {
    layers: [
        { id: 'ui', paths: ['app/components/**'] },
        { id: 'server', paths: ['server/**'] }
    ],
    excluded: []
};
const EMAILS = ['me@x', 'me2@x'];
let repo;

const commit = ({ email, date, files, subject, body = '' }, target = repo) => {
    const repo = target;
    for (const [file, content] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
        writeFileSync(path.join(repo, file), content);
    }
    const stamp = `${date}T12:00:00+09:00`;
    const env = { ...process.env, GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp };
    const run = (args) => {
        const r = spawnSync('git', args, { cwd: repo, env, encoding: 'utf8' });
        if (r.status !== 0) throw new Error(r.stderr);
    };
    run(['add', '-A']);
    run([
        '-c',
        `user.email=${email}`,
        '-c',
        'user.name=t',
        'commit',
        '-q',
        '-m',
        subject,
        '-m',
        body || ' '
    ]);
};

const A_V1 = '<script>\nconst a = 1;\nconst b = 2;\n</script>\n';
const A_V2 = '<script>\nconst a = 10;\nconst b = 2;\n</script>\n';
const A_V2_INDENTED = '<script>\n    const a = 10;\n    const b = 2;\n</script>\n';
const A_V3 = '<script>\n    const a = 10;\n    const b = 3;\n</script>\n';

before(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'style-collect-'));
    spawnSync('git', ['init', '-q'], { cwd: repo });
    commit({
        email: 'other@x',
        date: '2025-01-01',
        files: { 'app/components/A.vue': A_V1 },
        subject: 'A 추가'
    });
    commit({
        email: 'me@x',
        date: '2025-02-01',
        files: { 'app/components/A.vue': A_V2 },
        subject: 'A 로직 수정'
    });
    commit({
        email: 'me2@x',
        date: '2025-02-02',
        files: { 'server/b.js': 'export const b = 1;\n' },
        subject: 'b 추가'
    });
    commit({
        email: 'me@x',
        date: '2025-02-03',
        files: { 'server/b.js': 'export const b = 2;\n' },
        subject: 'stg version up 1.2.3'
    });
    commit({
        email: 'me@x',
        date: '2025-02-04',
        files: { 'app/components/A.vue': A_V2_INDENTED },
        subject: 'A 들여쓰기'
    });
    commit({
        email: 'me@x',
        date: '2025-02-05',
        files: { 'app/components/한글.vue': '<template><div /></template>\n' },
        subject: '한글 추가'
    });
    commit({
        email: 'other@x',
        date: '2025-02-06',
        files: { 'server/b.js': 'export const b = 3;\n' },
        subject: 'b 수정',
        body: 'Co-Authored-By: Claude <noreply@anthropic.com>'
    });
    commit({
        email: 'me@x',
        date: '2025-03-01',
        files: { 'app/components/A.vue': A_V3 },
        subject: 'A 다시 수정'
    });
});

after(() => rmSync(repo, { recursive: true, force: true }));

const run = (opts = {}) =>
    collect({ repo, catalog, emails: EMAILS, until: '2025-03-01', noiseSubjects: ['version up'], ...opts });

test('collects commits from every listed email', () => {
    const ev = run();
    assert.ok(ev.layers.server.mine.some((s) => s.author === 'me2@x' && s.kind === 'new'));
    assert.ok(ev.layers.ui.mine.some((s) => s.author === 'me@x' && s.kind === 'others'));
});

test('drops version-up commits and whitespace-only file diffs', () => {
    const ev = run();
    assert.ok(!ev.layers.server.mine.some((s) => /version up/i.test(s.subject)));
    assert.equal(ev.meta.totals.noise, 1);
    assert.equal(ev.meta.totals.formatOnly, 1);
});

test('keeps commits on the cutoff day out of mine and counts them', () => {
    const ev = run();
    assert.equal(ev.layers.ui.mine.filter((s) => s.date === '2025-03-01').length, 0);
    assert.equal(ev.layers.ui.afterCutoff, 1);
});

test('builds baseline from other authors before the repo cutoff', () => {
    const ev = run();
    assert.equal(ev.meta.repoCutoff, '2025-02-06');
    assert.ok(ev.layers.ui.baseline.length > 0);
    assert.ok(ev.layers.ui.baseline.every((s) => s.author === 'other@x' && s.date < '2025-02-06'));
    assert.equal(ev.layers.server.baseline.length, 0);
});

test('handles non-ASCII paths', () => {
    const ev = run({ emails: ['me@x'] });
    assert.ok(ev.layers.ui.mine.some((s) => s.file === 'app/components/한글.vue'));
});

test('returns empty layers when no commits precede the cutoff', () => {
    const ev = run({ emails: ['me@x'], until: '2024-01-01' });
    assert.deepEqual(ev.layers.ui.mine, []);
    assert.deepEqual(ev.layers.server.mine, []);
});

test('findAiCutoff finds the first trailer date', () => {
    assert.equal(findAiCutoff({ repo }), '2025-02-06');
    assert.equal(findAiCutoff({ repo, emails: ['me@x'] }), null);
});

test('truncateDiff keeps the head and notes the cut', () => {
    const out = truncateDiff(Array.from({ length: 130 }, (_, i) => `l${i}`).join('\n'), 120);
    assert.equal(out.split('\n').length, 121);
    assert.match(out, /10 lines omitted/);
});

test('caps samples per file so one heavily edited file cannot fill a layer', () => {
    const own = mkdtempSync(path.join(tmpdir(), 'style-collect-cap-'));
    spawnSync('git', ['init', '-q'], { cwd: own });
    const x = (n) => `export const x = ${n};\n`;
    commit(
        {
            email: 'other@x',
            date: '2025-01-01',
            files: { 'app/components/X.vue': x(0) },
            subject: 'X'
        },
        own
    );
    commit(
        {
            email: 'me@x',
            date: '2025-01-02',
            files: { 'app/components/Y.vue': x(9) },
            subject: 'Y'
        },
        own
    );
    for (let i = 1; i <= 4; i++)
        commit(
            {
                email: 'me@x',
                date: `2025-01-1${i}`,
                files: { 'app/components/X.vue': x(i) },
                subject: `X ${i}`
            },
            own
        );
    try {
        const ev = collect({
            repo: own,
            catalog,
            emails: ['me@x'],
            until: '2025-03-01',
            perLayer: 3
        });
        const files = ev.layers.ui.mine.map((s) => s.file);
        assert.ok(files.includes('app/components/Y.vue'), files.join(','));
        assert.equal(files.filter((f) => f === 'app/components/X.vue').length, 2);
    } finally {
        rmSync(own, { recursive: true, force: true });
    }
});

const scratch = (name) => {
    const dir = mkdtempSync(path.join(tmpdir(), `style-collect-${name}-`));
    spawnSync('git', ['init', '-q'], { cwd: dir });
    return dir;
};

const gitAs = (dir, email, date, args) => {
    const stamp = `${date}T12:00:00+09:00`;
    const env = { ...process.env, GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp };
    const r = spawnSync('git', ['-c', `user.email=${email}`, '-c', 'user.name=t', ...args], {
        cwd: dir,
        env,
        encoding: 'utf8'
    });
    if (r.status !== 0) throw new Error(r.stderr);
};

test('follows renames so moved files keep their first author and layer', () => {
    const dir = scratch('rename');
    const body = (n) =>
        Array.from({ length: 20 }, (_, i) => `const v${i} = ${i === 0 ? n : i};`).join('\n') + '\n';
    try {
        commit(
            {
                email: 'other@x',
                date: '2025-01-01',
                files: { 'src/components/R.vue': body(0) },
                subject: 'R'
            },
            dir
        );
        commit(
            {
                email: 'me@x',
                date: '2025-01-05',
                files: { 'src/components/R.vue': body(1) },
                subject: 'R 1'
            },
            dir
        );
        mkdirSync(path.join(dir, 'app/components'), { recursive: true });
        gitAs(dir, 'other@x', '2025-01-10', ['mv', 'src/components/R.vue', 'app/components/R.vue']);
        gitAs(dir, 'other@x', '2025-01-10', ['commit', '-q', '-m', 'move']);
        commit(
            {
                email: 'me@x',
                date: '2025-01-15',
                files: { 'app/components/R.vue': body(2) },
                subject: 'R 2'
            },
            dir
        );
        const ev = collect({ repo: dir, catalog, emails: ['me@x'], until: '2025-03-01' });
        assert.deepEqual(
            ev.layers.ui.mine.map((s) => [s.file, s.kind]),
            [
                ['app/components/R.vue', 'others'],
                ['app/components/R.vue', 'others']
            ]
        );
        assert.ok(
            !ev.layers.ui.baseline.some((s) => s.subject === 'move'),
            'pure move is not a sample'
        );
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('caps samples per commit within a layer', () => {
    const dir = scratch('percommit');
    try {
        const files = Object.fromEntries(
            [1, 2, 3, 4].map((i) => [`app/components/B${i}.vue`, `const b = ${i};\n`])
        );
        commit({ email: 'me@x', date: '2025-01-01', files, subject: 'big' }, dir);
        commit(
            {
                email: 'me@x',
                date: '2025-01-02',
                files: { 'app/components/S.vue': 'const s = 1;\n' },
                subject: 'small'
            },
            dir
        );
        const ev = collect({
            repo: dir,
            catalog,
            emails: ['me@x'],
            until: '2025-03-01',
            perLayer: 4
        });
        assert.equal(ev.layers.ui.mine.filter((s) => s.subject === 'big').length, 2);
        assert.ok(ev.layers.ui.mine.some((s) => s.subject === 'small'));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('drops commits before --since', () => {
    const ev = run({ since: '2025-02-02' });
    assert.ok(ev.layers.ui.mine.every((s) => s.date >= '2025-02-02'));
    assert.ok(ev.layers.ui.baseline.every((s) => s.date >= '2025-02-02'));
});

test('spreads samples across the whole period instead of the newest weeks', () => {
    const dir = scratch('spread');
    try {
        for (let m = 1; m <= 9; m++)
            commit(
                {
                    email: 'me@x',
                    date: `2025-0${m}-01`,
                    files: { [`app/components/M${m}.vue`]: `const m = ${m};\n` },
                    subject: `m${m}`
                },
                dir
            );
        const ev = collect({
            repo: dir,
            catalog,
            emails: ['me@x'],
            until: '2025-12-01',
            perLayer: 3
        });
        const dates = ev.layers.ui.mine.map((s) => s.date).sort();
        assert.equal(dates[0], '2025-01-01');
        assert.equal(dates[dates.length - 1], '2025-09-01');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('noise subjects come from the caller; none means nothing is noise', () => {
    assert.equal(isNoiseSubject('stg version up 1.2.3', []), false);
    assert.equal(isNoiseSubject('stg Version Up 1.2.3', ['version up']), true);
    assert.equal(run({ noiseSubjects: [] }).meta.totals.noise, 0);
});
