/**
 * plan-context — attach each plan task's development layers and the runner's style file as a context step
 *
 *   node plan-context.mjs --plan <plan> [--style <name>] [--catalog <f>]
 *
 * Edits the plan in place (re-running gives the same result) and prints a JSON report.
 * When no style file can be picked it changes nothing and prints {"style":null,"skipped":true}.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadCatalog, resolveLayers, styleConfig } from './resolve-layer.mjs';

const CONTEXT_HEAD = '- [ ] Read context';
const FENCE = /^\s*(`{3,}|~{3,})/;
const TASK = /^### Task (\d+)/;
const FILES = /^\s*-\s*(Create|Modify):\s*`?([^`\s]+)`?/;
const STYLE_LINE = /^\*\*Style:\*\*\s*`?([^`\s]+)`?/;
const FULL_REPLACE = /^\s*(?:[-*]\s+)?\*\*Full replacement:\*\*/;
const NO_CATALOG = { excluded: [], layers: [] };

// CommonMark: a fence closes only on the same character, at least as long, with nothing after it
const fenceTracker = () => {
    let open = null;
    return (line) => {
        const m = FENCE.exec(line);
        if (!open) open = m ? m[1] : null;
        else if (m && m[1][0] === open[0] && m[1].length >= open.length && /^\s*[`~]+\s*$/.test(line))
            open = null;
        return open !== null;
    };
};

const emailsOf = (text) =>
    (/^emails:\s*\[(.*)\]/m.exec(text)?.[1] ?? '').split(',').map((e) => e.trim());

/** Pick the style file: argument → plan header → file listing the git email → defaultStyle → null */
export const pickStyle = ({ style, planStyle, email, stylesDir, files, defaultStyle = null }) => {
    const file = (name) => path.join(stylesDir, `${name.replace(/\.md$/, '')}.md`);
    if (style) {
        const p = file(style);
        if (!(p in files)) throw new Error(`style file not found: ${p}`);
        return p;
    }
    if (planStyle) return planStyle;
    const hit = Object.keys(files)
        .sort()
        .find((p) => email && emailsOf(files[p]).includes(email));
    if (hit) return hit;
    return defaultStyle ? file(defaultStyle) : null;
};

export const readPlanStyle = (text) => {
    for (const line of text.split('\n')) {
        if (TASK.test(line)) return undefined;
        const m = STYLE_LINE.exec(line);
        if (m) return m[1];
    }
    return undefined;
};

const styleSections = (styleText, catalog) => {
    const ids = new Set(catalog.layers.map((l) => l.id));
    const layer = new Map();
    const free = [];
    const inFence = fenceTracker();
    for (const line of styleText.split('\n')) {
        if (inFence(line) || !line.startsWith('## ')) continue;
        const id = line.slice(3).trim().split(' — ')[0];
        if (ids.has(id)) layer.set(id, line.trim());
        else free.push(line.trim());
    }
    return { layer, free };
};

// drop a previous context step and Style line so re-running yields the same plan
const strip = (lines) => {
    const out = [];
    const fence = fenceTracker();
    let seenTask = false;
    let inBlock = false;
    for (const line of lines) {
        const inFence = fence(line);
        if (!inFence && TASK.test(line)) seenTask = true;
        if (inBlock && /^ {2}- /.test(line)) continue;
        inBlock = false;
        if (!inFence && line.startsWith(CONTEXT_HEAD)) {
            inBlock = true;
            continue;
        }
        if (!inFence && !seenTask && STYLE_LINE.test(line)) continue;
        out.push(line);
    }
    return out;
};

const contextBlock = (task, { layersDir, stylePath, sections, catalog }) => {
    const byId = new Map(catalog.layers.map((l) => [l.id, l]));
    const block = [
        `${CONTEXT_HEAD} — tendencies, not rules. Gates, the pipeline contract and project rules come first`
    ];
    if (task.layers.length)
        block.push(
            `  - Layer: ${task.layers
                .map((id) => `\`${id}\` → \`${path.join(layersDir, byId.get(id).doc)}\``)
                .join(', ')}`
        );
    const parts = [];
    const own = task.layers.filter((id) => sections.layer.has(id));
    if (own.length) parts.push(`${own.map((id) => `\`${sections.layer.get(id)}\``).join(' · ')} section`);
    if (sections.free.length) parts.push(`free sections ${sections.free.map((h) => `\`${h}\``).join(' · ')}`);
    block.push(`  - Style: \`${stylePath}\`${parts.length ? ` — ${parts.join(', ')}` : ''}`);
    block.push('  - New files (Create) follow this style. Existing files (Modify) follow the surrounding code first');
    return block;
};

/** Plan text with the Style header and per-task context steps, plus a report */
export const annotatePlan = (text, { catalog, layersDir, stylePath, styleText, readFile = () => undefined }) => {
    const cat = catalog ?? NO_CATALOG;
    const lines = strip(text.split('\n'));
    const sections = styleSections(styleText, cat);
    const isExcluded = (f) => (cat.excluded ?? []).some((g) => path.matchesGlob(f, g));

    const tasks = [];
    const unmapped = [];
    const fullReplace = [];
    let specAt = -1;
    let h1At = -1;
    const inFence = fenceTracker();
    let cur = null;
    lines.forEach((line, i) => {
        if (inFence(line)) return;
        const t = TASK.exec(line);
        if (t) {
            cur = { n: Number(t[1]), layers: [], create: [], modify: [], insertAt: -1 };
            tasks.push(cur);
            return;
        }
        if (/^## /.test(line)) cur = null;
        if (!tasks.length) {
            if (h1At < 0 && /^# /.test(line)) h1At = i;
            if (specAt < 0 && /^\*\*Spec:\*\*/.test(line)) specAt = i;
        }
        if (!cur) return;
        if (FULL_REPLACE.test(line)) fullReplace.push(cur.n);
        if (cur.insertAt < 0 && /^- \[ \]/.test(line)) cur.insertAt = i;
        const f = FILES.exec(line);
        if (!f) return;
        const file = f[2].replace(/:\d+(-\d+)?$/, '');
        cur[f[1] === 'Create' ? 'create' : 'modify'].push(file);
        if (!catalog) return;
        const found = resolveLayers(file, cat, {
            content: f[1] === 'Modify' ? readFile(file) : undefined
        });
        if (!found.length && !isExcluded(file)) unmapped.push(file);
        for (const id of found) if (!cur.layers.includes(id)) cur.layers.push(id);
    });

    const inserts = tasks
        .filter((t) => t.insertAt >= 0)
        .map((t) => [t.insertAt, contextBlock(t, { layersDir, stylePath, sections, catalog: cat })]);
    let headerAt = h1At + 1;
    if (specAt >= 0) {
        headerAt = specAt + 1;
        while (headerAt < lines.length && lines[headerAt].trim() !== '') headerAt++;
    }
    if (h1At >= 0 || specAt >= 0) inserts.push([headerAt, [`**Style:** \`${stylePath}\``]]);
    for (const [at, block] of inserts.sort((a, b) => b[0] - a[0])) lines.splice(at, 0, ...block);

    const noLayerSection = [];
    for (const t of tasks)
        for (const id of t.layers)
            if (!sections.layer.has(id) && !noLayerSection.includes(id)) noLayerSection.push(id);

    return {
        text: lines.join('\n'),
        report: {
            style: stylePath,
            tasks: tasks.map(({ n, layers, create, modify }) => ({ n, layers, create, modify })),
            unmapped,
            noLayerSection,
            fullReplace
        }
    };
};

const USAGE = 'usage: plan-context.mjs --plan <plan> [--style <name>] [--catalog <f>]';

const main = (argv) => {
    const arg = (name) => {
        const at = argv.indexOf(name);
        return at > -1 ? argv[at + 1] : undefined;
    };
    const plan = arg('--plan');
    if (!plan || !existsSync(plan)) throw new Error(`plan not found\n${USAGE}`);
    const style = styleConfig();
    const catalogFile = arg('--catalog') ?? path.join(style.layersDir, 'catalog.json');
    const stylesDir = path.relative(process.cwd(), path.resolve(style.stylesDir)) || '.';
    const files = existsSync(stylesDir)
        ? Object.fromEntries(
              readdirSync(stylesDir)
                  .filter((f) => f.endsWith('.md'))
                  .map((f) => [path.join(stylesDir, f), readFileSync(path.join(stylesDir, f), 'utf8')])
          )
        : {};
    const text = readFileSync(plan, 'utf8');
    const email = spawnSync('git', ['config', 'user.email'], { encoding: 'utf8' }).stdout?.trim();
    const stylePath = pickStyle({
        style: arg('--style'),
        planStyle: readPlanStyle(text),
        email,
        stylesDir,
        files,
        defaultStyle: style.defaultStyle
    });
    if (!stylePath) {
        console.log(JSON.stringify({ style: null, skipped: true }));
        return;
    }
    if (!existsSync(stylePath)) throw new Error(`style file not found: ${stylePath}`);
    const layersDir = path.relative(process.cwd(), path.dirname(path.resolve(catalogFile))) || '.';
    const { text: next, report } = annotatePlan(text, {
        catalog: existsSync(catalogFile) ? loadCatalog(catalogFile) : null,
        layersDir,
        stylePath,
        styleText: readFileSync(stylePath, 'utf8'),
        readFile: (f) => (existsSync(f) ? readFileSync(f, 'utf8') : undefined)
    });
    if (next !== text) writeFileSync(plan, next);
    console.log(JSON.stringify(report, null, 2));
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        main(process.argv.slice(2));
    } catch (e) {
        console.error(e.message);
        process.exitCode = 2;
    }
}
