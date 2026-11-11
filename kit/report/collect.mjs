/** Merges results.json, verdict.json attachments and tc.md into one report model. File IO lives in index.mjs. */
import path from 'node:path';
import { tcCategory } from './tc-md.mjs';
import { gateVerdict, DEFECT_KINDS, RERUN_KINDS } from './gate.mjs';
import { labels } from './labels.mjs';

const CP_TITLE_RE = /^(cp-\d+)/i;
const HEADER_LINES = 3;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tcFromFileName = (base, prefix) =>
    base.match(new RegExp(`^${escapeRe(prefix)}tc(\\d+)-(?!\\d)`))?.[1] ?? null;
// Playwright error messages carry terminal colour codes
const ANSI_RE = /\u001b\[[0-9;]*m/g;

const firstLines = (text, n) =>
    String(text ?? '')
        .split('\n')
        .slice(0, n)
        .join('\n');
const stepKey = (title) => (title.match(CP_TITLE_RE)?.[1] ?? title.split(':')[0]).toLowerCase();
const unique = (list) => [...new Set(list)];

const flattenTests = (results) => {
    const out = [];
    const walk = (suite, titles) => {
        const chain = [...titles, suite.title].filter(Boolean);
        for (const spec of suite.specs ?? []) {
            for (const test of spec.tests ?? []) {
                const result = test.results?.at(-1);
                if (result) out.push({ spec, test, result, titles: chain });
            }
        }
        for (const child of suite.suites ?? []) walk(child, chain);
    };
    for (const suite of results.suites ?? []) walk(suite, []);
    return out.sort((a, b) => a.spec.file.localeCompare(b.spec.file) || a.spec.line - b.spec.line);
};

const readVerdict = (result) => {
    const att = (result.attachments ?? []).find((a) => a.name === 'verdict.json');
    if (!att?.body) return null;
    try {
        return JSON.parse(Buffer.from(att.body, 'base64').toString('utf8'));
    } catch {
        return null;
    }
};

/** Sorts a failure by the next action it calls for; the check order is the priority. */
export function classifyFailure({ status, errors = [], steps = [], verdict = null }) {
    if (status === 'passed' || status === 'skipped') return null;
    const message = (errors[0]?.message ?? '').replace(ANSI_RE, '');
    const base = { message: firstLines(message, 4), location: errors[0]?.location ?? null };
    if (status === 'interrupted') return { ...base, kind: 'interrupted' };
    if (status === 'timedOut' || /Test timeout of \d+ms exceeded/.test(message)) {
        return { ...base, kind: 'timeout' };
    }
    const cpSteps = steps.filter((s) => CP_TITLE_RE.test(s.title));
    if (cpSteps.some((s) => s.error)) return { ...base, kind: 'assertion' };
    // Without any cp reached, the cause is the failed entry even if boot console errors also made the verdict FAIL
    if (cpSteps.length === 0) return { ...base, kind: 'setup' };
    if (verdict?.verdict === 'FAIL') return { ...base, kind: 'judge' };
    return { ...base, kind: 'other' };
}

/** Playwright steps are the source of truth; the verdict's cp list fills in the cps never reached. */
export function buildTimeline({
    steps = [],
    verdict = null,
    status,
    failure = null,
    durationMs = null,
    locale = 'en'
}) {
    const items = steps.map((s) => ({
        key: stepKey(s.title),
        title: s.title,
        state: s.error ? 'failed' : 'passed',
        durationMs: s.duration ?? null
    }));
    for (const c of verdict?.cp ?? []) {
        const key = c.id.toLowerCase();
        const found = items.find((it) => it.key === key);
        if (found) {
            found.desc = c.desc;
            if (c.actual !== undefined) found.actual = c.actual;
            if (status === 'passed' && !c.passed && found.state === 'passed') {
                // cp(…, { soft: true }) recorded an environment limit, not a missing mark
                found.state = c.soft ? 'soft' : 'unmarked';
                if (c.soft) found.softReason = c.softReason ?? '';
            }
            continue;
        }
        const state =
            status === 'skipped' ? 'not-run' : status === 'passed' ? 'unmarked' : 'unreached';
        items.push({ key, title: `${c.id}: ${c.desc}`, desc: c.desc, state, durationMs: null });
    }
    if (failure?.kind === 'setup' && !items.some((it) => it.state === 'failed')) {
        items.unshift({
            key: 'setup',
            title: labels(locale).setupStep,
            state: 'failed',
            durationMs
        });
    }
    return items;
}

const headerTcIds = (readHeader, relFile) =>
    unique(firstLines(readHeader?.(relFile) ?? '', HEADER_LINES).match(/TC-\d+/g) ?? []);

/** TC ids for the tests of one spec file in declaration order; null when they cannot be told. */
export function resolveTcIds(relFile, count, { tcMd = null, readHeader = null, specFilePrefix = '' } = {}) {
    const base = path.basename(relFile);
    if (count === 1) {
        const named = tcMd?.tcs.find((tc) => tc.specFile === base);
        if (named) return [named.id];
        const num = tcFromFileName(base, specFilePrefix);
        if (num) return [`TC-${num}`];
    }
    const ids = headerTcIds(readHeader, relFile);
    return ids.length === count ? ids : null;
}

const tcIdsInFile = (relFile, { tcMd, readHeader, specFilePrefix }) => {
    const base = path.basename(relFile);
    const named = (tcMd?.tcs ?? []).filter((tc) => tc.specFile === base).map((tc) => tc.id);
    const num = tcFromFileName(base, specFilePrefix);
    return unique([...named, ...(num ? [`TC-${num}`] : []), ...headerTcIds(readHeader, relFile)]);
};

const buildTest = ({ spec, test, result, titles = [] }, index, loops, locale) => {
    const verdict = readVerdict(result);
    const steps = (result.steps ?? []).map((s) => ({
        title: s.title,
        duration: s.duration,
        error: !!s.error
    }));
    const failure = classifyFailure({
        status: result.status,
        errors: result.errors,
        steps,
        verdict
    });
    const timeline = buildTimeline({
        steps,
        verdict,
        status: result.status,
        failure,
        durationMs: result.duration,
        locale
    });
    const annotations = [...(test.annotations ?? []), ...(result.annotations ?? [])];
    const loopInfo = loops[path.basename(spec.file)] ?? null;
    return {
        anchor: `t-${index}`,
        id: spec.id,
        file: spec.file,
        projectName: test.projectName ?? '',
        title: spec.title,
        describeTitles: titles,
        status: result.status,
        durationMs: result.duration ?? null,
        failure,
        timeline,
        skipReason: annotations.find((a) => a.type === 'skip')?.description ?? null,
        verdict: verdict?.verdict ?? null,
        summary: verdict?.summary ?? null,
        issues: verdict?.issues ?? [],
        excluded: verdict?.excluded ?? [],
        mockBoundary: verdict?.mockBoundary ?? null,
        mockHits: verdict?.mockHits ?? null,
        api: verdict?.api ?? null,
        runtime: verdict?.runtime ?? null,
        loops: loopInfo?.loops ?? null,
        lastFailure: loopInfo?.lastFailure ?? null,
        meta: {
            testName: verdict?.testName || spec.title,
            domain: verdict?.domain ?? '',
            testMode: verdict?.testMode ?? 'fixture',
            successCriteria: verdict?.successCriteria ?? ''
        }
    };
};

const normalize = (text) => String(text ?? '').replace(/\s+/g, '');

// Bundled specs the header and file name cannot place are matched by describe/test title against the tc.md TC names
const tcIdByTitle = (t, tcMd) => {
    const titles = new Set([t.title, ...t.describeTitles].map(normalize));
    return tcMd?.tcs.find((tc) => titles.has(normalize(tc.name)))?.id ?? null;
};

const mapTests = (tests, ctx) => {
    const byFile = new Map();
    for (const t of tests) byFile.set(t.file, [...(byFile.get(t.file) ?? []), t]);
    for (const [file, group] of byFile) {
        const ids = resolveTcIds(file, group.length, ctx);
        group.forEach((t, i) => {
            t.tcId = ids?.[i] ?? tcIdByTitle(t, ctx.tcMd);
            t.tcName = ctx.tcMd?.tcs.find((tc) => tc.id === t.tcId)?.name ?? null;
        });
    }
};

// A mock no test in the spec file ever hit would let every test in it pass on an unverified path
const markUnusedMocks = (tests) => {
    const byFile = new Map();
    for (const t of tests) {
        const key = `${t.projectName}\0${t.file}`;
        byFile.set(key, [...(byFile.get(key) ?? []), t]);
    }
    for (const group of byFile.values()) {
        const sums = new Map();
        for (const t of group) {
            for (const [pattern, n] of Object.entries(t.mockHits ?? {})) {
                sums.set(pattern, (sums.get(pattern) ?? 0) + n);
            }
        }
        const unusedMocks = [...sums].filter(([, n]) => n === 0).map(([pattern]) => pattern);
        if (unusedMocks.length === 0) continue;
        for (const t of group) {
            t.unusedMocks = unusedMocks;
            // Skipped tests too (the file's mocks are unverified); a real failure keeps its kind
            if (t.failure) continue;
            t.status = 'failed';
            t.failure = { message: '', location: null, kind: 'mock-unused' };
        }
    }
};

const isDefect = (t) => t.failure && DEFECT_KINDS.has(t.failure.kind);
const isRerun = (t) => t.failure && RERUN_KINDS.has(t.failure.kind);

const rowState = (mine) => {
    if (mine.some(isDefect)) return 'failed';
    if (mine.some(isRerun)) return 'unverified';
    if (mine.some((t) => t.status === 'skipped')) return 'skipped';
    return 'passed';
};

const buildAcs = (tcMd, tests, { dirTcIds, partial, locale }) => {
    const acs = [];
    const otherAcs = [];
    for (const ac of tcMd.acs) {
        if (tcMd.acExcluded.has(ac.id)) {
            otherAcs.push({
                ...ac,
                category: 'excluded',
                note: tcMd.acExcluded.get(ac.id),
                rows: []
            });
            continue;
        }
        if (ac.cancelled) {
            otherAcs.push({ ...ac, category: 'cancelled', rows: [] });
            continue;
        }
        const tcs = tcMd.tcs.filter((tc) => tc.acIds.includes(ac.id));
        const e2eTcs = tcs.filter((tc) => tcCategory(tcMd, tc, { locale }) === 'e2e');
        if (e2eTcs.length === 0) {
            const category = tcs.length ? tcCategory(tcMd, tcs[0], { locale }) : 'no-tc';
            otherAcs.push({ ...ac, category, rows: [] });
            continue;
        }
        const rows = e2eTcs.map((tc) => {
            const mine = tests.filter((t) => t.tcId === tc.id);
            if (mine.length === 0) {
                const exists = dirTcIds.has(tc.id);
                const state = !exists ? 'missing' : partial ? 'not-in-run' : 'unmapped';
                return {
                    tcId: tc.id,
                    tcName: tc.name,
                    state,
                    anchor: null,
                    cpPassed: 0,
                    cpTotal: 0
                };
            }
            const cps = mine.flatMap((t) => t.timeline.filter((s) => s.key.startsWith('cp-')));
            return {
                tcId: tc.id,
                tcName: tc.name,
                state: rowState(mine),
                anchor: mine[0].anchor,
                cpPassed: cps.filter((s) => s.state === 'passed').length,
                cpTotal: cps.length
            };
        });
        acs.push({ ...ac, category: 'e2e', rows });
    }
    return { acs, otherAcs };
};

// Signals that would otherwise leave a run looking clean: unreadable tc.md, load errors, specs off the kit fixture
const runReasons = ({ results, tests, tcMd, slug, missingTcMd, locale, artifactLocale }) => {
    const L = labels(locale);
    const out = [];
    const add = (level, text, anchor = null) => out.push({ level, text, anchor });
    const loadError = (results.errors ?? [])[0]?.message;
    if (loadError) add('defect', L.reason.loadError(firstLines(loadError.replace(ANSI_RE, ''), 1)));
    const tcs = tcMd?.tcs ?? [];
    if (tcs.length && tcs.every((tc) => !tc.acIds.length && !tc.specFile && !tc.e2eFit)) {
        add('defect', L.reason.tcMdUnread(tcMd.lookedFor, artifactLocale));
    }
    if (slug && !tcMd && missingTcMd) add('check', L.reason.noTcMd(slug, missingTcMd));
    for (const t of tests) {
        if (t.status !== 'skipped' && t.verdict == null) add('check', L.reason.noVerdict(t.label), t.anchor);
    }
    return out;
};

/** Builds the run model shared by the HTML and MD reports. */
export function collectRun({
    results,
    tcMd = null,
    loops = {},
    slug = null,
    tag,
    nn = '01',
    dirSpecFiles = [],
    readHeader = null,
    prevHref = null,
    now = new Date(),
    thumbsFor = () => new Map(),
    filtered = false,
    locale = 'en',
    artifactLocale = locale,
    missingTcMd = null,
    loopThreshold = 3,
    specFilePrefix = '',
    platformLabel = null
}) {
    const tests = flattenTests(results).map((entry, i) => {
        const t = buildTest(entry, i, loops, locale);
        const thumbs = thumbsFor(entry.result);
        for (const s of t.timeline) if (thumbs.has(s.key)) s.thumb = thumbs.get(s.key);
        return t;
    });
    // A filtered run may have left out the test that hits a mock
    if (!filtered) markUnusedMocks(tests);
    const ctx = { tcMd, readHeader, specFilePrefix };
    mapTests(tests, ctx);
    // Some spec titles already start with their TC id; do not print it twice
    for (const t of tests) {
        t.label = t.tcId && !new RegExp(`^${t.tcId}(?!\\d)`).test(t.title) ? `${t.tcId} ${t.title}` : t.title;
    }

    const ranFiles = unique(tests.map((t) => t.file));
    const total = dirSpecFiles.length || ranFiles.length;
    const partial =
        filtered || (dirSpecFiles.length > 0 && ranFiles.length < dirSpecFiles.length)
            ? { ran: ranFiles.length, total, ...(filtered ? { filtered: true } : {}) }
            : null;
    const dirTcIds = new Set(dirSpecFiles.flatMap((f) => tcIdsInFile(f, ctx)));

    const hasTcMd = !!tcMd;

    const { acs, otherAcs } = hasTcMd
        ? buildAcs(tcMd, tests, { dirTcIds, partial, locale: artifactLocale })
        : { acs: [], otherAcs: [] };
    const counts = {
        passed: tests.filter((t) => t.status === 'passed').length,
        failed: tests.filter((t) => ['failed', 'timedOut', 'interrupted'].includes(t.status))
            .length,
        skipped: tests.filter((t) => t.status === 'skipped').length
    };

    const model = {
        title: tcMd?.title || slug || tag,
        slug,
        tag,
        runLabel: labels(locale).runLabel(Number(nn)),
        generatedAt: now.toISOString(),
        prevHref,
        partial,
        hasTcMd,
        counts,
        tests,
        acs,
        otherAcs,
        gate: null,
        extraReasons: runReasons({ results, tests, tcMd, slug, missingTcMd, locale, artifactLocale }),
        locale,
        artifactLocale,
        platformLabel,
        loopThreshold
    };
    return finalizeRun(model);
}

/** Computes the attention flags and the gate. */
export function finalizeRun(model) {
    const { tests, acs, hasTcMd, partial } = model;
    for (const t of tests) {
        t.attention =
            t.status !== 'passed' ||
            t.timeline.some((s) => s.state === 'unmarked') ||
            (t.loops ?? 0) >= model.loopThreshold ||
            (hasTcMd && !t.tcId);
    }
    model.gate = gateVerdict({
        tests,
        acs,
        hasTcMd,
        partial,
        loopThreshold: model.loopThreshold,
        locale: model.locale,
        artifactLocale: model.artifactLocale,
        extra: model.extraReasons ?? []
    });
    return model;
}
