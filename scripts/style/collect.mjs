/**
 * collect — gather commit evidence per development layer for style analysis (style-extract's collect node)
 *
 *   node collect.mjs --emails a@x,b@y --out <file> [--until YYYY-MM-DD|auto]
 *     [--since YYYY-MM-DD] [--catalog <f>] [--repo <dir>] [--per-layer n] [--baseline-per-layer n]
 *
 * mine = the developer's commits before the AI adoption date (--until); baseline = other authors' commits
 * before the repo's first AI trailer. It picks samples and judges nothing.
 * Noise subjects and the catalog location come from pipeline.config.json `style`.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadCatalog, resolveLayers, styleConfig } from './resolve-layer.mjs';

const AI_TRAILER = 'Co-Authored-By: Claude';
const KIND_ORDER = ['others', 'own', 'new'];
const REC = '\x00';
const SEP = '\x1f';
// spawn arguments cannot carry NUL, so git's format escapes stand in
const FMT_REC = '%x00';
const FMT_SEP = '%x1f';

const git = (repo, args) => {
    const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], {
        cwd: repo,
        encoding: 'utf8',
        maxBuffer: 1 << 30
    });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout;
};

export const isNoiseSubject = (subject, patterns = []) =>
    patterns.some((re) => new RegExp(re, 'i').test(subject));

export const truncateDiff = (diff, maxLines = 120) => {
    const lines = diff.split('\n');
    if (lines.length <= maxLines) return diff;
    return [...lines.slice(0, maxLines), `… (${lines.length - maxLines} lines omitted)`].join('\n');
};

export const findAiCutoff = ({ repo, emails = [] }) => {
    const authors = emails.map((e) => `--author=${e}`);
    const out = git(repo, [
        'log',
        '--reverse',
        '-i',
        `--grep=${AI_TRAILER}`,
        '--format=%ad',
        '--date=short',
        ...authors
    ]);
    return out.split('\n').find(Boolean) ?? null;
};

const readCommits = (repo) =>
    git(repo, [
        'log',
        '--no-merges',
        '--name-status',
        `--format=${FMT_REC}%H${FMT_SEP}%ad${FMT_SEP}%ae${FMT_SEP}%s`,
        '--date=short'
    ])
        .split(REC)
        .filter(Boolean)
        .map((rec) => {
            const [head, ...rest] = rec.split('\n');
            const [sha, date, author, subject] = head.split(SEP);
            const files = rest
                .filter(Boolean)
                .map((line) => line.split('\t'))
                .filter(([status]) => !status.startsWith('D'))
                // rename/copy rows are [status+similarity, old path, new path]
                .map((cols) => ({
                    status: cols[0][0],
                    similarity: Number(cols[0].slice(1)) || 0,
                    from: cols.length > 2 ? cols[1] : null,
                    file: cols[cols.length - 1]
                }));
            return { sha, date, author: author.toLowerCase(), subject, files };
        });

// yields 0, last, middle, quarters… so taking only the first few still spans the whole period
const spreadOrder = (n) => {
    const order = [];
    const seen = new Set();
    for (let parts = 1; order.length < n; parts *= 2)
        for (let k = 0; k <= parts; k++) {
            const i = Math.round((k * (n - 1)) / parts);
            if (!seen.has(i)) seen.add(i) && order.push(i);
        }
    return order;
};

// within a kind, take one per commit in turn so a single commit cannot own the samples;
// newest-first order would cluster them in the last few weeks, so spread across the period
const interleaveByCommit = (cands) => {
    const groups = new Map();
    for (const c of cands) groups.set(c.sha, [...(groups.get(c.sha) ?? []), c]);
    const byDate = [...groups.values()];
    const lists = spreadOrder(byDate.length).map((i) => byDate[i]);
    const out = [];
    for (let i = 0; lists.some((l) => i < l.length); i++)
        for (const l of lists) if (l[i]) out.push(l[i]);
    return out;
};

// a long-edited file must not fill a layer: cap per file on the first pass, then fill the rest
const PER_FILE_FIRST_PASS = 2;
// one bulk move or format commit must not fill a layer
const PER_COMMIT_LIMIT = 2;

const rank = (cands) => {
    const ordered = KIND_ORDER.flatMap((k) =>
        interleaveByCommit(cands.filter((c) => c.kind === k))
    );
    const seen = new Map();
    const tagged = ordered.map((c) => {
        const n = (seen.get(c.file) ?? 0) + 1;
        seen.set(c.file, n);
        return { c, first: n <= PER_FILE_FIRST_PASS };
    });
    return [...tagged.filter((t) => t.first), ...tagged.filter((t) => !t.first)].map((t) => t.c);
};

export const collect = ({
    repo,
    catalog,
    emails,
    until,
    since = '0000-00-00',
    perLayer = 12,
    baselinePerLayer = 6,
    noiseSubjects = []
}) => {
    const mineSet = new Set(emails.map((e) => e.toLowerCase()));
    const repoCutoff = findAiCutoff({ repo });
    const baselineUntil = repoCutoff ?? until;
    const commits = readCommits(repo);
    // git log runs newest first: walk back building an old-path → current-path map,
    // so the author of the oldest add (A) ends up as the file's creator
    const canonical = new Map();
    const canon = (f) => canonical.get(f) ?? f;
    const firstAuthors = new Map();
    for (const c of commits) {
        for (const f of c.files) {
            f.canonical = canon(f.file);
            if (f.status === 'A') firstAuthors.set(f.canonical, c.author);
        }
        for (const f of c.files) if (f.status === 'R') canonical.set(f.from, f.canonical);
    }
    // formatOnly counts samples dropped because their -w diff was empty, not format commits across history
    const totals = { mine: 0, noise: 0, formatOnly: 0, afterCutoff: 0 };
    // the same path recurs thousands of times in history; resolve each path once
    const layersOf = new Map();
    const ids = catalog.layers.map((l) => l.id);
    const pool = Object.fromEntries(
        ids.map((id) => [id, { mine: [], baseline: [], afterCutoff: 0 }])
    );

    for (const c of commits) {
        if (c.date < since) continue;
        const isMine = mineSet.has(c.author);
        if (isMine && c.date < until && isNoiseSubject(c.subject, noiseSubjects)) {
            totals.noise++;
            continue;
        }
        if (isMine && c.date < until) totals.mine++;
        for (const { status, similarity, from, file: pathAtCommit, canonical: file } of c.files) {
            if (!layersOf.has(file)) layersOf.set(file, resolveLayers(file, catalog));
            const layers = layersOf.get(file);
            if (!layers.length) continue;
            if (isMine && c.date >= until) {
                totals.afterCutoff++;
                layers.forEach((id) => pool[id].afterCutoff++);
                continue;
            }
            if (!isMine && (c.date >= baselineUntil || isNoiseSubject(c.subject, noiseSubjects))) continue;
            if (status === 'R' && similarity === 100) continue;
            const first = firstAuthors.get(file);
            const kind = status === 'A' ? 'new' : first && !mineSet.has(first) ? 'others' : 'own';
            const sample = {
                sha: c.sha,
                date: c.date,
                author: c.author,
                subject: c.subject,
                file,
                paths: status === 'R' ? [from, pathAtCommit] : [pathAtCommit],
                kind
            };
            layers.forEach((id) => pool[id][isMine ? 'mine' : 'baseline'].push(sample));
        }
    }

    const diffs = new Map();
    const diffOf = ({ sha, paths }) => {
        const key = `${sha}:${paths.join(':')}`;
        if (!diffs.has(key))
            diffs.set(
                key,
                git(repo, [
                    'show',
                    '-M',
                    '-w',
                    '--format=',
                    '--unified=3',
                    sha,
                    '--',
                    ...paths
                ]).trim()
            );
        return diffs.get(key);
    };
    const pick = (cands, limit, countFormatOnly) => {
        const out = [];
        const perCommit = new Map();
        for (const c of rank(cands)) {
            if (out.length >= limit) break;
            if ((perCommit.get(c.sha) ?? 0) >= PER_COMMIT_LIMIT) continue;
            const diff = diffOf(c);
            if (!diff) {
                if (countFormatOnly) totals.formatOnly++;
                continue;
            }
            perCommit.set(c.sha, (perCommit.get(c.sha) ?? 0) + 1);
            const { paths, ...sample } = c;
            out.push({ ...sample, diff: truncateDiff(diff) });
        }
        return out;
    };

    const layers = Object.fromEntries(
        ids.map((id) => [
            id,
            {
                mine: pick(pool[id].mine, perLayer, true),
                baseline: pick(pool[id].baseline, baselinePerLayer, false),
                afterCutoff: pool[id].afterCutoff
            }
        ])
    );
    return { meta: { emails, since, until, repoCutoff, totals }, layers };
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const USAGE =
    'usage: collect.mjs --emails a@x,b@y --out <file> [--until YYYY-MM-DD|auto] [--since YYYY-MM-DD]';

const arg = (argv, name, fallback) => {
    const i = argv.indexOf(name);
    return i > -1 ? argv[i + 1] : fallback;
};

const main = (argv) => {
    const repo = arg(argv, '--repo', '.');
    const emails = (arg(argv, '--emails', '') ?? '').split(',').filter(Boolean);
    const out = arg(argv, '--out');
    let until = arg(argv, '--until', 'auto');
    const since = arg(argv, '--since', '0000-00-00');
    const perLayer = Number(arg(argv, '--per-layer', 12));
    const baselinePerLayer = Number(arg(argv, '--baseline-per-layer', 6));
    // dates compare as strings, so a malformed one silently selects the wrong range
    const problems = [
        !emails.length && '--emails missing',
        !out && '--out missing',
        until !== 'auto' && !DATE.test(until) && `--until format must be YYYY-MM-DD: ${until}`,
        !DATE.test(since) && `--since format must be YYYY-MM-DD: ${since}`,
        !(Number.isInteger(perLayer) && perLayer > 0) && '--per-layer must be a positive integer',
        !(Number.isInteger(baselinePerLayer) && baselinePerLayer > 0) &&
            '--baseline-per-layer must be a positive integer'
    ].filter(Boolean);
    if (problems.length) {
        console.error(`${problems.join('\n')}\n${USAGE}`);
        process.exitCode = 2;
        return;
    }
    if (until === 'auto')
        until =
            findAiCutoff({ repo, emails }) ??
            findAiCutoff({ repo }) ??
            new Date().toISOString().slice(0, 10);
    const style = styleConfig(repo);
    const ev = collect({
        repo,
        catalog: loadCatalog(arg(argv, '--catalog', path.join(style.layersDir, 'catalog.json'))),
        noiseSubjects: style.noiseSubjects,
        emails,
        until,
        since,
        perLayer,
        baselinePerLayer
    });
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(ev, null, 2));
    const perLayerCounts = Object.entries(ev.layers)
        .map(([id, l]) => `${id}=${l.mine.length}/${l.baseline.length}`)
        .join(' ');
    console.log(
        `until=${until} repoCutoff=${ev.meta.repoCutoff} totals=${JSON.stringify(ev.meta.totals)}`
    );
    console.log(`mine/baseline: ${perLayerCounts}`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        main(process.argv.slice(2));
    } catch (e) {
        console.error(e.message);
        process.exitCode = 2;
    }
}
