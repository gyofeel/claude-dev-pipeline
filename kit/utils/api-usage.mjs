/** API call volume of one test. Shown in the report only; never part of the verdict. */

// Apps also fetch images, sounds and text files — keep them out of backend call counts
export const STATIC_FETCH_RE =
    /\.(png|jpe?g|gif|webp|svg|ico|wav|mp3|ogg|m4a|aac|mp4|webm|woff2?|ttf|otf|txt|wasm)$/i;
export const IDLE_AFTER_MS = 3000;
const LIST_MAX = 20;

const pathOf = (url) => new URL(url).pathname;

const requestKey = ({ method, url }) => {
    const u = new URL(url);
    const query = [...u.searchParams].sort(([a], [b]) => a.localeCompare(b));
    return `${method} ${u.pathname}${query.length ? `?${new URLSearchParams(query)}` : ''}`;
};

const tally = (keys) =>
    [...keys.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map())].sort(
        (a, b) => b[1] - a[1]
    );

/**
 * @param {Array<{ method, url, ts, category }>} requests xhr/fetch requests (ts in ms)
 * @param {number[]} inputTimes input (keydown / pointerdown) times (ms)
 */
export function summarizeApiUsage(requests, inputTimes, { idleAfterMs = IDLE_AFTER_MS } = {}) {
    const api = requests.filter(
        (r) => r.category !== 'shell' && !STATIC_FETCH_RE.test(pathOf(r.url))
    );
    const lastInput = inputTimes.length ? Math.max(...inputTimes) : null;
    const duplicates = tally(api.map(requestKey)).filter(([, count]) => count > 1);
    const idle = lastInput == null ? null : api.filter((r) => r.ts - lastInput >= idleAfterMs);
    return {
        total: api.length,
        byEndpoint: tally(api.map((r) => pathOf(r.url)))
            .slice(0, LIST_MAX)
            .map(([endpoint, count]) => ({ endpoint, count })),
        duplicates: duplicates.slice(0, LIST_MAX).map(([key, count]) => ({ key, count })),
        // repeats beyond the first call — requests that could have been avoided
        duplicateCount: duplicates.reduce((n, [, count]) => n + count - 1, 0),
        idle:
            idle
                ?.slice(0, LIST_MAX)
                .map((r) => ({ endpoint: pathOf(r.url), afterInputMs: r.ts - lastInput })) ?? null,
        idleCount: idle?.length ?? null
    };
}
