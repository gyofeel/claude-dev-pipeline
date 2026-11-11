/** Runs one checkpoint as a test.step and records its flag and actual value on the criterion. Step is injected so this runs outside Playwright. */
import { stripVTControlCharacters } from 'node:util';
import { labels } from '../report/labels.mjs';

const ACTUAL_MAX = 200;

// Circular objects and BigInt throw, functions and symbols stringify to undefined
const stringify = (value) => {
    try {
        return JSON.stringify(value) ?? String(value);
    } catch {
        return String(value);
    }
};
const toActual = (value) => (typeof value === 'string' ? value : stringify(value)).slice(0, ACTUAL_MAX);

/**
 * @param {(title: string, body: Function) => Promise<any>} step test.step
 * @param {{ id, desc, passed }|null} criterion entry of the success criteria (null: run without recording)
 * @param {string} id checkpoint id
 * @param {(seen: (v: any) => any) => Promise<any>} body assertion. Its return value is kept as the actual value.
 *   Calling seen(v) keeps the last seen value as actual even when the assertion fails
 * @param {{ soft?: boolean, log?: Function, locale?: string, platformLabel?: string|null }} options
 *   soft: do not throw on failure (checkpoints that depend on states the test environment cannot reach)
 */
export async function runCheckpoint(
    step,
    criterion,
    id,
    body,
    { soft = false, log = console.log, locale = 'en', platformLabel = null } = {}
) {
    const title = criterion ? `${id}: ${criterion.desc}` : id;
    // A throwing assertion returns nothing, so values seen while polling are kept here
    const seen = (v) => {
        if (criterion && v !== undefined) criterion.actual = toActual(v);
        return v;
    };
    return step(title, async () => {
        try {
            const value = await body(seen);
            if (criterion) {
                criterion.passed = true;
                if (value !== undefined) criterion.actual = toActual(value);
            }
            return value;
        } catch (err) {
            if (!soft) throw err;
            const reason = stripVTControlCharacters(String(err?.message ?? err)).split('\n')[0];
            if (criterion) {
                criterion.soft = true;
                criterion.softReason = reason.slice(0, ACTUAL_MAX);
            }
            log(labels(locale, { platformLabel }).softLog(title, reason));
            return undefined;
        }
    });
}
