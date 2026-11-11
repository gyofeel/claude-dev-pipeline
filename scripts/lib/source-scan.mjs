/**
 * source-scan — source file listing and import-alias resolution driven by config
 * (`source.roots`, `source.extensions`, `source.aliases`), never by hardcoded project roots.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SKIP_DIR = new Set(['node_modules', '.git']);

/** Source files under `source.roots` as repo-relative paths. Zero files is an error, not a pass. */
export const listSourceFiles = (root, config) => {
    const { roots, extensions } = config.source;
    const walk = (dir) => {
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            return [];
        }
        return entries.flatMap((e) => {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) return SKIP_DIR.has(e.name) ? [] : walk(full);
            return extensions.some((x) => e.name.endsWith(x)) ? [full] : [];
        });
    };
    const files = roots.flatMap((r) => walk(path.join(root, r))).map((f) => path.relative(root, f));
    return files.length ? { files } : { files: [], error: 'no-targets' };
};

// tsconfig allows comments and trailing commas; strings (e.g. "@/*", "src/**") may contain `//` or `/*`
const parseJsonc = (text) =>
    JSON.parse(
        text
            .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) =>
                m.startsWith('"') ? m : ''
            )
            .replace(/,(\s*[}\]])/g, '$1')
    );

// Aliases from one tsconfig-like file (repo-relative name); null when it has no compilerOptions.paths
const aliasesOf = (root, name) => {
    const { compilerOptions = {}, references } = parseJsonc(readFileSync(path.join(root, name), 'utf8'));
    const { paths, baseUrl = '.' } = compilerOptions;
    if (!paths) return { aliases: null, references };
    const aliases = {};
    for (const [key, [target]] of Object.entries(paths)) {
        if (!key.endsWith('*') || !target?.endsWith('*')) continue;
        aliases[key.slice(0, -1)] = path.posix.join(path.posix.dirname(name), baseUrl, target.slice(0, -1));
    }
    return { aliases };
};

/**
 * Alias prefix → repo-relative target. `source.aliases` wins over tsconfig/jsconfig `paths`.
 * A solution-style root (Vite templates) keeps `paths` in its `references`; those are read one level deep.
 */
export const readAliases = (root, config) => {
    const explicit = config.source.aliases;
    if (explicit) return { aliases: { ...explicit } };
    for (const name of ['tsconfig.json', 'jsconfig.json']) {
        if (!existsSync(path.join(root, name))) continue;
        let found;
        try {
            found = aliasesOf(root, name);
            if (!found.aliases && found.references) {
                const merged = {};
                for (const ref of found.references) {
                    let rel = path.posix.normalize(ref.path ?? '');
                    if (!rel.endsWith('.json')) rel = path.posix.join(rel, 'tsconfig.json');
                    if (!existsSync(path.join(root, rel))) continue;
                    for (const [k, v] of Object.entries(aliasesOf(root, rel).aliases ?? {}))
                        merged[k] ??= v;
                }
                if (Object.keys(merged).length) found = { aliases: merged };
            }
        } catch {
            return { aliases: {}, warning: `${name} could not be parsed` };
        }
        if (found.aliases) return { aliases: found.aliases };
        return {
            aliases: {},
            warning: `${name} has no compilerOptions.paths (extends is not followed); set source.aliases`
        };
    }
    return { aliases: {}, warning: 'no tsconfig.json/jsconfig.json found; set source.aliases' };
};

/** Repo-relative path (extension unresolved) for a relative or aliased import, else null. */
export const resolveAlias = (spec, fromFile, root, config) => {
    if (spec.startsWith('.'))
        return path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
    const { aliases } = readAliases(root, config);
    const prefix = Object.keys(aliases)
        .filter((p) => spec.startsWith(p))
        .sort((a, b) => b.length - a.length)[0];
    if (prefix === undefined) return null;
    return path.posix.normalize(path.posix.join(aliases[prefix], spec.slice(prefix.length)));
};
