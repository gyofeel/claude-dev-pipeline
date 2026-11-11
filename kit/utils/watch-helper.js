/**
 * Observes short-lived elements (toasts and the like) over a time window. Checking the DOM once
 * cannot tell whether a toast that closes after three seconds ever appeared. The sampler is also
 * installed as an init script so it survives reloads the interaction causes.
 */

const install = (selectors) => {
    const watch = Object.fromEntries(selectors.map((s) => [s, { peak: 0, texts: [] }]));
    window.__e2eWatch = watch;
    setInterval(() => {
        for (const s of selectors) {
            const els = [...document.querySelectorAll(s)];
            watch[s].peak = Math.max(watch[s].peak, els.length);
            for (const el of els) {
                const text = el.textContent.trim();
                if (text && !watch[s].texts.includes(text)) watch[s].texts.push(text);
            }
        }
    }, 250);
};

/** Start sampling, every 250 ms, the peak match count and the texts seen for each selector. */
export const watchSelectors = async (page, selectors) => {
    await page.addInitScript(install, selectors);
    await page.evaluate(install, selectors);
};

/** After the window (ms), return { peak, texts } per selector — from the latest document if it reloaded. */
export const readWatch = async (page, windowMs) => {
    await page.waitForTimeout(windowMs);
    return page.evaluate(() => window.__e2eWatch ?? {});
};
