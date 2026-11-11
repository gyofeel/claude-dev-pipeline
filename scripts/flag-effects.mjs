/**
 * flag-effects — finds values other code writes while a shared flag, set by the file being changed, is
 * true (for tc-extract).
 *
 * If a guard-like flag stays true for a different duration, code in other files that runs only while it
 * is true runs longer or more often. If that code writes other state (e.g. disables a button per key
 * press), restoring the flag does not restore that state. Sibling files alone do not reveal this coupling.
 *
 * Usage:
 *   node scripts/flag-effects.mjs <file to change> [<file to change> ...]
 * Output (stdout): [{ flag, file, line, condition, writes: [written names] }]   or   { error: 'no-targets' }
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config-load.mjs';
import { sourceFiles } from './field-consumers.mjs';
import { listSourceFiles } from './lib/source-scan.mjs';

// Only assignments on an object (`obj.flag = true|false`): locals are unreadable from other files,
// and a Vue ref's `.value` is not a flag name
const assignedFlags = (text) =>
    [...text.matchAll(/[\w$]+\.([\w$]+)\s*=\s*(?:true|false)\b/g)]
        .map((m) => m[1])
        .filter((name) => name !== 'value');

const blockFrom = (text, open) => {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}' && --depth === 0) return text.slice(open, i + 1);
    }
    return '';
};

// Left-hand name of an assignment, or the first key of an object passed to a store update call
const WRITE = /([\w$.]+)\s*=(?!=)|\b(?:update\w*|set[A-Z]\w*|\$patch)\s*\(\s*\{\s*([\w$]+)\s*:/g;

/**
 * For each shared flag the changed files assign, the names written by blocks in other files that run
 * while the flag is true. `sourceList` is the listSourceFiles() file list; empty → { error: 'no-targets' }.
 */
export const findFlagEffects = (files, root = process.cwd(), sourceList = []) => {
    const sources = sourceFiles(sourceList, root);
    if (!sources.length) return { error: 'no-targets' };
    const targets = new Set(files.map((f) => path.normalize(f)));
    const flags = new Set(
        files.flatMap((f) => assignedFlags(readFileSync(path.join(root, f), 'utf8')))
    );
    const effects = [];
    for (const { file, text } of sources) {
        if (targets.has(path.normalize(file))) continue;
        for (const flag of flags) {
            if (!text.includes(flag)) continue;
            const truthy = new RegExp(`(^|[^!\\w$])[\\w$]*\\.${flag}\\b(?!\\s*===?\\s*false)`);
            for (const m of text.matchAll(/\bif\s*\(([^)]*)\)\s*\{/g)) {
                if (!truthy.test(m[1])) continue;
                const body = blockFrom(text, m.index + m[0].length - 1);
                const writes = [
                    ...new Set(
                        [...body.matchAll(WRITE)].map((w) => (w[1] ?? w[2]).split('.').pop())
                    )
                ];
                if (!writes.length) continue;
                effects.push({
                    flag,
                    file,
                    line: text.slice(0, m.index).split('\n').length,
                    condition: m[1].trim(),
                    writes
                });
            }
        }
    }
    return effects;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const files = process.argv.slice(2);
    if (!files.length) {
        process.stderr.write(
            'Usage: node scripts/flag-effects.mjs <file to change> [<file to change> ...]\n'
        );
        process.exit(1);
    }
    const cfg = loadConfig();
    if (!cfg.ok) {
        process.stderr.write(`${cfg.errors.join('\n')}\n`);
        process.exit(1);
    }
    const { files: sourceList, error } = listSourceFiles(cfg.root, cfg.resolved);
    const out = error ? { error } : findFlagEffects(files, cfg.root, sourceList);
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    if (out.error) process.exit(1);
}
