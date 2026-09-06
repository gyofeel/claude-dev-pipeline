/**
 * Collects runtime signals for the whole test: console errors/warnings, uncaught
 * exceptions, failed requests (status >= 400 or requestfailed), slow requests.
 *
 *   const collector = new RuntimeCollector(page); await collector.start();
 *   const data = await collector.collect();
 */
const SLOW_REQUEST_MS = 3000;

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
        this.page.on('request', (request) => this.requestStartTimes.set(request, Date.now()));
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
            if (status >= 400) {
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
    }

    /** @returns {Promise<Object>} */
    async collect() {
        return {
            consoleErrors: this.consoleEntries.filter((e) => e.type === 'error'),
            consoleWarnings: this.consoleEntries.filter((e) => e.type === 'warning'),
            exceptions: this.exceptions,
            networkErrors: this.networkErrors,
            slowRequests: this.slowRequests,
            durationMs: Date.now() - this.startedAt
        };
    }

    clear() {
        this.consoleEntries = [];
        this.exceptions = [];
        this.networkErrors = [];
        this.slowRequests = [];
        this.requestStartTimes = new Map();
    }
}

// Asset failures (image 404) are not app-logic defects; analyzers weigh api vs asset differently.
function kindOf(resourceType) {
    if (resourceType === 'image' || resourceType === 'media' || resourceType === 'font') return 'asset';
    if (resourceType === 'xhr' || resourceType === 'fetch') return 'api';
    return 'other';
}
