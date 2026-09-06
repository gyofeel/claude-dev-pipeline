/**
 * Reads `.agents/pipeline.config.json` for kit runtime code (specs, adapter, analyzer).
 * Walks up from cwd to find the repo root (the directory containing `.agents/`).
 * Result is cached for the process lifetime.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const DEFAULTS = {
    ui: { stateBridge: null, testIdAttribute: 'data-testid' },
    e2e: {
        fixturesDir: 'e2e/fixtures',
        readyExpr: null,
        softTrack: null,
        ai: { provider: 'none', model: null, apiKeyEnv: null }
    }
};

let cached = null;

/** Find the directory containing `.agents/` starting at `from`, else `from` itself. */
export function findRepoRoot(from = process.cwd()) {
    let dir = path.resolve(from);
    for (;;) {
        if (existsSync(path.join(dir, '.agents'))) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) return path.resolve(from);
        dir = parent;
    }
}

/**
 * @returns {{ root: string, config: Object }} config with kit-relevant defaults merged in.
 * Paths in `config` stay relative to `root`.
 */
export function loadKitConfig(from = process.cwd()) {
    if (cached) return cached;
    const root = findRepoRoot(from);
    const file = path.join(root, '.agents', 'pipeline.config.json');
    const raw = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    const config = {
        ...raw,
        ui: { ...DEFAULTS.ui, ...(raw.ui || {}) },
        e2e: { ...DEFAULTS.e2e, ...(raw.e2e || {}), ai: { ...DEFAULTS.e2e.ai, ...(raw.e2e?.ai || {}) } }
    };
    cached = { root, config };
    return cached;
}

/** Test hook: drop the cache. */
export function resetKitConfig() {
    cached = null;
}
