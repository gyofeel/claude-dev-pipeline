/**
 * Collects runtime signals for the whole test: console errors/warnings, uncaught
 * exceptions, failed requests (status >= 400 or requestfailed), slow requests.
 *
 *   const collector = new RuntimeCollector(page); await collector.start();
 *   const data = await collector.collect();
 */
import { mockCategoryOf } from '../utils/api-mocker.js';
import { STATIC_FETCH_RE, summarizeApiUsage } from '../utils/api-usage.mjs';

const SLOW_REQUEST_MS = 3000;
const BOUNDARY_LIST_MAX = 20;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stripQuery = (url) => url.split('?')[0];
const uniqueHead = (list) => [...new Set(list)].slice(0, BOUNDARY_LIST_MAX);

export class RuntimeCollector {
    /** @param {import('@playwright/test').Page} page */
    constructor(page) {
        this.page = page;
        this.startedAt = 0;
        this.clear();
    }

    async start() {
        this.startedAt = Date.now();
        this.page.on('console', (msg) => {
            const type = msg.type();
            if (type !== 'error' && type !== 'warning') return;
            // Browser-generated logs ("Failed to load resource") carry the URL only in location().
            this.consoleEntries.push({
                type,
                text: msg.text(),
                url: msg.location()?.url || null,
                timestamp: new Date().toISOString()
            });
        });
        this.page.on('pageerror', (error) => {
            this.exceptions.push({
                type: 'exception',
                text: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
        });
        this.page.on('request', (request) => {
            this.requestStartTimes.set(request, Date.now());
            const type = request.resourceType();
            if (type !== 'xhr' && type !== 'fetch') return;
            this.apiRequests.push(request);
            this.requestLog.push({ request, method: request.method(), url: request.url(), ts: Date.now() });
        });
        this.page.on('requestfailed', (request) => {
            this.requestStartTimes.delete(request);
            this.networkErrors.push({
                type: 'requestfailed',
                text: request.failure()?.errorText || 'request failed',
                url: request.url(),
                status: null,
                kind: kindOf(request.resourceType()),
                timestamp: new Date().toISOString()
            });
        });
        this.page.on('response', (response) => {
            const request = response.request();
            const start = this.requestStartTimes.get(request);
            this.requestStartTimes.delete(request);
            const status = response.status();
            const url = response.url();
            // A fixture that answers 4xx/5xx is an error-handling TC, not a broken backend
            if (status >= 400 && mockCategoryOf(request) !== 'fixture') {
                this.networkErrors.push({
                    type: 'http',
                    text: `HTTP ${status}`,
                    url,
                    status,
                    kind: kindOf(request.resourceType()),
                    timestamp: new Date().toISOString()
                });
            }
            if (start !== undefined) {
                const duration = Date.now() - start;
                if (duration > SLOW_REQUEST_MS) this.slowRequests.push({ url, duration, status });
            }
        });
        await this._setupInputLog();
    }

    // Input times for the idle-request count; exposeFunction survives navigations.
    async _setupInputLog() {
        if (typeof this.page.exposeFunction !== 'function') return;
        await this.page.exposeFunction('__e2eInput', () => this.inputTimes.push(Date.now())).catch(() => {});
        await this.page.addInitScript(() => {
            const mark = () => window.__e2eInput?.();
            window.addEventListener('keydown', mark, true);
            window.addEventListener('pointerdown', mark, true);
        });
    }

    _mockBoundary() {
        let fixture = 0;
        const empty = [];
        const live = [];
        for (const request of this.apiRequests) {
            const category = mockCategoryOf(request);
            const url = stripQuery(request.url());
            if (category === 'fixture') fixture += 1;
            else if (category === 'empty') empty.push(url);
            else if (category !== 'shell' && !STATIC_FETCH_RE.test(url)) live.push(url);
        }
        return { fixture, empty: uniqueHead(empty), emptyCount: new Set(empty).size, live: uniqueHead(live), liveCount: new Set(live).size };
    }

    /**
     * Wait until every request so far has a response and none started for quietMs.
     * Call before the first runtime checkpoint so late errors are not missed.
     */
    async settle({ quietMs = 1000, timeout = 10000 } = {}) {
        const deadline = Date.now() + timeout;
        let seen = -1;
        while (seen !== this.apiRequests.length && Date.now() < deadline) {
            seen = this.apiRequests.length;
            await Promise.race([
                Promise.all(this.apiRequests.map((r) => r.response().catch(() => null))),
                sleep(Math.max(0, deadline - Date.now()))
            ]);
            await sleep(quietMs);
        }
    }

    /** @returns {Promise<Object>} */
    async collect() {
        return {
            consoleErrors: this.consoleEntries.filter((e) => e.type === 'error'),
            consoleWarnings: this.consoleEntries.filter((e) => e.type === 'warning'),
            exceptions: this.exceptions,
            networkErrors: this.networkErrors,
            slowRequests: this.slowRequests,
            durationMs: Date.now() - this.startedAt,
            mockBoundary: this._mockBoundary(),
            api: summarizeApiUsage(
                this.requestLog.map((e) => ({ method: e.method, url: e.url, ts: e.ts, category: mockCategoryOf(e.request) })),
                this.inputTimes
            )
        };
    }

    clear() {
        this.consoleEntries = [];
        this.exceptions = [];
        this.networkErrors = [];
        this.slowRequests = [];
        this.requestStartTimes = new Map();
        this.apiRequests = [];
        this.requestLog = [];
        this.inputTimes = [];
    }
}

// Asset failures (image 404) are not app-logic defects; analyzers weigh api vs asset differently.
function kindOf(resourceType) {
    if (resourceType === 'image' || resourceType === 'media' || resourceType === 'font') return 'asset';
    if (resourceType === 'xhr' || resourceType === 'fetch') return 'api';
    return 'other';
}
