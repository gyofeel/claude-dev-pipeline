/**
 * Failure diagnostics — capture "what the page looked like at the moment of failure" and attach it
 * to the Playwright report so the regeneration loop can reason from evidence instead of guesses.
 *
 * Both helpers never throw: diagnostics are auxiliary and must not mask the original failure.
 *
 * @example
 *   try { await page.waitForFunction(...); }
 *   catch (e) { await captureFailureDiagnostics(page, testInfo, { step: 'open-detail', expected: 'url contains /detail', adapter }); throw e; }
 */

async function attach(testInfo, name, body, contentType = 'application/json') {
    try {
        await testInfo.attach(name, { body, contentType });
    } catch {
        /* attachment failure must not affect the test */
    }
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').TestInfo} testInfo
 * @param {Object} [options]
 * @param {string} [options.step] - failure point identifier
 * @param {string} [options.expected] - what the step was waiting for
 * @param {Object} [options.adapter] - project adapter; `adapter.snapshotState(page)` is merged into `state`
 * @returns {Promise<Object>} the diagnostics object that was attached
 */
export async function captureFailureDiagnostics(page, testInfo, options = {}) {
    const { step = 'unknown', expected = null, adapter = null } = options;
    let snapshot;
    try {
        snapshot = await page.evaluate(() => {
            const el = document.activeElement;
            const text = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
            return {
                url: location.href,
                title: document.title,
                activeElement: el
                    ? {
                          tag: el.tagName?.toLowerCase() ?? null,
                          id: el.id || null,
                          classes: el.className ? String(el.className).split(/\s+/).filter(Boolean) : [],
                          testid: el.getAttribute?.('data-testid') ?? null,
                          text: text(el.textContent).slice(0, 120)
                      }
                    : null,
                visibleTextSample: text(document.body?.innerText).slice(0, 500)
            };
        });
    } catch (err) {
        snapshot = { error: `snapshot failed: ${err?.message?.slice(0, 120)}` };
    }

    let state = {};
    try {
        state = (await adapter?.snapshotState?.(page)) ?? {};
    } catch (err) {
        state = { error: `snapshotState failed: ${err?.message?.slice(0, 120)}` };
    }

    const diagnostics = { step, expected, ...snapshot, state, timestamp: new Date().toISOString() };
    await attach(testInfo, 'failure-diagnostics', JSON.stringify(diagnostics, null, 2));

    try {
        const shot = await page.screenshot();
        await attach(testInfo, `failure-screenshot-${step}`, shot, 'image/png');
    } catch {
        /* page may already be closed */
    }

    console.log(`[diagnostics] step=${step} expected=${expected} url=${diagnostics.url ?? '?'}`);
    return diagnostics;
}

/**
 * Evidence for a SKIP: what the navigation actually found before giving up. Lets the validator
 * distinguish "nothing matched" (NO_CANDIDATE) from "matched but rejected on arrival"
 * (ENTERED_BUT_REJECTED) instead of guessing "data absent".
 *
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').TestInfo} testInfo
 * @param {Object} [options]
 * @param {Object|string} [options.target] - the target descriptor the plan searched for
 * @param {number} [options.candidateCount] - matches found (entered or not)
 * @param {Array} [options.enteredLog] - per-candidate entries [{ ..., reason }]
 * @param {number} [options.visited] - items/areas actually visited
 * @returns {Promise<Object>} the census that was attached
 */
export async function captureNavigationCensus(page, testInfo, options = {}) {
    const { target = null, candidateCount = 0, enteredLog = [], visited = null } = options;
    let url = null;
    try {
        url = await page.evaluate(() => location.href);
    } catch {
        /* page may be closed */
    }
    const census = {
        target,
        candidateCount,
        visited,
        enteredCount: Array.isArray(enteredLog) ? enteredLog.length : 0,
        enteredLog,
        verdictHint: candidateCount === 0 ? 'NO_CANDIDATE' : 'ENTERED_BUT_REJECTED',
        url,
        timestamp: new Date().toISOString()
    };
    await attach(testInfo, 'navigation-census', JSON.stringify(census, null, 2));
    console.log(`[census] candidates=${candidateCount} entered=${census.enteredCount} verdict=${census.verdictHint}`);
    return census;
}
