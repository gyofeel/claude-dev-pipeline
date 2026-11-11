/**
 * Attaches one test's verdict, raw runtime data and report metadata as verdict.json.
 * The archive reporter turns those records into e2e-report.html after the run.
 */
import { labels, VERDICT_ICON } from '../report/labels.mjs';

const RUNTIME_LIST_MAX = 50;
const RUNTIME_TEXT_MAX = 500;

const clipEntries = (list = []) =>
    list
        .slice(0, RUNTIME_LIST_MAX)
        .map((entry) =>
            Object.fromEntries(
                Object.entries(entry).map(([k, v]) => [
                    k,
                    typeof v === 'string' ? v.slice(0, RUNTIME_TEXT_MAX) : v
                ])
            )
        );

/** Per-test record read by report/collect.mjs. */
export function buildVerdictRecord(analysisResult, runtimeData = {}, criteria = []) {
    return {
        schema: 1,
        verdict: analysisResult.verdict,
        status: analysisResult.status,
        summary: analysisResult.summary,
        testMode: analysisResult.testMode,
        testStatus: analysisResult.testStatus,
        testName: analysisResult.testName ?? '',
        domain: analysisResult.domain ?? '',
        successCriteria: analysisResult.successCriteria ?? '',
        cp: (analysisResult.cp ?? criteria ?? []).map((c) => ({
            id: c.id,
            desc: c.desc,
            passed: !!c.passed,
            ...(c.actual !== undefined ? { actual: c.actual } : {}),
            ...(c.soft ? { soft: true, softReason: c.softReason ?? '' } : {})
        })),
        issues: analysisResult.issues ?? [],
        excluded: analysisResult.excluded ?? [],
        mockBoundary: runtimeData.mockBoundary ?? null,
        mockHits: analysisResult.mockHits ?? runtimeData.mockHits ?? {},
        api: runtimeData.api ?? null,
        runtime: {
            consoleErrors: clipEntries(runtimeData.consoleErrors),
            consoleWarnings: clipEntries(runtimeData.consoleWarnings),
            exceptions: clipEntries(runtimeData.exceptions),
            networkErrors: clipEntries(runtimeData.networkErrors)
        }
    };
}

/** Annotation covers console, exceptions and network only; assertion failures live in the test status. */
export function attachAnalysisToReport(testInfo, analysisResult, runtimeData, criteria, { locale = 'en' } = {}) {
    if (!analysisResult) return;
    const verdict = analysisResult.verdict ?? analysisResult.status;
    testInfo.annotations.push({
        type: `${labels(locale).annotation.runtimeVerdict} ${VERDICT_ICON[verdict] ?? '❓'} ${verdict}`,
        description: analysisResult.summary ?? ''
    });
    testInfo.attach('verdict.json', {
        body: JSON.stringify(buildVerdictRecord(analysisResult, runtimeData, criteria)),
        contentType: 'application/json'
    });
}
