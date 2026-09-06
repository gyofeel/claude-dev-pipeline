// Self-check for ai-analyzer + report-helper. Run: node kit/selfcheck-analyzer.mjs
import assert from 'node:assert/strict';

const cfg = (provider) => JSON.stringify({ e2e: { ai: { provider } } });
process.env.DEV_PIPELINE_CONFIG_JSON = cfg('none');
delete process.env.E2E_SKIP_AI;

const { analyze } = await import('./services/ai-analyzer.js');
const { attachAnalysisToReport } = await import('./utils/report-helper.js');

const runtime = { consoleErrors: [], exceptions: [], networkErrors: [], slowRequests: [] };
const meta = (n) => ({ testName: `t${n}`, acceptanceCriteria: [{ id: 'cp-01', desc: 'x', passed: true }] });

// 1. provider none → skipped
let r = await analyze(runtime, meta(1));
assert.equal(r.skipped, true);
assert.equal(r.status, 'PASS');

// 2. openai-shaped response via patched fetch
const realFetch = globalThis.fetch;
let calls = [];
globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const body = url.includes('openai')
        ? { choices: [{ message: { content: JSON.stringify({ status: 'FAIL', issues: ['boom'], summary: 'openai ok' }) } }] }
        : { content: [{ type: 'text', text: 'Here is the verdict:\n{"status":"WARNING","issues":[],"summary":"anthropic ok"}' }] };
    return new Response(JSON.stringify(body), { status: 200 });
};

process.env.DEV_PIPELINE_CONFIG_JSON = cfg('openai');
process.env.OPENAI_API_KEY = 'k';
r = await analyze(runtime, meta(2));
assert.equal(r.status, 'FAIL');
assert.deepEqual(r.issues, ['boom']);
assert.equal(r.summary, 'openai ok');
assert.equal(calls[0].init.headers.authorization, 'Bearer k');
assert.equal(JSON.parse(calls[0].init.body).model, 'gpt-5-mini');

// cache hit
r = await analyze(runtime, meta(2));
assert.equal(r.fromCache, true);
assert.equal(calls.length, 1);

// 3. anthropic-shaped response, JSON wrapped in prose
process.env.DEV_PIPELINE_CONFIG_JSON = cfg('anthropic');
process.env.ANTHROPIC_API_KEY = 'a';
r = await analyze(runtime, meta(3));
assert.equal(r.status, 'WARNING');
assert.equal(r.summary, 'anthropic ok');
assert.equal(calls[1].init.headers['x-api-key'], 'a');
assert.equal(JSON.parse(calls[1].init.body).model, 'claude-sonnet-5');

// 4. transport failure → analysisError, never throws
globalThis.fetch = async () => new Response('nope', { status: 503 });
r = await analyze(runtime, meta(4));
assert.equal(r.analysisError, true);
assert.equal(r.status, 'WARNING');
assert.equal(r.errorDetail.status, 503);

// 5. E2E_SKIP_AI short-circuits before config
process.env.E2E_SKIP_AI = '1';
r = await analyze(runtime, meta(5));
assert.equal(r.skipped, true);
globalThis.fetch = realFetch;

// 6. report attachments
const attachments = [];
const testInfo = { annotations: [], titlePath: ['suite', 'case'], attach: (name, o) => attachments.push({ name, ...o }) };
attachAnalysisToReport(testInfo, { status: 'FAIL', issues: ['boom'], summary: 's', responseTime: 12 }, { ...runtime, consoleErrors: [{ text: '<b>err</b>', timestamp: 't' }] }, [{ id: 'cp-01', desc: 'x', passed: false }]);
const html = attachments.find((a) => a.name === 'ai-analysis');
assert.ok(html && html.contentType === 'text/html');
assert.ok(html.body.includes('&lt;b&gt;err&lt;/b&gt;'), 'escapes html');
assert.ok(html.body.includes('Acceptance criteria (0/1)'));
assert.ok(attachments.find((a) => a.name === 'analysis.json'));
assert.ok(!html.body.includes('ESLint'));
assert.equal(testInfo.annotations[0].type, 'AI ❌ FAIL');

console.log('selfcheck-analyzer: OK');
