import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTcMd, tcCategory } from '../../kit/report/tc-md.mjs';
import { labelsFor } from '../../kit/artifact-labels.mjs';

const build = (locale) => {
    const L = labelsFor(locale);
    const row = (k, v) => `| **${L[k]}** | ${v} |`;
    return `# Catalog ${L['tc.titleSuffix']}

## ${L['tc.scope.e2e']} table

| TC | State | Reason |
| --- | --- | --- |
| TC-01·02 | **${L['tc.scope.unit']}** | pure |
| TC-04 | **${L['tc.scope.hold']}** | later |

## AC

- [ ] **AC-01**: list renders
- [ ] ~~**AC-02**: old behaviour~~

## ${L['tc.acExclusions']}

| AC | Reason |
|----|--------|
| AC-02 | a \\| b |

### TC-01: list renders

${row('tc.field.specFile', '`tc01-list.spec.js`')}
${row('tc.relatedAc', 'AC-01, AC-02')}
${row('tc.field.e2eSuitability', L['tc.e2eFit.e2e'])}

### TC-03: polish

${row('tc.field.specFile', L['tc.specFileNone'])}
${row('tc.relatedAc', 'AC-01')}
${row('tc.field.e2eSuitability', L['tc.e2eFit.manual'])}

### TC-05: logic

${row('tc.field.specFile', L['tc.specFileNone'])}
${row('tc.relatedAc', 'AC-01')}
${row('tc.field.e2eSuitability', L['tc.none'])}
`;
};

test('en and ko tc.md parse to the same model', () => {
    const en = parseTcMd(build('en'), { locale: 'en' });
    const ko = parseTcMd(build('ko'), { locale: 'ko' });
    // e2eFit and lookedFor carry the locale's own literals
    const strip = ({ lookedFor, tcs, ...rest }) => ({ ...rest, tcs: tcs.map(({ e2eFit, ...t }) => t) });
    const [a, b, enRest, koRest] = [en.lookedFor, ko.lookedFor, strip(en), strip(ko)];
    assert.deepEqual(enRest, koRest);
    assert.notDeepEqual(a, b);
    assert.equal(en.title, 'Catalog');
    assert.deepEqual(en.acs.map((x) => [x.id, x.cancelled]), [['AC-01', false], ['AC-02', true]]);
    assert.deepEqual(en.tcs[0], { id: 'TC-01', name: 'list renders', acIds: ['AC-01', 'AC-02'], e2eFit: 'e2e', specFile: 'tc01-list.spec.js' });
    assert.equal(ko.tcs[0].e2eFit, 'E2E 가능');
    assert.equal(en.tcs[1].specFile, null);
});

test('an escaped pipe in a cell is not a column boundary', () => {
    assert.equal(parseTcMd(build('en')).acExcluded.get('AC-02'), 'a | b');
});

test('category: scope table first, then manual > e2e > unit', () => {
    for (const locale of ['en', 'ko']) {
        const m = parseTcMd(build(locale), { locale });
        assert.deepEqual(m.tcs.map((tc) => tcCategory(m, tc, { locale })), ['unit', 'manual', 'unit']);
    }
    const m = parseTcMd(build('en'));
    assert.equal(m.scope.get('TC-04'), 'hold');
});

test('without the AC exclusions section or ACs, lists are empty and nothing throws', () => {
    const m = parseTcMd('# X Test Cases\n\nnothing here\n');
    assert.deepEqual([m.acs, m.tcs, m.acExcluded.size, m.scope.size], [[], [], 0, 0]);
});

test('a locale mismatch leaves fields empty but lookedFor names what was searched', () => {
    const m = parseTcMd(build('ko'), { locale: 'en' });
    assert.deepEqual(m.tcs[0].acIds, []);
    assert.ok(m.lookedFor.includes('Related AC'));
});

test('TCs without any AC lines or heading still parse: acs empty, all TCs kept', () => {
    const noAc = build('en').split('\n').filter((l) => !/^- \[|^## AC$/.test(l)).join('\n');
    const m = parseTcMd(noAc);
    assert.deepEqual(m.acs, []);
    assert.equal(m.tcs.length, 3);
});

test('category: e2e suitability without a spec file is still e2e', () => {
    const m = { scope: new Map() };
    assert.equal(tcCategory(m, { id: 'TC-09', e2eFit: 'e2e', specFile: null }), 'e2e');
});
