#!/usr/bin/env node
/**
 * coverage-gate — AC → TC (→ Task) coverage check, plus structural lint of the PRD / TC file / plan.
 *
 * Gates that count only output volume (N TCs, N UCPs) stay green when a whole AC evaporates.
 * This counts whether the requirements are covered.
 *
 * Modes
 *   PRD        --prd <prd.md> [--lint]   (G1, before the PRD is saved)
 *   G2         --prd <prd.md> --tc <tc.md>
 *              ACs in the PRD that no TC lists under its related-AC row → `uncovered` (blocks G2 approval).
 *   completion --prd <prd.md> --tc <tc.md> --plan <plan.md>
 *              one state per AC:
 *                implemented  a related TC appears as a `[TC-NN]` token inside some `### Task` section
 *                verifyOnly   a related TC is only mentioned bare in a task body, or its owner is `existing`
 *                split        a related TC's owner is `split <ISSUE-KEY>`
 *                missing      none of the above (including ACs with no TC)
 *                excluded     listed in the TC file's AC-exclusions table
 *
 * Every heading, field name and fixed value comes from kit/artifact-labels.mjs for `config.locale`.
 * Input conventions (en labels shown)
 *   PRD  : `**AC-NN**` checklist lines under `## Acceptance Criteria`
 *   TC   : `### TC-NN:` sections with a `| **Related AC** | AC-01, AC-02 |` row;
 *          `## AC exclusions` table `| AC-NN | reason |`;
 *          `## Implementation owners` table `| TC-NN | implement · split KEY · existing | reason |`
 *   plan : `### Task N:` sections (several owners as `[TC-03][TC-04]`); its `## Implementation owners`
 *          table overrides the TC file's decisions
 *
 * --lint adds structural checks as `lint.errors` / `lint.warnings`:
 *   PRD  : required slots · unhandled rows of the spec I/F cross-check · endpoint sources ·
 *          inline sources in AC lines · publishing source
 *   TC   : E2E basis · owners of E2E / manual TCs in new-implementation mode · the sibling-convention
 *          column of the implementation surface · entry branches (fires only on `isFrom*` identifiers in the
 *          modified files) · flag side effects · field interpretation · TCs without a related-AC row
 *   plan : missing unit-TC tasks · missing E2E-TC owners · `##` sections after the first Task (brief leak) ·
 *          red-gate command arguments · `[TC-NN, TC-MM]` notation · Files paths exist (as of plan review)
 *
 * Output: one JSON object on stdout. Exit code is always 0 — callers decide from uncovered / missing / lint.errors.
 * Zero ACs, TCs, related-AC rows or source files is an error (`no-ac` / `no-tc` / `no-related-ac` /
 * `no-targets`), never a pass. With --lint a failed run still carries its errors in `lint.errors`.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { labelsFor } from '../kit/artifact-labels.mjs';
import { loadConfig } from './config-load.mjs';
import { findConsumers } from './field-consumers.mjs';
import { findFlagEffects } from './flag-effects.mjs';
import { listSourceFiles } from './lib/source-scan.mjs';

const parseArgs = (argv) => {
    const args = { prd: null, tc: null, plan: null, lint: argv.includes('--lint') };
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

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ids = (text, prefix) =>
    [...text.matchAll(new RegExp(`\\b${prefix}-(\\d+)\\b`, 'g'))].map((m) => `${prefix}-${m[1].padStart(2, '0')}`);
const byNum = (a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]);

/** body of the `## <title>…` section (title matched as a prefix, up to the next `## `) */
const section = (md, title) =>
    (new RegExp(`^## ${esc(title)}[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm').exec(md) ?? [])[1] ?? '';
/** body of the `### <title>…` sub-section (up to the next `### `) */
const subsection = (md, title) =>
    (new RegExp(`^### ${esc(title)}[^\\n]*\\n([\\s\\S]*?)(?=^### |(?![\\s\\S]))`, 'm').exec(md) ?? [])[1] ?? '';

const tableRows = (text) =>
    text
        .split('\n')
        .filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l))
        .map((l) =>
            l
                // `\|` inside a cell is a GFM escape, not a column boundary
                .split(/(?<!\\)\|/)
                .slice(1, -1)
                .map((c) => c.replace(/\\\|/g, '|').trim())
        );

const noAc = (L, locale) => `no-ac: no **AC-NN** line under \`## ${L['prd.acHeading']}\` (locale ${locale})`;
const noRelatedAc = (L, locale, id) => `no-related-ac: ${id} has no **${L['tc.relatedAc']}** row (locale ${locale})`;
const NO_TC = 'no-tc: no `### TC-NN` section was read — check the input conventions (silence is not success)';

export const readAcs = (prd, L) =>
    [
        ...new Set(
            section(prd, L['prd.acHeading'])
                .split('\n')
                .filter((l) => /\*\*AC-\d+\*\*/.test(l))
                .flatMap((l) => ids(l.match(/\*\*AC-\d+\*\*/)[0], 'AC'))
        )
    ].sort(byNum);

const fieldRe = (name) => new RegExp(`^\\|\\s*\\*\\*${esc(name)}\\*\\*`);
const tcSections = (tc) => tc.split(/^(?=### TC-\d+)/m).filter((b) => /^### TC-\d+/.test(b));

export const readTcs = (tc, L) => {
    const map = new Map();
    for (const block of tcSections(tc)) {
        const row = block.split('\n').find((l) => fieldRe(L['tc.relatedAc']).test(l));
        map.set(ids(block.split('\n')[0], 'TC')[0], row ? [...new Set(ids(row, 'AC'))] : []);
    }
    return map;
};

const readExcluded = (tc, L) =>
    new Set(tableRows(section(tc, L['tc.acExclusions'])).flatMap((r) => ids(r[0] ?? '', 'AC')));

const tcBlocks = (tc, L) =>
    tcSections(tc).map((b) => {
        const field = (name) => {
            const row = b.split('\n').find((l) => fieldRe(name).test(l));
            return row ? (row.split('|')[2] ?? '').trim() : null;
        };
        return {
            id: ids(b.split('\n')[0], 'TC')[0],
            relatedAc: field(L['tc.relatedAc']),
            unit: field(L['tc.field.unitTarget']),
            e2e: field(L['tc.field.e2eSuitability']),
            e2eReason: field(L['tc.e2eBasis'])
        };
    });

// `existing` is checked before `implement`: the ko value 기구현 contains 구현
const ownerOf = (v, L) =>
    v.includes(L['tc.owner.split'])
        ? 'split'
        : v.includes(L['tc.owner.existing'])
          ? 'verifyOnly'
          : new RegExp(`${esc(L['plan.task'])}\\s*\\d+`).test(v)
            ? 'implemented'
            : v.includes(L['tc.owner.implement'])
              ? 'toImplement'
              : 'unassigned';

const readOwners = (md, title, L) => {
    const owner = new Map();
    for (const r of tableRows(section(md, title))) {
        const tcId = ids(r[0] ?? '', 'TC')[0];
        if (tcId) owner.set(tcId, ownerOf(r[1] ?? '', L));
    }
    return owner;
};

const isUnitTc = (t, L) => Boolean(t.unit) && !t.unit.includes(L['tc.unitNone']);

const lintPrd = (prd, acs, L, locale) => {
    const errors = [];
    const warnings = [];
    const unclear = (s) => s.includes('[') || s.includes(L['prd.unclear']);
    const title = (/^# (.+)$/m.exec(prd) ?? [])[1] ?? '';
    if (!title || unclear(title)) errors.push('Feature name (# title) is empty or unclear');
    const scopeField = `> **${L['prd.scope']}**:`;
    const scope = (new RegExp(`^${esc(scopeField)}\\s*(.*)$`, 'm').exec(prd) ?? [])[1] ?? '';
    // a dynamic route segment (/app/[version]/...) is a real path, not an unfilled placeholder
    if (!scope.trim() || unclear(scope.replace(/\/\[[^\]\s/]+\]/g, '')))
        errors.push(`\`${scopeField}\` (target screen) is empty or unclear`);
    if (acs.length === 0) errors.push(noAc(L, locale));
    const inlineSource = new RegExp(L['prd.inlineSourcePattern']);
    for (const l of section(prd, L['prd.acHeading']).split('\n').filter((x) => /\*\*AC-\d+\*\*/.test(x))) {
        if (l.includes(L['prd.unclear'])) errors.push(`AC is unclear: ${l.trim()}`);
        if (inlineSource.test(l))
            warnings.push(`AC line carries its source — move it to the ${L['prd.acProvenance']} table: ${l.trim()}`);
    }
    const server = section(prd, L['prd.serverInterface']);
    const matchRows = tableRows(subsection(server, L['prd.specCrossCheck'])).slice(1);
    for (const [id, , req, handling] of matchRows)
        if ((!req || req === '—') && (!handling || handling === '—'))
            errors.push(`Spec I/F is in neither the requirements nor the handling column: ${id}`);
    if (matchRows.length)
        for (const r of tableRows(subsection(server, L['prd.endpoints'])).slice(1))
            if (!r[3] || r[3] === '—') errors.push(`Spec input, but the endpoint has no source: ${r[1] ?? ''}`);
    if (
        new RegExp(`^## ${esc(L['prd.uiScenarios'])}`, 'm').test(prd) &&
        !new RegExp(`^### ${esc(L['prd.publishingSource'])}`, 'm').test(prd)
    )
        warnings.push(
            `${L['prd.uiScenarios']} exists but there is no ${L['prd.publishingSource']} table — confirm there really is none`
        );
    return { errors, warnings };
};

const noTargets = (config, check) =>
    `no-targets: no production source files under source.roots (${config.source.roots.join(', ')}) — the ## ${check} check cannot run; set source.roots`;

// When a new branch takes an input that existing code splits into segments, each segment the followed
// interpreter reads must be listed as used or dropped. Taking only some (the id but not the code) makes
// the same input mean different things per path
const lintFieldReads = (tc, prd, root, config, L, sources) => {
    const fields = [
        ...new Set(
            [
                ...`${section(prd, L['prd.requirements'])}${section(prd, L['prd.acHeading'])}`.matchAll(
                    /`([a-z][a-z0-9]*(?:_[a-z0-9]+)+|[a-z]+[A-Z]\w*)`/g
                )
            ].map((m) => m[1])
        )
    ];
    if (!fields.length) return [];
    const fi = L['tc.fieldInterp'];
    const consumers = findConsumers(fields, root, sources());
    if (consumers.error) return [noTargets(config, fi)];
    // an interpreter that does not split (JSON.parse etc.) is still accepted as a followed-interpreter name
    const parsers = consumers.flatMap((c) => c.parsers.map((p) => ({ ...p, field: c.field })));
    const split = parsers.filter((p) => p.segments.length);
    const errors = [];
    const names = ['field', 'newBranch', 'follows', 'writes', 'drops'].map((k) => L[`tc.fieldInterp.${k}`]);
    const [, , follows, writes, drops] = names;
    const [header, ...rows] = tableRows(section(tc, fi));
    const cols = names.map((name) => header?.findIndex((h) => h.includes(name)) ?? -1);
    for (const field of new Set(split.map((p) => p.field)))
        if (!rows.some((r) => r[cols[0]]?.includes(field))) {
            const where = [
                ...new Set(
                    split
                        .filter((p) => p.field === field)
                        .map((p) => `${p.fn ?? p.file} ${p.segments[0].delimiter}${p.segments.map((x) => x.index).join('')}`)
                )
            ].join(' · ');
            errors.push(
                `${field} is read segment by segment by existing code (${where}) — in the ## ${fi} table, give each new branch its ${follows}, ${writes} and ${drops}`
            );
        }
    for (const r of rows) {
        const [field, branch, follow, used, dropped] = cols.map((c) => r[c] ?? '');
        const followed = parsers.filter(
            (p) =>
                field.includes(p.field) &&
                // a name can be the prefix of another (parseUrl · parseUrlForTarget), so match whole words;
                // the file path is used only for interpreters without a function name
                (p.fn
                    ? new RegExp(`(^|[^\\w$#])${p.fn.replace(/[$#]/g, '\\$&')}(?![\\w$])`).test(follow)
                    : follow.includes(p.file))
        );
        if (!followed.length && !/—/.test(follow))
            errors.push(
                `## ${fi} ${branch}: ${follows} is not an existing interpreter name — if it follows none, write \`${L['tc.none']} — <reason>\``
            );
        for (const p of followed)
            for (const s of p.segments)
                if (!used.includes(s.index) && !dropped.includes(s.index))
                    errors.push(
                        `## ${fi} ${branch}: ${p.fn ?? p.file} reads slot ${s.index} of ${p.field} (${p.file}:${s.line} ${s.text}) — put it in ${writes} or ${drops}`
                    );
        if (/\[-?\d+\]/.test(dropped) && !/—/.test(dropped))
            errors.push(`## ${fi} ${branch}: ${drops} has no reason (\`[n] — <reason>\`)`);
    }
    return errors;
};

const lintTc = (tc, prd, root, config, L, locale) => {
    const errors = [];
    // listed once, and only when a check needs them
    let listed = null;
    const sources = () => (listed ??= listSourceFiles(root, config).files);
    const newMode = new RegExp(`^> \\*\\*${esc(L['tc.implMode'])}\\*\\*:\\s*${esc(L['tc.implMode.new'])}`, 'm').test(tc);
    const owners = readOwners(tc, L['tc.owner'], L);
    for (const t of tcBlocks(tc, L)) {
        if (t.relatedAc === null) errors.push(noRelatedAc(L, locale, t.id));
        if ((t.e2e ?? '').includes(L['tc.e2eFit.e2e']) && (!t.e2eReason || t.e2eReason === '—'))
            errors.push(`${t.id}: ${L['tc.field.e2eSuitability']} is ${L['tc.e2eFit.e2e']} but ${L['tc.e2eBasis']} is empty`);
        if (newMode && !isUnitTc(t, L) && !owners.has(t.id))
            errors.push(`${t.id}: a TC without a unit test has no owner (## ${L['tc.owner']})`);
    }
    // checking that the whole URL or query merely contains the value also passes the same value carried by
    // another parameter, and misses wrong landings like /menu/undefined
    const urlCp = new RegExp(
        `^\\|\\s*(CP-\\d+)\\s*\\|\\s*${esc(L['tc.cp.url'])}\\s*\\|\\s*\`?(href|search)\`?\\s*\\|\\s*\`?(?:hasText|toContain)\\((.*?)\\)`
    );
    let tcId = null;
    for (const line of tc.split('\n')) {
        tcId = (/^### (TC-\d+)/.exec(line) ?? [])[1] ?? tcId;
        const cp = urlCp.exec(line);
        if (!cp) continue;
        if (cp[2] === 'href')
            errors.push(`${tcId} ${cp[1]}: URL href contains-assertion — assert the destination with pathname or search`);
        else if (!cp[3].includes('='))
            errors.push(
                `${tcId} ${cp[1]}: URL search asserts only a value — include the parameter name (key=value) or assert the pathname`
            );
    }
    // a branch added to an existing file must not drop what its sibling branches do in common
    const surface = L['tc.surface'];
    const sib = L['tc.surface.siblingColumn'];
    const isNew = (cell) => cell.includes(L['tc.surface.new']);
    const [header, ...rows] = tableRows(section(tc, surface));
    if (header) {
        const col = header.indexOf(sib);
        const empty = ['', '—', '-', `(${L['tc.none']})`];
        if (col < 0) errors.push(`## ${surface} has no ${sib} column`);
        else
            for (const r of rows)
                if (!isNew(r[0]) && empty.includes(r[col] ?? ''))
                    errors.push(`## ${surface} ${r[0]}: modifies an existing file but ${sib} is empty`);
        const exts = config.source.extensions.map((x) => esc(x.replace(/^\./, ''))).join('|');
        const fileRe = new RegExp(`([\\w./[\\]-]+\\.(?:m?js|${exts}))(?![\\w])`);
        const listed = rows
            .filter((r) => !isNew(r[0]))
            .map((r) => fileRe.exec(r[0])?.[1])
            .filter(Boolean);
        const existing = listed.filter((f) => existsSync(path.join(root, f)));
        for (const f of listed.filter((x) => !existing.includes(x)))
            errors.push(`${surface} ${f}: modifies an existing file that does not exist — mark it ${L['tc.surface.new']} or fix the path`);
        const entry = L['tc.entryBranches'];
        const fx = L['tc.flagEffects'];
        if (listed.length && !existing.length)
            errors.push(
                `no-targets: no file listed for modification exists under the project root (${listed.join(', ')}) — the ## ${entry} and ## ${fx} checks cannot run; fix the paths`
            );
        // when sibling branches split on the entry path (isFromX flags), each new branch records how it
        // handles that; handing the landing to other code that reads the same input silently drops it
        const entryTable = section(tc, entry);
        for (const file of existing)
            for (const flag of new Set(readFileSync(path.join(root, file), 'utf8').match(/\bisFrom[A-Z]\w*/g) ?? []))
                if (!entryTable.includes(flag))
                    errors.push(
                        `${file}: sibling branches split the entry path on ${flag} — add ${flag} handling for each new branch to the ## ${entry} table`
                    );
        // keeping a shared flag (a guard) on longer also keeps other files' writes gated on it running
        // longer; restoring the flag alone leaves the state those writes changed
        const effects = existing.length ? findFlagEffects(existing, root, sources()) : [];
        if (effects.error) errors.push(noTargets(config, fx));
        const effectRows = tableRows(section(tc, fx));
        for (const e of effects.error ? [] : effects) {
            const flagRows = effectRows.filter((r) => r.some((c) => c.includes(e.flag)));
            for (const w of e.writes)
                if (!flagRows.some((r) => r.some((c) => c.includes(w))))
                    errors.push(
                        `${e.file}:${e.line} writes ${w} while ${e.flag} is true — in the ## ${fx} table, state whether this design changes how long ${e.flag} stays true and how ${w} is handled`
                    );
        }
    }
    errors.push(...lintFieldReads(tc, prd, root, config, L, sources));
    return { errors, warnings: [] };
};

/** Tasks with passing ledger evidence — a finished task's Create target existing is expected */
const tasksWithEvidence = (planPath) => {
    const ledger = path.join(path.dirname(planPath), 'red-evidence.jsonl');
    if (!existsSync(ledger)) return new Set();
    const done = new Set();
    for (const line of readFileSync(ledger, 'utf8').split('\n')) {
        try {
            const e = JSON.parse(line);
            if (e.ok) done.add(Number(e.task));
        } catch {
            /* skip blank or broken lines */
        }
    }
    return done;
};

const taskRe = (L) => new RegExp(`^### ${esc(L['plan.task'])} (\\d+)`);

const readPlan = (plan, L) => {
    const bracketed = new Set();
    const mentioned = new Set();
    const taskText = plan
        .split(new RegExp(`^(?=### ${esc(L['plan.task'])} \\d+)`, 'm'))
        .filter((b) => taskRe(L).test(b))
        .map((b) => b.split(/^## /m)[0]);
    for (const t of taskText) {
        for (const m of t.matchAll(/\[TC-(\d+)\]/g)) bracketed.add(`TC-${m[1].padStart(2, '0')}`);
        for (const id of ids(t, 'TC')) mentioned.add(id);
    }
    return { bracketed, mentioned, owner: readOwners(plan, L['plan.owners'], L), taskCount: taskText.length };
};

const lintPlan = (plan, tcList, owners, root, L, doneTasks = new Set()) => {
    const errors = [];
    let inFence = false;
    let seenTask = false;
    let inTask = false;
    let taskNo = null;
    const cmds = [];
    let cmd = null;
    for (const line of plan.split('\n')) {
        if (/^```/.test(line)) inFence = !inFence;
        const task = inFence ? null : taskRe(L).exec(line);
        if (task) {
            seenTask = inTask = true;
            taskNo = Number(task[1]);
        } else if (!inFence && /^## /.test(line)) {
            inTask = false;
            if (seenTask)
                errors.push(
                    `section after the first Task: \`${line.trim()}\` — it leaks into the previous task brief. Move it before the first Task`
                );
        }
        if (!inTask) continue;
        if (cmd !== null) cmd += ` ${line}`;
        else if (/red-gate\.mjs/.test(line) && !/--all/.test(line)) cmd = line;
        if (cmd !== null && !/\\\s*$/.test(line)) {
            cmds.push(cmd);
            cmd = null;
        }
        if (/\[TC-\d+\s*,/.test(line))
            errors.push(`\`[TC-NN, TC-MM]\` is not counted as ownership — write [TC-NN][TC-MM]: ${line.trim()}`);
        const files = /^\s*-\s*(Create|Modify):\s*`?([^`\s]+)`?/.exec(line);
        if (files && !inFence) {
            const exists = existsSync(path.join(root, files[2].replace(/:\d+(-\d+)?$/, '')));
            if (files[1] === 'Modify' && !exists) errors.push(`Modify target does not exist: ${files[2]}`);
            if (files[1] === 'Create' && exists && !doneTasks.has(taskNo))
                errors.push(`Create target already exists: ${files[2]}`);
        }
    }
    for (const c of cmds) {
        const miss = ['--plan', '--task', '--file', '--test'].filter((f) => !c.includes(f));
        if (miss.length) errors.push(`red-gate command is missing ${miss.join(' ')}: ${c.trim().slice(0, 120)}`);
        const file = /--file[ =]"?([^"\s]+)/.exec(c)?.[1];
        if (file && !/^(\/|\$PWD\/|\$\(pwd\)\/)/.test(file)) errors.push(`red-gate --file is not an absolute path: ${file}`);
    }
    const { bracketed } = readPlan(plan, L);
    for (const t of tcList) {
        if (bracketed.has(t.id)) continue;
        if (isUnitTc(t, L)) errors.push(`${t.id}: unit TC has no owning task ([${t.id}])`);
        else if (!['split', 'verifyOnly'].includes(owners.get(t.id)))
            errors.push(
                `${t.id}: a TC without a unit test has no owning task and no ${L['tc.owner.split']} / ${L['tc.owner.existing']} decision`
            );
    }
    if (tcList.length === 0) errors.push(NO_TC);
    return { errors, warnings: [] };
};

const main = () => {
    const args = parseArgs(process.argv.slice(2));
    if (!args.prd) emit({ ok: false, error: '--prd <prd.md> is required (add --tc for G2, --plan for completion)' });
    // with --lint the failure also goes to lint.errors, so a caller reading only those never sees "clean"
    const fail = (errors) =>
        emit({ ok: false, error: errors.join('; '), ...(args.lint ? { lint: { errors, warnings: [] } } : {}) });
    const cfg = loadConfig();
    if (!cfg.ok) fail(cfg.errors);
    const { root, resolved: config } = cfg;
    // <worksDir>/… paths are repo-relative, the same base red-gate uses for the plan and its ledger
    for (const k of ['prd', 'tc', 'plan']) if (args[k]) args[k] = path.resolve(root, args[k]);
    const { locale } = config;
    const L = labelsFor(locale);
    const prd = readFileSync(args.prd, 'utf8');
    const acs = readAcs(prd, L);
    const prdLint = args.lint ? lintPrd(prd, acs, L, locale) : null;
    if (!args.tc) {
        if (!args.lint && acs.length === 0) fail([noAc(L, locale)]);
        emit({ ok: true, mode: 'prd', acTotal: acs.length, lint: prdLint });
    }
    const tc = readFileSync(args.tc, 'utf8');
    const tcs = readTcs(tc, L);
    const excluded = readExcluded(tc, L);
    if (acs.length === 0 || tcs.size === 0)
        fail([acs.length ? null : noAc(L, locale), tcs.size ? null : NO_TC].filter(Boolean));
    // a TC file in the other locale has TC sections but no row this locale can read
    const blocks = tcBlocks(tc, L);
    const noRel = blocks.filter((t) => t.relatedAc === null);
    if (noRel.length === blocks.length)
        fail([
            `no-related-ac: no TC has a **${L['tc.relatedAc']}** row (locale ${locale}) — ${noRel.map((t) => t.id).join(', ')}`
        ]);

    const tcsOf = new Map(acs.map((ac) => [ac, [...tcs].filter(([, a]) => a.includes(ac)).map(([id]) => id)]));
    const uncovered = acs.filter((ac) => tcsOf.get(ac).length === 0 && !excluded.has(ac));
    const unknownRefs = [...new Set([...tcs.values()].flat())].filter((ac) => !acs.includes(ac)).sort(byNum);
    const g2 = { acTotal: acs.length, tcTotal: tcs.size, uncovered, excluded: [...excluded].sort(byNum), unknownRefs };
    const merge = (...ls) => ({
        errors: ls.flatMap((l) => l?.errors ?? []),
        warnings: ls.flatMap((l) => l?.warnings ?? [])
    });
    if (!args.plan)
        emit({ ok: true, mode: 'g2', ...g2, lint: args.lint ? merge(prdLint, lintTc(tc, prd, root, config, L, locale)) : null });

    const planText = readFileSync(args.plan, 'utf8');
    const p = readPlan(planText, L);
    // a plan owners table overrides the TC file's G2 decisions
    p.owner = new Map([...readOwners(tc, L['tc.owner'], L), ...p.owner]);
    const stateOfTc = (id) => {
        if (p.bracketed.has(id)) return 'implemented';
        const o = p.owner.get(id);
        if (o && !['unassigned', 'toImplement'].includes(o)) return o;
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
        summary: {
            implemented: count('implemented'),
            verifyOnly: count('verifyOnly'),
            split: count('split'),
            excluded: count('excluded'),
            missing: count('missing')
        },
        missing: rows.filter((r) => r.state === 'missing').map((r) => r.ac),
        table: rows,
        lint: args.lint ? lintPlan(planText, tcBlocks(tc, L), p.owner, root, L, tasksWithEvidence(args.plan)) : null
    });
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    try {
        main();
    } catch (e) {
        emit({ ok: false, error: String(e?.message ?? e) });
    }
}
