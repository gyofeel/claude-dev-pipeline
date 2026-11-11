/**
 * field-consumers — finds existing code that already reads an input field (for tc-extract in new mode).
 *
 * Code for a new feature takes its conventions from sibling files. Siblings alone miss other paths that
 * already split or interpret the same payload field (e.g. a code string in a response) and a new parser
 * gets designed. This script scans production code by field name and separates lines that split or
 * interpret the field (parsers) from files that merely mention it (others).
 *
 * For each split it also reports which segment is read (segments) and the enclosing function (fn),
 * because a new branch that takes only some segments makes the same input read differently per path.
 *
 * Usage:
 *   node scripts/field-consumers.mjs <field> [<field> ...]
 * Output (stdout): [{ field, parsers: [{ file, line, text, fn, segments: [{ delimiter, index, line, text }] }],
 *                    others: [{ file, count }] }]   or   { error: 'no-targets' }
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config-load.mjs';
import { listSourceFiles } from './lib/source-scan.mjs';

const SKIP_FILE = /\.(test|spec)\.[mc]?[jt]sx?$/;
const SKIP_DIR = /(^|\/)(mocks|\.nuxt|\.output)\//;

const parserRe = (field) =>
    new RegExp(
        `\\b${field}\\??\\.(split|match|replace|slice|substring|startsWith|indexOf)\\(|JSON\\.parse\\([^)]*\\b${field}\\b`
    );

const indent = (l) => l.match(/^\s*/)[0].length;
const KEYWORD = /^(if|for|while|switch|catch|return)$/;

// Name of the function enclosing the parsing line (method, arrow, or function declaration)
const fnOf = (lines, i) => {
    // A one-line arrow function is its own definition
    const inline = /(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>/.exec(
        lines[i]
    )?.[1];
    if (inline) return inline;
    let limit = indent(lines[i]);
    for (let j = i - 1; j >= 0; j--) {
        if (!lines[j].trim() || indent(lines[j]) >= limit) continue;
        limit = indent(lines[j]);
        const name =
            /^\s*(?:static\s+)?(?:async\s+)?(#?[A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/.exec(
                lines[j]
            )?.[1] ??
            /(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>/.exec(
                lines[j]
            )?.[1] ??
            /function\s+([\w$]+)/.exec(lines[j])?.[1];
        if (name && !KEYWORD.test(name)) return name;
    }
    return null;
};

// Segments read from a split: a direct [n], x[n] / x[x.length - n] on the variable it was stored in
// within the same block, or array destructuring
const segmentsOf = (lines, i, field) => {
    const l = lines[i];
    const m = new RegExp(`\\b${field}\\??\\.split\\(\\s*(['"\`])(.+?)\\1\\s*\\)`).exec(l);
    if (!m) return [];
    const delimiter = m[2];
    const at = (index, j) => ({ delimiter, index, line: j + 1, text: lines[j].trim() });
    const direct = /^\s*(?:\?\.)?\[(\d+)\]/.exec(l.slice(m.index + m[0].length));
    if (direct) return [at(`[${direct[1]}]`, i)];
    const before = l.slice(0, m.index);
    const destructured = /\[([^\]]*)\]\s*=\s*[\w$.?]*$/.exec(before);
    if (destructured)
        return destructured[1]
            .split(',')
            .map((n, k) => (n.trim() ? at(`[${k}]`, i) : null))
            .filter(Boolean);
    const name = /([\w$]+)\s*=\s*[\w$.?]*$/.exec(before)?.[1];
    if (!name) return [];
    const read = new RegExp(`\\b${name}\\[(?:(\\d+)|${name}\\.length\\s*-\\s*(\\d+))\\]`, 'g');
    const found = new Map();
    for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() && indent(lines[j]) < indent(l)) break;
        for (const r of lines[j].matchAll(read)) {
            const index = r[1] !== undefined ? `[${r[1]}]` : `[-${r[2]}]`;
            if (!found.has(index)) found.set(index, at(index, j));
        }
    }
    return [...found.values()];
};

/** Production files (tests and mocks excluded) from a listSourceFiles list, with their text. */
export const sourceFiles = (files, root = process.cwd()) =>
    files
        .filter((f) => !SKIP_FILE.test(f) && !SKIP_DIR.test(f))
        .map((file) => ({ file, text: readFileSync(path.join(root, file), 'utf8') }));

/**
 * Per field, the parsers and the mentioning files. Paths are relative to root.
 * `files` is the listSourceFiles() result; empty (after excluding tests/mocks) → { error: 'no-targets' }.
 */
export const findConsumers = (fields, root = process.cwd(), files = []) => {
    const sources = sourceFiles(files, root).map(({ file, text }) => ({
        file,
        lines: text.split('\n')
    }));
    if (!sources.length) return { error: 'no-targets' };
    return fields.map((field) => {
        const mention = new RegExp(`\\b${field}\\b`);
        const parse = parserRe(field);
        const parsers = [];
        const counts = new Map();
        for (const { file, lines } of sources) {
            lines.forEach((text, i) => {
                if (!mention.test(text)) return;
                if (parse.test(text))
                    parsers.push({
                        file,
                        line: i + 1,
                        text: text.trim(),
                        fn: fnOf(lines, i),
                        segments: segmentsOf(lines, i, field)
                    });
                else counts.set(file, (counts.get(file) ?? 0) + 1);
            });
        }
        const byFile = (a, b) => a.file.localeCompare(b.file);
        const others = [...counts].map(([file, count]) => ({ file, count })).sort(byFile);
        return { field, parsers: parsers.sort(byFile), others };
    });
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const fields = process.argv.slice(2);
    if (!fields.length) {
        process.stderr.write('Usage: node scripts/field-consumers.mjs <field> [<field> ...]\n');
        process.exit(1);
    }
    const cfg = loadConfig();
    if (!cfg.ok) {
        process.stderr.write(`${cfg.errors.join('\n')}\n`);
        process.exit(1);
    }
    const { files, error } = listSourceFiles(cfg.root, cfg.resolved);
    const out = error ? { error } : findConsumers(fields, cfg.root, files);
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    if (out.error) process.exit(1);
}
