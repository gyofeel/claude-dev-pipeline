/** Run summary kept in git. Thumbnails and raw runtime data live only in e2e-report.html. */
import { labels, formatTime } from './labels.mjs';
import { REPORT_FILE } from './latest.mjs';

const cell = (value) =>
    String(value ?? '')
        .replace(/\|/g, '\\|')
        .replace(/\n/g, ' ');
const seconds = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)}s`);
const resultText = (t, L) => {
    const text = t.failure ? L.failure[t.failure.kind] : (L.md.status[t.status] ?? t.status);
    // Backticks keep `**` in a glob from reading as bold
    return t.unusedMocks?.length ? `${text}: ${t.unusedMocks.map((g) => `\`${g}\``).join(', ')}` : text;
};

/** Renders the run model as Markdown. */
export function renderMd(model, { archivePath, openCommand }) {
    const L = labels(model.locale);
    const lines = [
        L.md.heading(model.title),
        '',
        `- ${L.md.conclusion}: **${L.gate[model.gate.level]}**`,
        `- ${L.md.ran}: ${formatTime(model.generatedAt)} · ${model.runLabel}`,
        `- ${L.md.results}: PASS ${model.counts.passed} · FAIL ${model.counts.failed} · SKIP ${model.counts.skipped}`,
        `- ${L.md.detail(`${archivePath}/${REPORT_FILE}`, openCommand)}`,
        ''
    ];

    if (model.gate.reasons.length) {
        lines.push(`## ${L.md.conclusionDetail}`, '', ...model.gate.reasons.map((r) => `- ${r.text}`), '');
    }

    lines.push(`## ${L.md.acCoverage}`, '', ...L.md.acHeader);
    for (const ac of model.acs) {
        for (const row of ac.rows) {
            const cp = row.cpTotal ? ` ${row.cpPassed}/${row.cpTotal}` : '';
            lines.push(
                `| ${ac.id} | ${cell(ac.text)} | ${row.tcId} ${cell(row.tcName)} | ${L.acState[row.state]}${cp} |`
            );
        }
    }
    if (model.otherAcs.length) {
        const others = model.otherAcs
            .map((ac) => `${ac.id} ${L.acCategory[ac.category] ?? ac.category}`)
            .join(' · ');
        lines.push('', `${L.md.notE2e}: ${others}`);
    }

    lines.push(
        '',
        `## ${L.md.tests}`,
        '',
        ...L.md.testHeader
    );
    for (const t of model.tests) {
        const cps = t.timeline.filter((s) => s.key.startsWith('cp-'));
        const cp = `${cps.filter((s) => s.state === 'passed').length}/${cps.length}`;
        const req = t.api ? L.md.requests(t.api.total, t.api.duplicateCount ?? '—') : '—';
        lines.push(
            `| ${t.tcId ?? '—'} | ${cell(t.title)} | ${cell(resultText(t, L))} | ${cp} | ${req} | ${seconds(t.durationMs)} | ${t.loops ?? '—'} |`
        );
    }
    return `${lines.join('\n')}\n`;
}
