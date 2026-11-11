/** Reads AC, TC, scope and exclusion data from a tc-extract tc.md, using the locale's headings and field names. */
import { labelsFor } from '../artifact-labels.mjs';

const stripMarks = (text) => text.replace(/~~/g, '').replace(/\*\*/g, '').replace(/`/g, '').trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const cells = (line) =>
    line
        // `\|` inside a cell is a GFM escape, not a column boundary
        .split(/(?<!\\)\|/)
        .slice(1, -1)
        .map((c) => c.replace(/\\\|/g, '|').trim());

const parseScope = (lines, L) => {
    const states = ['e2e', 'unit', 'excluded', 'hold'].map((s) => [L[`tc.scope.${s}`], s]);
    const scope = new Map();
    for (const line of lines) {
        if (!/^\|\s*TC-\d/.test(line)) continue;
        const [first, second = ''] = cells(line);
        const state = states.find(([word]) => second.includes(word))?.[1];
        if (!state) continue;
        for (const n of first.match(/\d{2,}/g) ?? []) scope.set(`TC-${n}`, state);
    }
    return scope;
};

const parseAcExcluded = (text, L) => {
    const map = new Map();
    const section = text.split(new RegExp(`^## ${esc(L['tc.acExclusions'])}\\s*$`, 'm'))[1];
    if (!section) return map;
    for (const line of section.split('\n')) {
        if (/^#{1,3} /.test(line)) break;
        if (!/^\|\s*AC-\d+/.test(line)) continue;
        const [id, reason = ''] = cells(line);
        map.set(id, reason);
    }
    return map;
};

const parseTcBlock = (id, header, body, L) => {
    const field = (label) =>
        body.match(new RegExp(`^\\|\\s*\\*\\*${esc(label)}\\*\\*\\s*\\|\\s*(.*?)\\s*\\|`, 'm'))?.[1] ?? '';
    const specRaw = stripMarks(field(L['tc.field.specFile']));
    return {
        id,
        name: stripMarks(header),
        acIds: field(L['tc.relatedAc']).match(/AC-\d+/g) ?? [],
        e2eFit: stripMarks(field(L['tc.field.e2eSuitability'])),
        specFile: /\.spec\.js$/.test(specRaw) ? specRaw : null
    };
};

/**
 * Parse tc.md text; lines that do not match the format are skipped.
 * Returns { title, acs, tcs, scope: Map<tcId, state>, acExcluded: Map<acId, reason>, lookedFor: string[] };
 * `lookedFor` lists the literals searched so a locale mismatch can be reported instead of read as "empty".
 */
export function parseTcMd(text, { locale = 'en' } = {}) {
    const L = labelsFor(locale);
    const lines = text.split('\n');
    const title = stripMarks((lines.find((l) => l.startsWith('# ')) ?? '').slice(2)).replace(
        new RegExp(`\\s*${esc(L['tc.titleSuffix'])}$`, 'i'),
        ''
    );

    const acs = [];
    for (const line of lines) {
        const m = line.match(/^- \[[ xX]\]\s*(~~)?\*\*(AC-\d+)\*\*:?\s*(.*)$/);
        if (m) acs.push({ id: m[2], text: stripMarks(m[3]), cancelled: line.includes('~~') });
    }

    const tcs = [];
    const blocks = text.split(/^### (TC-\d+):\s*(.*)$/m);
    for (let i = 1; i < blocks.length; i += 3) {
        tcs.push(parseTcBlock(blocks[i], blocks[i + 1], blocks[i + 2] ?? '', L));
    }

    const lookedFor = [
        L['tc.titleSuffix'],
        L['tc.field.specFile'],
        L['tc.relatedAc'],
        L['tc.field.e2eSuitability'],
        L['tc.acExclusions']
    ];
    return { title, acs, tcs, scope: parseScope(lines, L), acExcluded: parseAcExcluded(text, L), lookedFor };
}

/** Returns 'e2e' | 'unit' | 'manual' | 'excluded' | 'hold'; the scope table wins, then E2E suitability (manual > e2e > unit). */
export function tcCategory(model, tc, { locale = 'en' } = {}) {
    const fromScope = model.scope.get(tc.id);
    if (fromScope) return fromScope;
    const L = labelsFor(locale);
    const fit = tc.e2eFit.toLowerCase();
    if (fit.includes(L['tc.e2eFit.manual'].toLowerCase())) return 'manual';
    if (fit.includes(L['tc.e2eFit.e2e'].toLowerCase())) return 'e2e';
    return 'unit';
}
