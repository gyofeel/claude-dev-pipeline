/**
 * Attaches the AI verdict and runtime metrics to the Playwright HTML report.
 *
 * - testInfo.annotations: verdict / performance / runtime counts / acceptance criteria in the test list
 * - attachment `ai-analysis` (text/html): compact dashboard
 * - attachment `analysis.json`: raw analysis result
 */

const STATUS_EMOJI = { PASS: '✅', WARNING: '⚠️', FAIL: '❌' };

/**
 * @param {import('@playwright/test').TestInfo} testInfo
 * @param {Object} analysisResult - { status, issues, summary, responseTime, fromCache, analysisError, errorDetail }
 * @param {Object} [runtimeData] - RuntimeCollector.collect() output
 * @param {Array} [criteria] - SUCCESS_CRITERIA [{ id, desc, passed }]
 */
export function attachAnalysisToReport(testInfo, analysisResult, runtimeData, criteria) {
    if (!analysisResult) return;
    const emoji = STATUS_EMOJI[analysisResult.status] || '❓';

    testInfo.annotations.push({
        type: `AI ${emoji} ${analysisResult.status}`,
        description: analysisResult.summary || 'analysis complete'
    });

    if (runtimeData) {
        const perf = runtimeData.performance;
        const mem = runtimeData.memory?.last;
        const memPercent = mem && mem.totalMB > 0 ? Math.round((mem.usedMB / mem.totalMB) * 100) : '-';
        testInfo.annotations.push({
            type: 'performance',
            description: `TTFB ${perf?.ttfbMs ?? '-'}ms | FCP ${perf?.fcpMs ?? '-'}ms | memory ${memPercent}%`
        });
        testInfo.annotations.push({
            type: 'runtime',
            description: `errors ${runtimeData.consoleErrors?.length ?? 0} | warnings ${
                runtimeData.consoleWarnings?.length ?? 0
            } | network errors ${runtimeData.networkErrors?.length ?? 0}`
        });
    }

    if (criteria?.length) {
        const passedCount = criteria.filter((c) => c.passed).length;
        const failed = criteria.filter((c) => !c.passed).map((c) => c.desc).join(', ');
        const allPassed = passedCount === criteria.length;
        testInfo.annotations.push({
            type: `${allPassed ? '✅' : '❌'} Acceptance Criteria`,
            description: `${passedCount}/${criteria.length} passed${allPassed ? '' : ` — failed: ${failed}`}`
        });
    }

    testInfo.attach('analysis.json', {
        body: JSON.stringify(analysisResult, null, 2),
        contentType: 'application/json'
    });
    testInfo.attach('ai-analysis', {
        body: buildDashboardHtml(analysisResult, runtimeData, testInfo.titlePath?.join(' > '), criteria),
        contentType: 'text/html'
    });
}

function buildDashboardHtml(analysis, runtime, title, criteria) {
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><style>${CSS}</style></head>
<body><div class="dashboard">
<h1 class="title">${esc(title || 'E2E test dashboard')}</h1>
${criteria?.length ? sectionCriteria(criteria) : ''}
${sectionVerdict(analysis)}
${runtime ? sectionConsole(runtime) : ''}
${runtime ? sectionNetwork(runtime) : ''}
${runtime ? sectionPerformance(runtime) : ''}
</div></body></html>`;
}

function sectionCriteria(criteria) {
    const passedCount = criteria.filter((c) => c.passed).length;
    const rows = criteria
        .map(
            (c) =>
                `<div class="criteria ${c.passed ? 'ok' : 'bad'}">${c.passed ? '✅' : '❌'} <code>${esc(
                    c.id
                )}</code> ${esc(c.desc)}${c.soft ? ' <em>(soft)</em>' : ''}</div>`
        )
        .join('');
    return `<div class="section"><div class="header">${
        passedCount === criteria.length ? '✅' : '❌'
    } Acceptance criteria (${passedCount}/${criteria.length})</div>${rows}</div>`;
}

function sectionVerdict(a) {
    if (a.analysisError) {
        const d = a.errorDetail || {};
        return `<div class="section"><div class="header">🤖 AI verdict</div>
<div class="verdict WARNING">⚠️ AI analysis unavailable — verdict withheld</div>
<div class="summary">${esc(a.summary)}</div>
<div class="meta">${esc(d.name || '')}${d.status ? ` (status ${esc(d.status)})` : ''}${d.message ? ` — ${esc(d.message)}` : ''}</div>
<div class="summary">An LLM call failure is not a test-quality result; this run passes without a verdict.</div></div>`;
    }
    const issues = a.issues?.length
        ? `<ul class="issues">${a.issues.map((i) => `<li>${esc(typeof i === 'string' ? i : i.message ?? JSON.stringify(i))}</li>`).join('')}</ul>`
        : '<div class="empty">No issues</div>';
    return `<div class="section"><div class="header">🤖 AI verdict</div>
<div class="verdict ${esc(a.status)}">${STATUS_EMOJI[a.status] || '❓'} ${esc(a.status)}${a.skipped ? ' (skipped)' : ''}</div>
<div class="summary">${esc(a.summary)}</div>
${a.responseTime ? `<div class="meta">response ${a.responseTime}ms${a.fromCache ? ' (cached)' : ''}</div>` : ''}
${issues}</div>`;
}

function sectionConsole(r) {
    const errors = r.consoleErrors ?? [];
    const warnings = r.consoleWarnings ?? [];
    const exceptions = r.exceptions ?? [];
    return `<div class="section"><div class="header">📝 Console</div>
${stats([
    ['errors', errors.length, 'bad'],
    ['warnings', warnings.length, 'warn'],
    ['exceptions', exceptions.length, 'bad']
])}
${list('🔴 Console errors', errors, (e) => `${esc(e.text)}${e.url ? ` <span class="meta">${esc(e.url)}</span>` : ''}`)}
${list('🟡 Console warnings', warnings, (e) => esc(e.text))}
${list('💥 Exceptions', exceptions, (e) => `${esc(e.message)}${e.stack ? `<pre>${esc(e.stack.slice(0, 500))}</pre>` : ''}`)}
</div>`;
}

function sectionNetwork(r) {
    const net = r.networkErrors ?? [];
    const slow = r.slowRequests ?? [];
    return `<div class="section"><div class="header">🌐 Network</div>
${stats([
    ['4xx/5xx', net.length, 'bad'],
    ['slow (>3s)', slow.length, 'warn']
])}
${list('🔴 Network errors', net, (e) => `<b>${esc(e.status)}</b> ${e.kind ? `[${esc(e.kind)}] ` : ''}${esc(e.url)}`)}
${list('🟡 Slow requests', slow, (e) => `<b>${esc(e.duration)}ms</b> ${esc(e.url)}`)}
</div>`;
}

function sectionPerformance(r) {
    const p = r.performance;
    const m = r.memory;
    const last = m?.last;
    const rows = [
        ['TTFB', p?.ttfbMs != null ? `${p.ttfbMs}ms` : '-', p?.ttfbWarning],
        ['FCP', p?.fcpMs != null ? `${p.fcpMs}ms` : '-', p?.fcpWarning],
        ['Memory', last ? `${Math.round(last.usedMB)}MB / ${Math.round(last.totalMB)}MB` : '-', m?.absoluteWarning || m?.ratioWarning],
        ['Leak', m?.potentialLeak ? 'suspected' : 'none', m?.potentialLeak]
    ]
        .map(([k, v, w]) => `<tr><td>${k}</td><td><b>${esc(v)}</b></td><td>${w ? '⚠️' : '✅'}</td></tr>`)
        .join('');
    return `<div class="section"><div class="header">📊 Performance</div><table>${rows}</table></div>`;
}

function stats(items) {
    return `<div class="stats">${items
        .map(([label, n, cls]) => `<div class="stat ${n > 0 ? cls : 'ok'}"><div class="n">${n}</div><div class="l">${label}</div></div>`)
        .join('')}</div>`;
}

function list(title, items, fmt) {
    if (!items?.length) return '';
    return `<details><summary>${title} (${items.length})</summary>${items
        .map((it, i) => `<div class="item"><span class="idx">#${i + 1}</span><div>${fmt(it)}${it.timestamp ? `<div class="meta">${esc(it.timestamp)}</div>` : ''}</div></div>`)
        .join('')}</details>`;
}

function esc(v) {
    return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const CSS = `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f9fa;color:#1a1a1a;padding:16px;font-size:13px}
.dashboard{max-width:780px;margin:0 auto}
.title{font-size:18px;font-weight:800;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #e2e8f0}
.section{background:#fff;border-radius:8px;padding:14px;margin-bottom:12px;border:1px solid #e2e8f0}
.header{font-size:15px;font-weight:700;margin-bottom:10px;color:#334155}
.criteria{padding:6px 10px;border-radius:6px;margin-bottom:4px}
.criteria.ok{background:#f0fdf4;color:#15803d}.criteria.bad{background:#fef2f2;color:#dc2626;font-weight:600}
.verdict{font-size:20px;font-weight:800;margin-bottom:6px}
.verdict.PASS{color:#16a34a}.verdict.WARNING{color:#d97706}.verdict.FAIL{color:#dc2626}
.summary{color:#475569;margin-bottom:4px}.meta{font-size:11px;color:#94a3b8}
.issues{margin:8px 0 0 18px}.empty{color:#94a3b8;padding:8px 0}
.stats{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px}
.stat{flex:1;min-width:90px;text-align:center;padding:10px 6px;border-radius:8px}
.stat .n{font-size:22px;font-weight:800}.stat .l{font-size:11px;color:#64748b}
.stat.ok{background:#f0fdf4;color:#16a34a}.stat.warn{background:#fffbeb;color:#d97706}.stat.bad{background:#fef2f2;color:#dc2626}
details{margin-top:8px}summary{cursor:pointer;font-weight:600;color:#6366f1;padding:4px 0}
.item{display:flex;gap:8px;padding:6px 8px;border-bottom:1px solid #f1f5f9;word-break:break-word}
.idx{font-size:11px;font-weight:700;color:#94a3b8;min-width:26px}
pre{font-size:11px;color:#64748b;background:#f8fafc;padding:6px;border-radius:4px;margin-top:4px;white-space:pre-wrap;word-break:break-all}
table{width:100%;border-collapse:collapse}td{padding:5px 8px;border-bottom:1px solid #f1f5f9}
`;
