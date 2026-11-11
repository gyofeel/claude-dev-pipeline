/** Single-file e2e-report.html. Visual style: e2e-report-redesign spec 2-6 and 2-7. */
import { labels, formatTime } from './labels.mjs';

const esc = (value) =>
    String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

const seconds = (ms) => (ms == null ? '—' : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);

const GATE_TONE = { defect: 'bad', rerun: 'bad', check: 'warn', ok: 'ok' };
const STATUS_TONE = {
    passed: 'ok',
    failed: 'bad',
    timedOut: 'bad',
    interrupted: 'bad',
    skipped: 'nil'
};
const STEP_TONE = {
    passed: 'ok',
    failed: 'bad',
    unreached: 'nil',
    'not-run': 'nil',
    unmarked: 'warn',
    soft: 'warn'
};
const AC_TONE = {
    passed: 'ok',
    failed: 'bad',
    unverified: 'nil',
    skipped: 'nil',
    missing: 'bad',
    'not-in-run': 'nil',
    unmapped: 'warn'
};

const dot = (tone) => `<span class="dot ${tone}"></span>`;

const CSS = `
:root{--bg:#fbfaf7;--surface:#f3f0e8;--line:#e7e4dc;--text:#1c1b19;--muted:#8a857a;--ok:#2f7d4f;--warn:#c98a12;--bad:#b4531a;--nil:#c5c0b4;
--sans:-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;--mono:"SF Mono",Menlo,monospace}
@media (prefers-color-scheme: dark){:root{--bg:#1a1917;--surface:#24221f;--line:#34312c;--text:#ece8df;--muted:#9a9488;--ok:#5fb383;--warn:#e0a83a;--bad:#e07a45;--nil:#5a564e}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 var(--sans)}
a{color:inherit}code,.mono{font-family:var(--mono);font-size:12px}
.bar{position:sticky;top:0;z-index:2;background:var(--bg);border-bottom:1px solid var(--line);padding:16px 0 12px}
.wrap{max-width:1100px;margin:0 auto;padding-left:28px;padding-right:28px}
.crumb{font-size:12px;color:var(--muted)}.crumb a{color:var(--muted)}
h1{font-size:20px;margin:2px 0 8px}
.verdict{display:flex;gap:16px;align-items:baseline;flex-wrap:wrap}
.verdict b{font-size:17px}.verdict b.ok{color:var(--ok)}.verdict b.warn{color:var(--warn)}.verdict b.bad{color:var(--bad)}
.counts{font-size:13px;color:var(--muted)}
main{padding-top:8px;padding-bottom:40px}
h2{font-size:12px;letter-spacing:.08em;color:var(--muted);margin:24px 0 8px;font-weight:700}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle;background:var(--nil)}
.dot.ok{background:var(--ok)}.dot.warn{background:var(--warn)}.dot.bad{background:var(--bad)}
ul.reasons{margin:0;padding-left:18px}
table{width:100%;border-collapse:collapse}td{padding:7px 6px;border-bottom:1px solid var(--line);vertical-align:top}
td.mono{white-space:nowrap}tr.link{cursor:pointer}tr.link:hover td{background:var(--surface)}
.muted{color:var(--muted)}.note{font-size:12px;color:var(--muted);margin-top:6px}
details.card{border-top:1px solid var(--line);padding:10px 0}
details.card>summary{cursor:pointer;list-style:none;display:flex;justify-content:space-between;gap:12px;font-weight:600}
details.card>summary::-webkit-details-marker{display:none}
.steps{list-style:none;margin:8px 0 0;padding:0;font-size:13px}
.steps li{display:grid;grid-template-columns:80px 1fr 110px 64px 120px;gap:8px;padding:3px 0;border-bottom:1px dashed var(--line);align-items:center}
.thumb{width:120px;border-radius:4px;border:1px solid var(--line);cursor:zoom-in}
dialog.zoom{padding:0;border:0;outline:none;background:transparent;max-width:none;max-height:none}dialog.zoom::backdrop{background:rgba(0,0,0,.75)}
dialog.zoom img{display:block;max-width:min(90vw,800px);max-height:85vh;border-radius:4px}dialog.zoom p{margin:8px 0 0;color:#fff;font-size:13px;text-align:center}
.steps .k{font-family:var(--mono);font-size:12px;color:var(--muted)}.steps .t{text-align:right;font-family:var(--mono);font-size:12px;color:var(--muted)}
.box{margin-top:10px;padding:10px 12px;background:var(--surface);border-radius:6px;font-size:13px}
.box pre{margin:6px 0 0;white-space:pre-wrap;word-break:break-all;font-family:var(--mono);font-size:12px}
.meta{font-size:12px;color:var(--muted);margin-top:8px}
details.sub{margin-top:8px;font-size:13px}details.sub>summary{cursor:pointer;color:var(--muted)}
details.sub ul{margin:4px 0;padding-left:18px}details.sub li{word-break:break-all}
footer{padding-bottom:32px;font-size:12px;color:var(--muted)}
`;

const header = (m, L) => {
    const tone = GATE_TONE[m.gate.level];
    const prev = m.prevHref ? ` · <a href="${esc(m.prevHref)}">${L.html.prevRun}</a>` : '';
    return `<header class="bar"><div class="wrap">
<div class="crumb">${esc(m.slug ?? m.tag)} · ${esc(formatTime(m.generatedAt))} · ${esc(m.runLabel)}${prev}</div>
<h1>${esc(m.title)}</h1>
<div class="verdict"><b class="${tone}">${esc(L.gate[m.gate.level])}</b>
<span class="counts">PASS ${m.counts.passed} · FAIL ${m.counts.failed} · SKIP ${m.counts.skipped}</span></div>
</div></header>`;
};

const conclusion = (m, L) => {
    const items = m.gate.reasons
        .map((r) => {
            const text = r.anchor ? `<a href="#${esc(r.anchor)}">${esc(r.text)}</a>` : esc(r.text);
            return `<li>${dot(GATE_TONE[r.level])}${text}</li>`;
        })
        .join('');
    const scope = m.partial?.filtered
        ? L.html.partialFiltered
        : `spec ${m.partial?.ran}/${m.partial?.total}`;
    const partial = m.partial
        ? `<div class="note">${L.html.partialNote(scope)}</div>`
        : '';
    const body = items
        ? `<ul class="reasons">${items}</ul>`
        : `<div class="muted">${L.html.nothingToCheck}</div>`;
    return `<h2>${L.html.conclusion}</h2>${body}${partial}`;
};

const acTable = (m, L) => {
    if (!m.hasTcMd) return '';
    const rows = m.acs
        .flatMap((ac) =>
            ac.rows.map((row) => {
                const cp = row.cpTotal ? ` ${row.cpPassed}/${row.cpTotal}` : '';
                const attrs = row.anchor
                    ? ` class="link" onclick="location.hash='${esc(row.anchor)}'"`
                    : '';
                const label = `${esc(row.tcId)} ${esc(row.tcName)}`;
                const name = row.anchor ? `<a href="#${esc(row.anchor)}">${label}</a>` : label;
                return `<tr${attrs}><td class="mono">${esc(ac.id)}</td><td>${esc(ac.text)}</td><td>${name}</td><td>${dot(AC_TONE[row.state])}${esc(L.acState[row.state])}${cp}</td></tr>`;
            })
        )
        .join('');
    const others = m.otherAcs.length
        ? `<div class="note">${L.html.notE2e} — ${m.otherAcs
              .map((ac) => `${esc(ac.id)} ${esc(L.acCategory[ac.category] ?? ac.category)}`)
              .join(' · ')}</div>`
        : '';
    return `<h2>${L.html.acCoverage}</h2><table>${rows}</table>${others}`;
};

const stepList = (t, L) =>
    `<ol class="steps">${t.timeline
        .map(
            (s) =>
                `<li><span class="k">${esc(s.key)}</span><span>${esc(s.desc ?? s.title)}${s.actual !== undefined ? ` <span class="muted">· ${L.html.actual}: ${esc(s.actual)}</span>` : ''}${s.softReason ? ` <span class="muted">· ${esc(s.softReason)}</span>` : ''}</span><span>${dot(STEP_TONE[s.state])}${esc(L.stepState[s.state])}</span><span class="t">${seconds(s.durationMs)}</span><span>${s.thumb ? `<img class="thumb" src="${esc(s.thumb)}" alt="${esc(s.key)}" data-caption="${esc(`${s.key} · ${s.desc ?? s.title}`)}">` : ''}</span></li>`
        )
        .join('')}</ol>`;

const failureBox = (t, L) => {
    if (t.failure) {
        const loc = t.failure.location
            ? ` (${esc(t.failure.location.file.split('/').pop())}:${t.failure.location.line})`
            : '';
        return `<div class="box"><b>${esc(L.failure[t.failure.kind])}</b>${loc}<pre>${esc(t.failure.message)}</pre></div>`;
    }
    if (t.status === 'skipped') {
        return `<div class="box">${esc(L.html.skipReason(t.skipReason))}</div>`;
    }
    return '';
};

const issuesBox = (t, L) =>
    t.issues.length
        ? `<div class="box"><b>${L.html.verdictBasis}</b><ul>${t.issues
              .map((i) => `<li>${esc(i.message)} — <code>${esc(i.detail)}</code></li>`)
              .join('')}</ul></div>`
        : '';

// Shown for every test carrying the list, so a setup failure in a marked file still names the unused mocks
const unusedMocksBox = (t, L) =>
    t.unusedMocks?.length
        ? `<div class="box"><b>${esc(L.failure['mock-unused'])}</b><ul>${t.unusedMocks.map((m) => `<li><code>${esc(m)}</code></li>`).join('')}</ul></div>`
        : '';

const mockLine = (t, L) => {
    const b = t.mockBoundary;
    const mock = b
        ? L.html.mockLine(b.fixture, b.emptyCount ?? b.empty.length, b.liveCount ?? b.live.length)
        : L.html.mockNone;
    return `<div class="meta">${esc(mock)} · <a href="index.html#?testId=${esc(t.id)}">${L.html.playwrightDetail}</a></div>`;
};

// Display only — never part of the gate
const apiLine = (t, L) => {
    const a = t.api;
    if (!a) return `<div class="meta">${L.html.apiNone}</div>`;
    const idle = a.idleCount ?? '—';
    const tone = a.duplicateCount || a.idleCount ? 'warn' : 'nil';
    return `<div class="meta">${dot(tone)}${L.html.apiLine(a.total, a.duplicateCount ?? '—', idle)}</div>${listOf(
        L.html.dupRequests,
        a.duplicates,
        (d) => `<code>${esc(d.key)}</code> ×${d.count}`
    )}${listOf(
        L.html.idleRequests,
        a.idle,
        (r) =>
            `<code>${esc(r.endpoint)}</code> <span class="muted">${L.html.afterInput(seconds(r.afterInputMs))}</span>`
    )}${listOf(L.html.byEndpoint, a.byEndpoint, (e) => `<code>${esc(e.endpoint)}</code> ×${e.count}`)}`;
};

const listOf = (title, items, render) =>
    items?.length
        ? `<details class="sub"><summary>${esc(title)} (${items.length})</summary><ul>${items.map((x) => `<li>${render(x)}</li>`).join('')}</ul></details>`
        : '';

const layer3 = (t, L) => {
    const r = t.runtime ?? {};
    const b = t.mockBoundary;
    return [
        listOf(
            L.html.excludedItems,
            t.excluded,
            (e) => `${esc(e.message)} <span class="muted">${esc(e.reason)}</span>`
        ),
        listOf(L.html.emptyApi, b?.empty, esc),
        listOf(L.html.liveApi, b?.live, esc),
        listOf(L.html.consoleErrors, r.consoleErrors, (e) => `<code>${esc(e.text)}</code>`),
        listOf(L.html.consoleWarnings, r.consoleWarnings, (e) => `<code>${esc(e.text)}</code>`),
        listOf(L.html.exceptions, r.exceptions, (e) => `<code>${esc(e.text ?? e.message)}</code>`),
        listOf(
            L.html.networkErrors,
            r.networkErrors,
            (e) => `<code>${esc(e.status)} ${esc(e.url)}</code>`
        )
    ].join('');
};

const card = (t, L) => {
    const loops = t.loops != null ? L.html.loops(t.loops) : '';
    const cps = t.timeline.filter((s) => s.key.startsWith('cp-'));
    const cpText = cps.length
        ? `${cps.filter((s) => s.state === 'passed').length}/${cps.length} · `
        : '';
    return `<details class="card" id="${esc(t.anchor)}"${t.attention ? ' open' : ''}>
<summary><span>${dot(STATUS_TONE[t.status] ?? 'nil')}${esc(t.label)}</span><span class="muted">${cpText}${seconds(t.durationMs)}${loops}</span></summary>
${stepList(t, L)}${failureBox(t, L)}${unusedMocksBox(t, L)}${issuesBox(t, L)}${mockLine(t, L)}${apiLine(t, L)}${layer3(t, L)}
</details>`;
};

// A 120px thumbnail opens the 800px trace frame in a modal; only the src moves, so images are not embedded twice
const ZOOM = `<dialog class="zoom" id="zoom"><img alt=""><p></p></dialog>
<script>
(() => {
    const zoom = document.getElementById('zoom');
    document.addEventListener('click', (e) => {
        const thumb = e.target.closest('.thumb');
        if (!thumb) return;
        zoom.querySelector('img').src = thumb.src;
        zoom.querySelector('p').textContent = thumb.dataset.caption || thumb.alt;
        zoom.showModal();
    });
    zoom.addEventListener('click', () => zoom.close());
})();
</script>`;

const hasThumbs = (m) => m.tests.some((t) => t.timeline.some((s) => s.thumb));

/** Renders the run model as one HTML document with no external resources. */
export function renderHtml(model) {
    const L = labels(model.locale, { platformLabel: model.platformLabel });
    return `<!doctype html>
<html lang="${L.htmlLang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(L.html.title(model.title))}</title><style>${CSS}</style></head>
<body>${header(model, L)}
<main class="wrap">${conclusion(model, L)}${acTable(model, L)}<h2>${L.html.tests}</h2>${model.tests.map((t) => card(t, L)).join('')}</main>
<footer class="wrap">${L.html.generated} ${esc(formatTime(model.generatedAt))} · <a href="index.html">${L.html.fullReport}</a></footer>
${hasThumbs(model) ? ZOOM : ''}</body></html>`;
}
export { CSS, esc };
