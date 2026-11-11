#!/usr/bin/env node
/**
 * surface-gate — reachability + vanished-token report. Report-only; never blocks.
 *
 * Unit tests pass even when a new function has zero call sites, so every gate can be green while
 * the feature is unreachable in the app. This script counts, straight from the commit trees:
 *
 * 1. Reachability — what the branch added that production code does not use:
 *    - new files no production file imports (framework auto-registered paths excluded)
 *    - new exports with zero references outside their definition, re-exports, comments and tests
 * 2. Vanished tokens — identifiers and path fragments on removed lines that no longer appear in
 *    head production code (comments ignored) but still appear under the spec paths. Renaming a
 *    query knob, endpoint or class silently kills existing specs; this surfaces it before E2E runs.
 *
 * Not detected: members added to existing files without an export line (store actions, returned
 * members); code that is wired to the wrong target. Reachability is necessary, not sufficient.
 *
 * Every search reads a commit tree via `git grep <ref>`, so past commits work without a checkout.
 *
 * Usage: node surface-gate.mjs [--base <ref>] [--state <state.json>] [--head <ref>]
 *
 * Base, first that resolves: --base · the run's `baseCommit` in --state (if still an ancestor of
 * head) · merge-base with origin/HEAD, main, master, develop. None → ok:false. The resolved base
 * and its source are in the output; reuse that base for later checks.
 *
 * Config (.agents/pipeline.config.json, all optional):
 *   surfaceGate.autoEntryPaths      repo-relative prefixes the framework registers by location
 *                                   (defaults added for ui.framework nuxt / next)
 *   surfaceGate.specPaths           where specs and their helpers live
 *                                   (default: e2e.specsDir, e2e.fixturesDir, e2e.kitDir)
 *   surfaceGate.nonProductionPaths  extra prefixes that are not production code
 *
 * Output: one JSON object on stdout. Exit code is always 0.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULTS, loadConfig } from './config-load.mjs';

const CODE_GLOBS = ['*.js', '*.mjs', '*.cjs', '*.ts', '*.jsx', '*.tsx', '*.vue', '*.svelte'];
const CONFIG_GLOBS = ['.env*', '*.yml', '*.yaml'];
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*|#|<!--)/;
const IDENT = /[A-Za-z_$][\w$]{5,}/g;
const ANY_IDENT = /[A-Za-z_$][\w$]*/g;
const PATH_FRAGMENT = /(?:\/[\w.-]+){2,}/g;
const FRAMEWORK_ENTRY = {
    nuxt: ['app/pages/', 'app/plugins/', 'app/layouts/', 'app/middleware/', 'pages/', 'plugins/', 'layouts/', 'middleware/', 'server/api/', 'server/routes/', 'server/plugins/', 'server/middleware/', 'modules/'],
    next: ['app/', 'pages/', 'middleware.']
};

const parseArgs = (argv) => {
    const args = { base: null, state: null, head: 'HEAD' };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--base') args.base = argv[++i];
        else if (a.startsWith('--base=')) args.base = a.slice(7);
        else if (a === '--state') args.state = argv[++i];
        else if (a.startsWith('--state=')) args.state = a.slice(8);
        else if (a === '--head') args.head = argv[++i];
        else if (a.startsWith('--head=')) args.head = a.slice(7);
    }
    return args;
};

const emit = (payload) => {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exit(0);
};

// Pathspecs are cwd-relative — always run from the repo root.
const ROOT = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim();

const git = (argv, input) => {
    const r = spawnSync('git', argv, { cwd: ROOT || undefined, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, input });
    // git grep exits 1 on zero matches — not an error
    if (r.status !== 0 && !(argv[0] === 'grep' && r.status === 1)) throw new Error(`git ${argv.slice(0, 3).join(' ')} failed: ${r.stderr.trim()}`);
    return r.stdout;
};

const buildContext = () => {
    const res = loadConfig(process.cwd());
    const cfg = res.resolved ?? DEFAULTS;
    const rel = (p) => (p && path.isAbsolute(p) ? path.relative(ROOT, p) : p);
    const sg = cfg.surfaceGate ?? {};
    const specPaths = (sg.specPaths ?? [cfg.e2e?.specsDir, cfg.e2e?.fixturesDir, cfg.e2e?.kitDir]).map(rel).filter(Boolean);
    const nonProdPrefixes = [...specPaths, rel(cfg.worksDir), '.agents', '.claude', ...(sg.nonProductionPaths ?? [])].filter(Boolean);
    const excludes = [':!*.test.*', ':!*.spec.*', ':!*.md', ...nonProdPrefixes.map((p) => `:!${p.replace(/\/$/, '')}/**`)];
    const framework = cfg.ui?.framework;
    return {
        prodSpec: [...CODE_GLOBS, ...CONFIG_GLOBS, ...excludes],
        codeSpec: [...CODE_GLOBS, ...excludes],
        specSpec: specPaths.map((p) => `${p.replace(/\/$/, '')}/`),
        autoEntry: [...(FRAMEWORK_ENTRY[framework] ?? []), ...(sg.autoEntryPaths ?? [])],
        componentsDir: cfg.ui?.componentsDir ? rel(cfg.ui.componentsDir) : null,
        configWarnings: res.ok ? [] : res.errors
    };
};

const parseGrepLine = (ref, raw) => {
    const m = /^(.*?):(\d+):(.*)$/.exec(raw.slice(ref.length + 1));
    return m ? { file: m[1], line: Number(m[2]), text: m[3] } : null;
};

const toLines = (ref, out) => out.split('\n').filter(Boolean).map((l) => parseGrepLine(ref, l)).filter(Boolean);

const grepLines = (ref, patterns, { word = false, pathspec }) =>
    patterns.length === 0 ? [] : toLines(ref, git(['grep', '-n', '-I', '-F', ...(word ? ['-w'] : []), '-f', '-', ref, '--', ...pathspec], patterns.join('\n')));

/** Every line of every text file under pathspec (empty-pattern git grep — tens of MB in ~0.1 s). */
const dumpLines = (ref, pathspec) => (pathspec.length === 0 ? [] : toLines(ref, git(['grep', '-n', '-I', '-e', '', ref, '--', ...pathspec])));

// ---------- 1. reachability ----------

// ponytail: finds the module specifier as text (file stem inside an import line). Aliases and barrels
// are not resolved, so a common stem can hide a miss. Swap for a real import graph if precision matters.
const specifierNeedles = (file) => {
    const parts = file.replace(/\.[^.]+$/, '').split('/');
    const stem = parts.at(-1);
    const dir = parts.at(-2);
    return stem === 'index' ? [`/${dir}'`, `/${dir}"`, `/${dir}/index`] : [`/${stem}'`, `/${stem}"`, `/${stem}.`];
};

const pascal = (s) => s.replace(/(^|[-_])(\w)/g, (_, __, c) => c.toUpperCase());
const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

// ponytail: approximates auto-registered component tag names — Nuxt style (path prefix + file name, prefix
// deduped when the file name starts with its directory name, index → directory name) and plain file name
// (unplugin-vue-components style). Extra evidence of use only: it can hide a miss, never add a false alarm.
const componentTags = (ctx, file) => {
    if (!ctx.componentsDir || !file.startsWith(`${ctx.componentsDir}/`) || !file.endsWith('.vue')) return [];
    const parts = file.slice(ctx.componentsDir.length + 1, -4).split('/').map(pascal);
    if (parts.at(-1) === 'Index') parts.pop();
    const deduped = parts.reduce((acc, p, i) => (i > 0 && p.startsWith(parts[i - 1]) ? acc.slice(0, -parts[i - 1].length) + p : acc + p), '');
    return [...new Set([parts.join(''), deduped, parts.at(-1)])].flatMap((n) => [`<${n}`, `<${kebab(n)}`]);
};

const unreachableFiles = (ctx, base, head) =>
    git(['diff', '--name-only', '--diff-filter=A', base, head, '--', ...ctx.codeSpec])
        .split('\n')
        .filter(Boolean)
        .filter((f) => !ctx.autoEntry.some((p) => f.startsWith(p)))
        .filter((file) => {
            const imports = grepLines(head, specifierNeedles(file), { pathspec: ctx.prodSpec }).filter(
                (h) => h.file !== file && !COMMENT_LINE.test(h.text) && /\b(import|from|require)\b/.test(h.text)
            );
            if (imports.length > 0) return false;
            return grepLines(head, componentTags(ctx, file), { pathspec: ctx.prodSpec }).filter((h) => h.file !== file).length === 0;
        });

const EXPORT_DECL = /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/;
const EXPORT_LIST = /^\s*export\s*\{([^}]*)\}\s*;?\s*$/;
const REEXPORT = /^\s*export\b.*\bfrom\s+['"]/;

/** Added (+, new path) or removed (-, old path) diff lines; a deleted file has +++ /dev/null. */
const diffLines = (ctx, base, head, sign) => {
    const out = git(['diff', '-U0', '--no-color', base, head, '--', ...ctx.prodSpec]);
    const header = sign === '+' ? '+++ ' : '--- ';
    const prefix = sign === '+' ? '+++ b/' : '--- a/';
    const rows = [];
    let file = null;
    for (const l of out.split('\n')) {
        if (l.startsWith('+++ ') || l.startsWith('--- ')) {
            if (l.startsWith(header)) file = l.startsWith(prefix) ? l.slice(prefix.length) : null;
        } else if (file && l.startsWith(sign)) rows.push({ file, text: l.slice(1) });
    }
    return rows;
};

const exportedNames = (text) => {
    const d = EXPORT_DECL.exec(text);
    if (d) return [d[1]];
    const l = EXPORT_LIST.exec(text);
    return l ? l[1].split(',').map((s) => s.trim().split(/\s+as\s+/).at(-1)).filter(Boolean) : [];
};

const unreferencedExports = (ctx, base, head) => {
    const candidates = new Map();
    for (const r of diffLines(ctx, base, head, '+').filter((r) => !TEST_FILE.test(r.file))) {
        for (const name of exportedNames(r.text)) candidates.set(name, r.file);
    }
    if (candidates.size === 0) return [];
    // already exported under the same name at base → not new (e.g. a signature change)
    const existedBefore = new Set(
        grepLines(base, [...candidates.keys()], { word: true, pathspec: ctx.prodSpec })
            .filter((h) => candidates.get(exportedNames(h.text)[0]) === h.file)
            .map((h) => exportedNames(h.text)[0])
    );
    const refs = grepLines(head, [...candidates.keys()], { word: true, pathspec: ctx.prodSpec });
    const result = [];
    for (const [name, file] of candidates) {
        if (existedBefore.has(name)) continue;
        const re = new RegExp(`(?<![\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$])`);
        const uses = refs.filter((h) => re.test(h.text) && !COMMENT_LINE.test(h.text) && !REEXPORT.test(h.text) && !(h.file === file && exportedNames(h.text).includes(name)));
        if (uses.length === 0) result.push({ name, file });
    }
    return result;
};

// ---------- 2. vanished tokens ----------

const subPaths = (p) => {
    const segs = p.split('/').filter(Boolean);
    const out = [];
    for (let i = 0; i < segs.length; i++) for (let j = i + 2; j <= segs.length; j++) out.push(`/${segs.slice(i, j).join('/')}`);
    return out;
};

const vanishedTokens = (ctx, base, head) => {
    if (ctx.specSpec.length === 0) return [];
    const idents = new Set();
    const paths = new Set();
    for (const { text } of diffLines(ctx, base, head, '-').filter((r) => !TEST_FILE.test(r.file) && !COMMENT_LINE.test(r.text))) {
        for (const m of text.matchAll(IDENT)) idents.add(m[0]);
        for (const m of text.matchAll(PATH_FRAGMENT)) for (const s of subPaths(m[0])) paths.add(s);
    }
    // Anything still present in head production code (outside comments) has not vanished.
    // Passing thousands of patterns to `git grep -f` costs >10 s per call — dump the tree once instead.
    const liveIdents = new Set();
    const livePaths = new Set();
    for (const h of dumpLines(head, ctx.prodSpec)) {
        if (COMMENT_LINE.test(h.text)) continue;
        for (const m of h.text.matchAll(ANY_IDENT)) liveIdents.add(m[0]);
        for (const m of h.text.matchAll(PATH_FRAGMENT)) for (const s of subPaths(m[0])) livePaths.add(s);
    }
    const goneIdents = new Set([...idents].filter((t) => !liveIdents.has(t)));
    const gonePaths = new Set([...paths].filter((p) => !livePaths.has(p)));

    const byToken = new Map();
    const record = (token, h) => {
        if (!byToken.has(token)) byToken.set(token, []);
        const list = byToken.get(token);
        if (!list.some((x) => x.file === h.file && x.line === h.line)) list.push({ file: h.file, line: h.line, comment: COMMENT_LINE.test(h.text), text: h.text.trim().slice(0, 160) });
    };
    for (const h of dumpLines(head, ctx.specSpec)) {
        for (const m of h.text.matchAll(ANY_IDENT)) if (goneIdents.has(m[0])) record(m[0], h);
        for (const m of h.text.matchAll(PATH_FRAGMENT)) for (const s of subPaths(m[0])) if (gonePaths.has(s)) record(s, h);
    }
    // drop a shorter sub-path when a longer path already reports the same lines
    const sameHits = (a, b) => b.every((x) => a.some((y) => y.file === x.file && y.line === x.line));
    const tokens = [...byToken.keys()];
    return tokens
        .filter((t) => !(t.startsWith('/') && tokens.some((o) => o !== t && o.startsWith('/') && o.includes(t) && sameHits(byToken.get(o), byToken.get(t)))))
        .map((token) => ({ token, specHits: byToken.get(token) }));
};

// ---------- main ----------

const tryGit = (argv) => {
    const r = spawnSync('git', argv, { cwd: ROOT || undefined, encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : null;
};

// The default branch name varies (main, master, develop, release lines), so the run records its start.
const resolveBase = (args) => {
    if (args.base) return { ref: args.base, source: '--base' };
    if (args.state) {
        let start = null;
        try {
            start = JSON.parse(readFileSync(args.state, 'utf8')).baseCommit ?? null;
        } catch {}
        if (start && tryGit(['merge-base', '--is-ancestor', start, args.head]) !== null) return { ref: start, source: 'state.baseCommit' };
    }
    const originHead = tryGit(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
    for (const branch of [originHead, 'main', 'master', 'develop'].filter(Boolean)) {
        const mb = tryGit(['merge-base', args.head, branch]);
        if (mb) return { ref: mb, source: `merge-base ${branch}` };
    }
    return null;
};

const main = () => {
    const args = parseArgs(process.argv.slice(2));
    const resolved = resolveBase(args);
    if (!resolved) emit({ ok: false, error: 'base commit not found (no baseCommit in state, no origin/HEAD, main, master or develop); pass --base <ref>' });
    const ctx = buildContext();
    const base = git(['rev-parse', '--short', resolved.ref]).trim();
    const head = git(['rev-parse', '--short', args.head]).trim();
    const files = unreachableFiles(ctx, base, head);
    const exports = unreferencedExports(ctx, base, head);
    emit({
        ok: true,
        base,
        baseSource: resolved.source,
        head,
        reachability: { unreachableFiles: files, unreferencedExports: exports },
        vanishedTokens: vanishedTokens(ctx, base, head),
        question: files.length + exports.length > 0 ? 'These files/exports are not wired into production code yet — is that intended?' : null,
        limits: [
            'Members added to existing files without an export line (store actions, returned members) are not detected',
            'Code with call sites that targets the wrong thing (e.g. a wrong endpoint) is not detected'
        ],
        specPaths: ctx.specSpec,
        configWarnings: ctx.configWarnings
    });
};

try {
    main();
} catch (e) {
    emit({ ok: false, error: String(e?.message ?? e) });
}
