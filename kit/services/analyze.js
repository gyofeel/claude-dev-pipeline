/**
 * Verdict for one test: reads the running test's status, then applies the judge rules.
 * The kit fixture calls it from teardown.
 */
import { judge } from './judge.js';
import { loadKitConfig, reportSettings } from '../config-loader.js';

const currentTest = async () => {
    try {
        const { test } = await import('@playwright/test');
        return { status: test.info().status ?? 'unknown' };
    } catch {
        return { status: 'unknown' };
    }
};

export async function analyze(runtimeData, testMeta = {}, deps = {}) {
    const { status: testStatus } = await (deps.currentTest ?? currentTest)();
    const { backendErrorPatterns, locale } = deps.settings ?? reportSettings(loadKitConfig());
    const judged = judge({ runtimeData, testMeta, testStatus, backendErrorPatterns, locale });
    return {
        ...judged,
        testName: testMeta.testName ?? '',
        domain: testMeta.domain ?? '',
        successCriteria: testMeta.successCriteria ?? '',
        analysisError: false
    };
}
