/** Rule-based E2E verdict: PASS / FAIL / SKIP from the inputs alone. Rules: e2e-report-redesign spec 2-2. */
import { labels } from '../report/labels.mjs';

const RESOURCE_LOAD_RE = /^Failed to load resource/;
const DETAIL_MAX = 200;

const isStrictMode = (testMode) => testMode === 'real-api' || testMode === 'hybrid' || testMode === 'live-data';
const clip = (text) => String(text ?? '').slice(0, DETAIL_MAX);
const firstLine = (text) => String(text ?? '').split('\n')[0];

const makeIssue = (type, message, detail) => ({ type, message, detail: clip(detail) });

const classifyText = (text, testMode, backendRes) => {
    const head = firstLine(text);
    if (RESOURCE_LOAD_RE.test(head)) return 'resource-load';
    if (backendRes.some((re) => re.test(head))) return isStrictMode(testMode) ? 'fail' : 'be-response';
    return 'fail';
};

const summarize = (L, cp, issues, excluded) => {
    const clientErrors = issues.filter(
        (i) => i.type === 'console_error' || i.type === 'exception'
    ).length;
    const counts = {};
    for (const e of excluded) counts[e.reason] = (counts[e.reason] ?? 0) + e.count;
    return L.judgeSummary({
        cpPassed: cp.filter((c) => c.passed).length,
        cpTotal: cp.length,
        clientErrors,
        excluded: Object.entries(counts)
    });
};

/**
 * Judges from collected runtime data and test meta; the caller passes the test status from test.info().
 */
export function judge({
    runtimeData = {},
    testMeta = {},
    testStatus = 'unknown',
    backendErrorPatterns = [],
    locale = 'en'
}) {
    const L = labels(locale);
    const backendRes = backendErrorPatterns.map((p) => new RegExp(p));
    const testMode = testMeta.testMode ?? 'fixture';
    const cp = (testMeta.acceptanceCriteria ?? []).map((c) => ({
        ...c,
        passed: !!c.passed
    }));
    const base = { testMode, testStatus, cp, mockHits: runtimeData.mockHits ?? testMeta.mockHits ?? {} };

    if (testStatus === 'skipped') {
        return {
            ...base,
            status: 'PASS',
            verdict: 'SKIP',
            issues: [],
            excluded: [],
            unmarked: [],
            summary: L.skipSummary
        };
    }

    const issues = [];
    const excluded = [];

    const whitelistCount =
        (testMeta.whitelistedErrors?.filteredCount ?? 0) +
        (testMeta.whitelistedNetworkErrors?.filteredCount ?? 0);
    if (whitelistCount > 0) {
        const patterns = [
            ...(testMeta.whitelistedErrors?.patterns ?? []),
            ...(testMeta.whitelistedNetworkErrors?.patterns ?? [])
        ];
        excluded.push({
            reason: 'whitelist',
            message: L.whitelistCount(whitelistCount),
            detail: clip([...new Set(patterns)].join(', ')),
            count: whitelistCount
        });
    }

    for (const entry of runtimeData.consoleErrors ?? []) {
        const kind = classifyText(entry.text, testMode, backendRes);
        if (kind === 'fail') {
            issues.push(makeIssue('console_error', L.issue.console_error, entry.text));
            continue;
        }
        excluded.push({
            reason: kind,
            message: firstLine(entry.text),
            detail: clip(entry.text),
            count: 1
        });
    }

    for (const entry of runtimeData.exceptions ?? []) {
        const text = entry.stack || entry.text || entry.message;
        const kind = classifyText(text, testMode, backendRes);
        if (kind === 'fail') {
            issues.push(makeIssue('exception', L.issue.exception, firstLine(text)));
            continue;
        }
        excluded.push({ reason: kind, message: firstLine(text), detail: clip(text), count: 1 });
    }

    for (const entry of runtimeData.networkErrors ?? []) {
        const label = `${entry.status} ${entry.url}`;
        if (entry.kind === 'api' && isStrictMode(testMode)) {
            issues.push(makeIssue('network_error', L.issue.network_error, label));
            continue;
        }
        excluded.push({
            reason: entry.kind === 'api' ? 'mock-scope' : 'asset',
            message: clip(label),
            detail: clip(entry.url),
            count: 1
        });
    }

    // A soft-tracked cp stays unmarked instead of failing; the gate surfaces it as "needs review".
    // If the test already failed, the Playwright error is authoritative — do not count cps again.
    const unmarked = testStatus === 'passed' ? cp.filter((x) => !x.passed).map((x) => x.id) : [];

    const verdict = issues.length > 0 ? 'FAIL' : 'PASS';
    return {
        ...base,
        status: verdict,
        verdict,
        issues,
        excluded,
        unmarked,
        summary: summarize(L, cp, issues, excluded)
    };
}
