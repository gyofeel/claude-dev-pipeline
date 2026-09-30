#!/usr/bin/env node
/**
 * coverage-gate — AC → TC (→ Task) coverage check.
 *
 * Gates that count only output volume (N TCs, N UCPs) stay green when a whole AC evaporates.
 * This counts whether the requirements are covered.
 *
 * Modes
 *   G2         --prd <prd.md> --tc <tc.md>
 *              ACs in the PRD that no TC lists under **Related AC** → `uncovered` (blocks G2 approval).
 *   completion --prd <prd.md> --tc <tc.md> --plan <plan.md>
 *              one state per AC:
 *                implemented  a related TC appears as a `[TC-NN]` token inside some `### Task` section
 *                verifyOnly   a related TC is only mentioned bare in a task body, or its owner is `existing`
 *                split        a related TC's owner is `split <ISSUE-KEY>`
 *                missing      none of the above (including ACs with no TC)
 *                excluded     listed in the TC file's `## AC exclusions` table
 *
 * Input conventions
 *   PRD  : checklist lines containing `**AC-NN**`
 *   TC   : `### TC-NN:` sections with a `| **Related AC** | AC-01, AC-02 |` row;
 *          `## AC exclusions` table `| AC-NN | reason |`
 *   plan : `### Task N:` sections; `## Implementation owners` table `| TC-NN | Task N · split KEY · existing | reason |`
 *   (Korean labels 관련 AC / AC 범위 제외 / 구현 담당 / 분리 / 기구현 are accepted too.)
 *
 * Output: one JSON object on stdout. Exit code is always 0 — callers decide from uncovered / missing.
 */
import { readFileSync } from 'node:fs';

const parseArgs = (argv) => {
    const args = { prd: null, tc: null, plan: null };
    for (let i = 0; i < argv.length; i++) {
        const [k, v] = argv[i].includes('=') ? argv[i].split(/=(.*)/s) : [argv[i], argv[i + 1]];
        if (!['--prd', '--tc', '--plan'].includes(k)) continue;
        args[k.slice(2)] = v;
        if (!argv[i].includes('=')) i++;
    }
    return args;
};

const emit = (payload) => {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exit(0);
};

const ids = (text, prefix) => [...text.matchAll(new RegExp(`\\b${prefix}-(\\d+)\\b`, 'g'))].map((m) => `${prefix}-${m[1].padStart(2, '0')}`);
const byNum = (a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]);

/** body of the first `## <title>` section (up to the next `## `) matching any of the titles */
const section = (md, titles) => {
    for (const title of titles) {
        const m = new RegExp(`^## ${title}[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm').exec(md);
        if (m) return m[1];
    }
    return '';
};

const tableRows = (text) =>
    text
        .split('\n')
        .filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l))
        .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));

const readAcs = (prd) => [...new Set(prd.split('\n').filter((l) => /\*\*AC-\d+\*\*/.test(l)).flatMap((l) => ids(l.match(/\*\*AC-\d+\*\*/)[0], 'AC')))].sort(byNum);

const readTcs = (tc) => {
    const map = new Map();
    for (const block of tc.split(/^(?=### TC-\d+)/m).filter((b) => /^### TC-\d+/.test(b))) {
        const tcId = ids(block.split('\n')[0], 'TC')[0];
        const row = block.split('\n').find((l) => /^\|\s*\*\*(Related AC|관련 AC)\*\*/.test(l));
        map.set(tcId, row ? [...new Set(ids(row, 'AC'))] : []);
    }
    return map;
};

const readExcluded = (tc) => new Set(tableRows(section(tc, ['AC exclusions', 'AC 범위 제외'])).flatMap((r) => ids(r[0] ?? '', 'AC')));

const readPlan = (plan) => {
    const bracketed = new Set();
    const mentioned = new Set();
    const taskText = plan
        .split(/^(?=### Task \d+)/m)
        .filter((b) => /^### Task \d+/.test(b))
        .map((b) => b.split(/^## /m)[0]);
    for (const t of taskText) {
        for (const m of t.matchAll(/\[TC-(\d+)\]/g)) bracketed.add(`TC-${m[1].padStart(2, '0')}`);
        for (const id of ids(t, 'TC')) mentioned.add(id);
    }
    const owner = new Map();
    for (const r of tableRows(section(plan, ['Implementation owners', '구현 담당']))) {
        const tcId = ids(r[0] ?? '', 'TC')[0];
        if (!tcId) continue;
        const v = r[1] ?? '';
        owner.set(tcId, /split|분리/i.test(v) ? 'split' : /existing|기구현/i.test(v) ? 'verifyOnly' : /Task\s*\d+/i.test(v) ? 'implemented' : 'unassigned');
    }
    return { bracketed, mentioned, owner, taskCount: taskText.length };
};

const main = () => {
    const args = parseArgs(process.argv.slice(2));
    if (!args.prd || !args.tc) emit({ ok: false, error: '--prd <prd.md> --tc <tc.md> are required (add --plan for the completion mode)' });
    const prd = readFileSync(args.prd, 'utf8');
    const tc = readFileSync(args.tc, 'utf8');
    const acs = readAcs(prd);
    const tcs = readTcs(tc);
    const excluded = readExcluded(tc);
    if (acs.length === 0 || tcs.size === 0) {
        emit({ ok: false, error: `Parsed nothing — ${acs.length} ACs, ${tcs.size} TCs. Check the input conventions (silence is not success).` });
    }

    const tcsOf = new Map(acs.map((ac) => [ac, [...tcs].filter(([, a]) => a.includes(ac)).map(([id]) => id)]));
    const uncovered = acs.filter((ac) => tcsOf.get(ac).length === 0 && !excluded.has(ac));
    const unknownRefs = [...new Set([...tcs.values()].flat())].filter((ac) => !acs.includes(ac)).sort(byNum);
    const g2 = { acTotal: acs.length, tcTotal: tcs.size, uncovered, excluded: [...excluded].sort(byNum), unknownRefs };
    if (!args.plan) emit({ ok: true, mode: 'g2', ...g2 });

    const p = readPlan(readFileSync(args.plan, 'utf8'));
    const stateOfTc = (id) => {
        if (p.bracketed.has(id)) return 'implemented';
        const o = p.owner.get(id);
        if (o && o !== 'unassigned') return o;
        return p.mentioned.has(id) ? 'verifyOnly' : 'missing';
    };
    const RANK = { implemented: 0, split: 1, verifyOnly: 2, missing: 3 };
    const rows = acs.map((ac) => {
        if (excluded.has(ac)) return { ac, state: 'excluded', tcs: tcsOf.get(ac) };
        const list = tcsOf.get(ac).map((id) => ({ id, state: stateOfTc(id) }));
        // an AC takes the strongest owner among its TCs — one implementing task makes it implemented
        const state = list.length === 0 ? 'missing' : list.map((x) => x.state).sort((a, b) => RANK[a] - RANK[b])[0];
        return { ac, state, tcs: list };
    });
    const count = (s) => rows.filter((r) => r.state === s).length;
    emit({
        ok: true,
        mode: 'completion',
        ...g2,
        taskCount: p.taskCount,
        summary: { implemented: count('implemented'), verifyOnly: count('verifyOnly'), split: count('split'), excluded: count('excluded'), missing: count('missing') },
        missing: rows.filter((r) => r.state === 'missing').map((r) => r.ac),
        table: rows
    });
};

try {
    main();
} catch (e) {
    emit({ ok: false, error: String(e?.message ?? e) });
}
