/**
 * Shared spec fixture. Starts RuntimeCollector before the spec's beforeEach, then after the test
 * judges the run, attaches verdict.json and a screenshot, and fails the test on a FAIL verdict.
 *
 *   import { test, expect } from '<kitDir>/index.js';
 *   test.use({ e2e: { tcName, screen, testMode, successCriteria, successCriteriaText,
 *                     consoleErrorWhitelist, networkErrorWhitelist } });
 *   test('…', async ({ page, cp }) => {
 *       await cp('cp-01', async () => { await expect(…).toBeVisible(); return actualValue; });
 *       await cp('cp-02', async () => { … }, { soft: true }); // state the environment cannot reach
 *   });
 */
import { test as base, expect } from '@playwright/test';
import { RuntimeCollector } from './services/runtime-collector.js';
import { analyze } from './services/analyze.js';
import { attachAnalysisToReport } from './utils/report-helper.js';
import { runCheckpoint } from './utils/checkpoint.mjs';
import { mockHits } from './utils/api-mocker.js';
import { loadKitConfig, reportSettings } from './config-loader.js';
import { labels } from './report/labels.mjs';
import { filterRuntime } from './utils/runtime-filter.mjs';

const settings = () => {
    const kit = loadKitConfig();
    return { ...reportSettings(kit), noise: kit.config.e2e.networkNoiseWhitelist ?? [] };
};

export const test = base.extend({
    e2e: [null, { option: true }],

    cp: async ({ e2e }, use) => {
        const { locale, platformLabel } = settings();
        const byId = new Map((e2e?.successCriteria ?? []).map((c) => [c.id, c]));
        await use((id, body, options) => runCheckpoint(base.step, byId.get(id) ?? null, id, body, { locale, platformLabel, ...options }));
    },

    collector: [
        async ({ page, e2e }, use, testInfo) => {
            if (!e2e) throw new Error('kit fixture: the spec must declare test.use({ e2e: { ... } })');
            const {
                tcName,
                screen = '',
                successCriteria = [],
                successCriteriaText = '',
                testMode = 'fixture',
                consoleErrorWhitelist = [],
                networkErrorWhitelist = []
            } = e2e;
            const s = settings();
            const networkWhitelist = [...new Set([...s.noise, ...networkErrorWhitelist])];

            for (const criterion of successCriteria) {
                criterion.passed = false;
                delete criterion.actual;
                delete criterion.soft;
                delete criterion.softReason;
            }

            const collector = new RuntimeCollector(page);
            await collector.start();

            await use(collector);

            const filtered = filterRuntime(await collector.collect(), consoleErrorWhitelist, networkWhitelist);
            const runtimeData = { ...filtered.runtimeData, mockHits: mockHits(page) };
            const result = await analyze(
                runtimeData,
                {
                    testName: tcName,
                    domain: screen,
                    testMode,
                    successCriteria: successCriteriaText,
                    whitelistedErrors: filtered.whitelistedErrors,
                    whitelistedNetworkErrors: filtered.whitelistedNetworkErrors,
                    acceptanceCriteria: successCriteria
                },
                { settings: s }
            );
            attachAnalysisToReport(testInfo, result, runtimeData, successCriteria, { locale: s.locale });

            // Viewport only: fullPage measures off-screen layers too and can produce huge images.
            const screenshot = await page.screenshot().catch(() => null);
            if (screenshot) await testInfo.attach('screenshot', { body: screenshot, contentType: 'image/png' });

            if (result.status === 'FAIL') {
                const lines = result.issues.map((i) => `  - [${i.type}] ${i.message}`).join('\n');
                throw new Error(labels(s.locale).verdictThrow(tcName, result.verdict, lines));
            }
        },
        { auto: true }
    ]
});

export { expect };
