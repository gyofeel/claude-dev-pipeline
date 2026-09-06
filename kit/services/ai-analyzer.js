/**
 * AI analyzer — asks an LLM to grade E2E runtime data against the test's acceptance criteria.
 *
 * Provider (openai | anthropic | none), model and API-key env name come from
 * `.agents/pipeline.config.json` → `e2e.ai` (via ../config-loader.js). Uses global `fetch`; no SDK.
 * Never throws: infrastructure failures return `{ status: 'WARNING', analysisError: true }` so a
 * broken LLM endpoint does not fail the test.
 *
 * @example
 *   const result = await analyze(runtimeData, testMeta);
 *   // { status: 'PASS'|'WARNING'|'FAIL', issues: [], summary, analysisError, fromCache, responseTime }
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = path.resolve(__dirname, '../prompts/analyze.txt');
const TIMEOUT_MS = 30000;
const CACHE_MAX = 100;

const DEFAULTS = {
    openai: { model: 'gpt-5-mini', apiKeyEnv: 'OPENAI_API_KEY' },
    anthropic: { model: 'claude-sonnet-5', apiKeyEnv: 'ANTHROPIC_API_KEY' }
};

const cache = new Map();
let systemPrompt = null;

function getSystemPrompt() {
    if (!systemPrompt) systemPrompt = readFileSync(PROMPT_PATH, 'utf8');
    return systemPrompt;
}

/** Resolve `e2e.ai` from the kit config; `DEV_PIPELINE_CONFIG_JSON` env overrides (tests, CI). */
async function loadAiConfig() {
    if (process.env.DEV_PIPELINE_CONFIG_JSON) {
        try {
            return JSON.parse(process.env.DEV_PIPELINE_CONFIG_JSON)?.e2e?.ai ?? {};
        } catch {
            return {};
        }
    }
    try {
        const { loadKitConfig } = await import('../config-loader.js');
        return (await loadKitConfig())?.config?.e2e?.ai ?? {};
    } catch {
        return {};
    }
}

function skipped(summary) {
    return {
        status: 'PASS',
        issues: [],
        summary,
        analysisError: false,
        skipped: true,
        fromCache: false,
        responseTime: 0
    };
}

function infraFailure(summary, errorDetail) {
    return {
        status: 'WARNING',
        issues: [],
        summary,
        analysisError: true,
        errorDetail,
        fromCache: false,
        responseTime: 0
    };
}

/** POST JSON with a hard timeout; returns parsed body or throws with `.status`. */
async function postJson(url, headers, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...headers },
            body: JSON.stringify(body),
            signal: controller.signal
        });
        const text = await res.text();
        if (!res.ok) {
            const err = new Error(text.slice(0, 200) || res.statusText);
            err.status = res.status;
            throw err;
        }
        return JSON.parse(text);
    } finally {
        clearTimeout(timer);
    }
}

/** Provider call → raw assistant text. */
async function callProvider(provider, model, apiKey, userContent) {
    if (provider === 'openai') {
        const data = await postJson(
            'https://api.openai.com/v1/chat/completions',
            { authorization: `Bearer ${apiKey}` },
            {
                model,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: getSystemPrompt() },
                    { role: 'user', content: userContent }
                ]
            }
        );
        return data?.choices?.[0]?.message?.content ?? '';
    }
    // anthropic
    const data = await postJson(
        'https://api.anthropic.com/v1/messages',
        { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        {
            model,
            max_tokens: 2048,
            system: getSystemPrompt() + '\n\nRespond with a single JSON object and nothing else.',
            messages: [{ role: 'user', content: userContent }]
        }
    );
    return (data?.content ?? [])
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('');
}

/** Parse the first {...} block in the text (Anthropic may wrap JSON in prose). */
function parseJsonBlock(raw) {
    try {
        return JSON.parse(raw);
    } catch {
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}');
        if (start < 0 || end <= start) return null;
        try {
            return JSON.parse(raw.slice(start, end + 1));
        } catch {
            return null;
        }
    }
}

/**
 * Grade a test run.
 *
 * @param {Object} runtimeData - RuntimeCollector.collect() output (already whitelist-filtered)
 * @param {Object} [testMeta] - { testName, screen, successCriteria, acceptableStatuses,
 *   whitelistedErrors: { patterns, filteredCount, remainingCount }, whitelistedNetworkErrors,
 *   acceptanceCriteria: [{ id, desc, passed, soft? }] }
 * @returns {Promise<{status: string, issues: Array, summary: string, analysisError: boolean, fromCache: boolean, responseTime: number}>}
 */
export async function analyze(runtimeData, testMeta = {}) {
    if (process.env.E2E_SKIP_AI === '1') return skipped('AI analysis skipped');

    const ai = await loadAiConfig();
    const provider = ai.provider ?? 'none';
    if (!DEFAULTS[provider]) return skipped('AI analysis skipped');

    const model = ai.model || DEFAULTS[provider].model;
    const apiKey = process.env[ai.apiKeyEnv || DEFAULTS[provider].apiKeyEnv];
    if (!apiKey) return skipped('AI analysis skipped');

    const userContent = JSON.stringify({ runtimeData, testMeta });
    const cacheKey = createHash('md5').update(provider + model + userContent).digest('hex');
    if (cache.has(cacheKey)) return { ...cache.get(cacheKey), fromCache: true };

    const startTime = Date.now();
    let parsed;
    try {
        let raw = await callProvider(provider, model, apiKey, userContent);
        parsed = parseJsonBlock(raw);
        if (!parsed) {
            // one retry absorbs a transient empty/garbled response
            raw = await callProvider(provider, model, apiKey, userContent);
            parsed = parseJsonBlock(raw);
            if (!parsed) {
                return infraFailure('AI response could not be parsed (2 attempts)', {
                    name: 'ParseError',
                    status: null,
                    message: (raw || '').slice(0, 200)
                });
            }
        }
    } catch (err) {
        const detail = {
            name: err?.name ?? 'Error',
            status: err?.status ?? null,
            message: err?.message ?? 'unknown error'
        };
        console.error(`[ai-analyzer] ${provider} call failed — ${detail.name} ${detail.status ?? ''} ${detail.message}`);
        return infraFailure(`AI analysis unavailable (${provider}): ${detail.name}`, detail);
    }

    const result = {
        status: ['PASS', 'WARNING', 'FAIL'].includes(parsed.status) ? parsed.status : 'WARNING',
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        summary: parsed.summary ?? '',
        analysisError: false,
        fromCache: false,
        responseTime: Date.now() - startTime
    };

    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(cacheKey, result);
    return result;
}
