/** Advisory conclusion for a whole feature run. Rules: e2e-report-redesign spec 2-5 (minus AI coverage gaps). People make the final call. */
import { labels } from './labels.mjs';
import { labelsFor } from '../artifact-labels.mjs';

export const DEFECT_KINDS = new Set(['assertion', 'judge', 'mock-unused', 'other']);
export const RERUN_KINDS = new Set(['setup', 'timeout', 'interrupted']);
// null is a legitimate response value, so only undefined and NaN count as a missing value
const MISSING_VALUE = /(^|[^A-Za-z0-9_])(undefined|NaN)($|[^A-Za-z0-9_])/;

/** Derives the conclusion and its reasons from the test and AC lists. The final approval is a person's. */
export function gateVerdict({
    tests,
    acs,
    hasTcMd,
    partial,
    loopThreshold = 3,
    locale = 'en',
    artifactLocale = locale,
    extra = []
}) {
    const L = labels(locale);
    // cp descriptions come from tc.md, so the marker is in the artifact language
    const needsCheck = labelsFor(artifactLocale).needsCheck;
    const reasons = [];
    const add = (level, text, anchor = null) => reasons.push({ level, text, anchor });
    const isDataAbsent = (t) => /^DATA:/.test(t.lastFailure ?? '');

    for (const t of tests) {
        if (!t.failure || !DEFECT_KINDS.has(t.failure.kind)) continue;
        // A failure the runtime loop traced to absent API data is not an implementation defect
        if (isDataAbsent(t) && t.failure.kind !== 'mock-unused') {
            const why = t.lastFailure.slice(5).trim();
            add('check', `${t.label} — ${L.gate.testDataAbsent}: ${why}`, t.anchor);
            continue;
        }
        add('defect', L.reason.failure(t.label, L.failure[t.failure.kind]), t.anchor);
    }
    if (hasTcMd && !partial) {
        // One missing TC can drop several ACs; list it once
        const byState = { missing: new Map(), unmapped: new Map() };
        for (const ac of acs) {
            for (const row of ac.rows ?? []) {
                const map = byState[row.state];
                if (map) map.set(row.tcId, [...(map.get(row.tcId) ?? []), ac.id]);
            }
        }
        for (const [tcId, acIds] of byState.missing) add('defect', L.reason.missingSpec(tcId, acIds));
        for (const [tcId, acIds] of byState.unmapped) add('check', L.reason.unmappedTc(tcId, acIds));
    }
    // Empty values in actuals mean a weak assertion or a wrong landing; absent test data is a check above
    for (const t of tests) {
        if (isDataAbsent(t)) continue;
        for (const s of t.timeline) {
            if (typeof s.actual === 'string' && MISSING_VALUE.test(s.actual)) {
                const head = `${t.label} — ${s.key} ${L.gate.missingValue}`;
                const text = `${head} (${L.gate.actual}: ${s.actual})`;
                add('defect', text, t.anchor);
            }
        }
    }
    for (const t of tests) {
        if (t.failure && RERUN_KINDS.has(t.failure.kind)) {
            add('rerun', L.reason.failure(t.label, L.failure[t.failure.kind]), t.anchor);
        }
    }
    for (const t of tests) {
        if (t.status === 'skipped') add('check', L.reason.skip(t.label, t.skipReason), t.anchor);
        const unmarked = t.timeline.filter((s) => s.state === 'unmarked').length;
        if (unmarked > 0) add('check', L.reason.unmarked(t.label, unmarked), t.anchor);
        if (hasTcMd && !t.tcId) add('check', L.reason.unmapped(t.label), t.anchor);
        if ((t.loops ?? 0) >= loopThreshold) {
            add('check', L.reason.loops(t.label, t.loops), t.anchor);
        }
        // A guessed expectation can be wrong even when it passes, so show the actual value
        for (const s of t.timeline) {
            if (!(s.desc ?? '').includes(needsCheck)) continue;
            const actual = s.actual === undefined ? '' : ` (${L.gate.actual}: ${s.actual})`;
            add('check', `${t.label} — ${s.key} ${L.gate.expectedNeedsCheck}${actual}`, t.anchor);
        }
    }

    reasons.push(...extra);

    const has = (level) => reasons.some((r) => r.level === level);
    const level = has('defect') ? 'defect' : has('rerun') ? 'rerun' : has('check') ? 'check' : 'ok';
    return { level, reasons };
}
