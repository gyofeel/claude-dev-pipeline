import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARTIFACT_LABELS, labelsFor } from '../../kit/artifact-labels.mjs';

test('en and ko have the same keys', () => {
    assert.deepEqual(Object.keys(ARTIFACT_LABELS.en).sort(), Object.keys(ARTIFACT_LABELS.ko).sort());
});

test('every value is a non-empty string', () => {
    for (const [locale, labels] of Object.entries(ARTIFACT_LABELS))
        for (const [key, value] of Object.entries(labels))
            assert.ok(typeof value === 'string' && value.trim(), `${locale}:${key}`);
});

test('minimum keys exist', () => {
    const keys = ['prd.scope', 'prd.acHeading', 'prd.openQuestions', 'prd.provenance.stated',
        'prd.provenance.inferred', 'tc.relatedAc', 'tc.owner', 'tc.owner.implement', 'tc.owner.split',
        'tc.owner.existing', 'tc.acExclusions', 'tc.surface', 'tc.e2eBasis', 'tc.manualItems',
        'plan.task', 'needsCheck'];
    for (const k of keys) assert.ok(k in ARTIFACT_LABELS.en, k);
});

test('labelsFor falls back to en', () => {
    assert.equal(labelsFor('fr'), ARTIFACT_LABELS.en);
    assert.equal(labelsFor('ko'), ARTIFACT_LABELS.ko);
    assert.equal(labelsFor(undefined), ARTIFACT_LABELS.en);
});

test('labelsFor ignores inherited property names', () => {
    assert.equal(labelsFor('constructor'), ARTIFACT_LABELS.en);
    assert.equal(labelsFor('__proto__'), ARTIFACT_LABELS.en);
});
