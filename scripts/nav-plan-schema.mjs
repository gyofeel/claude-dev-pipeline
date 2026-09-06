#!/usr/bin/env node
/**
 * nav-plan-schema — deterministic validator for navigation plans.
 *
 *   node nav-plan-schema.mjs <plan.json> [--cwd <dir>]   → { valid, errors[] }  (exit 1 when invalid)
 *
 * Schema: references/navigation-plan.md. Config (stateBridge / interaction / adapter) is read via
 * config-load.mjs to enforce the conditional rules; if config cannot be loaded, those rules are skipped
 * and reported as warnings on stderr.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config-load.mjs';

const ACTIONS = {
    goto: { required: ['url'], optional: [] },
    waitFor: { required: [], optional: ['expr', 'selector', 'timeout'] },
    click: { required: ['target'], optional: ['until', 'timeout'] },
    fill: { required: ['target', 'value'], optional: [] },
    press: { required: ['key'], optional: ['until', 'timeout', 'repeat'] },
    findAndEnter: { required: ['target', 'until', 'timeout', 'fallback'], optional: [] },
    loop: { required: ['max', 'body', 'until'], optional: [] }
};
const BY = ['testid', 'role', 'text', 'css', 'predicate'];
const UNTIL_RE = /^(urlChanges|focusChanges|selectorVisible:.+|selectorHidden:.+|expr:.+)$/;
const PLACEHOLDER_RE = /<[^>]*>|\[[^\]]*\]|\bTODO\b/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => Number.isInteger(v);

export function validatePlan(plan, ctx = {}) {
    const errors = [];
    const err = (m) => errors.push(m);
    const { stateBridge = null, interaction = 'pointer', adapterHasFindAndEnter = false } = ctx;

    // placeholders anywhere (strings only — selectors legitimately contain [attr] so restrict to angle/TODO in css)
    const walk = (v, p) => {
        if (typeof v === 'string') {
            if (/<[^>]*>/.test(v) || /\bTODO\b/.test(v)) err(`${p} — placeholder token: ${JSON.stringify(v)}`);
            else if (/\[\.\.\.\]|\[[a-z][a-zA-Z ]+\]/.test(v) && !/[=~^$*|]/.test(v)) err(`${p} — template token: ${JSON.stringify(v)}`);
        } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
        else if (isObj(v)) for (const [k, x] of Object.entries(v)) walk(x, `${p}.${k}`);
    };

    if (!isObj(plan)) return { valid: false, errors: ['plan must be an object'] };
    if (plan.startUrl !== null && plan.startUrl !== undefined && typeof plan.startUrl !== 'string') err('startUrl — string or null');
    if (!Array.isArray(plan.steps) || plan.steps.length === 0) err('steps — non-empty array required');
    walk(plan, 'plan');

    const checkTarget = (t, p) => {
        if (!isObj(t)) return err(`${p} — object required`);
        if (!BY.includes(t.by)) err(`${p}.by — unknown value ${JSON.stringify(t.by)}`);
        if (typeof t.value !== 'string' || !t.value) err(`${p}.value — non-empty string required`);
        if (t.nth !== undefined && !isInt(t.nth)) err(`${p}.nth — integer required`);
        if (t.by === 'predicate') {
            if (typeof t.source !== 'string' || !t.source) err(`${p}.source — required for predicate targets`);
            if (!stateBridge) err(`${p} — predicate targets require ui.stateBridge`);
        }
    };
    const checkTimeout = (v, p) => {
        if (v === undefined) return;
        if (!isInt(v) || v < 500) err(`${p} — integer ≥ 500 required`);
    };
    const checkUntil = (v, p) => {
        if (v === undefined) return;
        if (typeof v !== 'string' || !UNTIL_RE.test(v)) err(`${p} — must be urlChanges|focusChanges|selectorVisible:<css>|selectorHidden:<css>|expr:<js>`);
    };

    const checkSteps = (steps, p) => {
        if (!Array.isArray(steps)) return;
        steps.forEach((s, i) => {
            const sp = `${p}[${i}]`;
            if (!isObj(s)) return err(`${sp} — object required`);
            const def = ACTIONS[s.action];
            if (!def) return err(`${sp}.action — unknown action ${JSON.stringify(s.action)}`);
            for (const k of def.required) if (s[k] === undefined) err(`${sp}.${k} — required for ${s.action}`);
            for (const k of Object.keys(s)) if (k !== 'action' && !def.required.includes(k) && !def.optional.includes(k)) err(`${sp}.${k} — not allowed for ${s.action}`);
            if (s.target !== undefined) checkTarget(s.target, `${sp}.target`);
            checkTimeout(s.timeout, `${sp}.timeout`);
            checkUntil(s.until, `${sp}.until`);
            switch (s.action) {
                case 'goto':
                    if (typeof s.url !== 'string' || !s.url) err(`${sp}.url — non-empty string required`);
                    break;
                case 'waitFor':
                    if ((s.expr === undefined) === (s.selector === undefined)) err(`${sp} — exactly one of expr|selector required`);
                    break;
                case 'fill':
                    if (typeof s.value !== 'string') err(`${sp}.value — string required`);
                    break;
                case 'press':
                    if (typeof s.key !== 'string' || !s.key) err(`${sp}.key — non-empty string required`);
                    if (s.repeat !== undefined && (!isInt(s.repeat) || s.repeat < 1)) err(`${sp}.repeat — integer ≥ 1 required`);
                    break;
                case 'findAndEnter':
                    if (!['skip', 'fail'].includes(s.fallback)) err(`${sp}.fallback — skip|fail required`);
                    if (interaction === 'keyboard' && !adapterHasFindAndEnter) err(`${sp} — keyboard interaction requires adapter.findAndEnter`);
                    break;
                case 'loop':
                    if (!isInt(s.max) || s.max < 1 || s.max > 50) err(`${sp}.max — integer 1..50 required`);
                    if (s.until === undefined) err(`${sp}.until — required`);
                    if (!Array.isArray(s.body) || s.body.length === 0) err(`${sp}.body — non-empty array required`);
                    else checkSteps(s.body, `${sp}.body`);
                    break;
            }
        });
    };
    checkSteps(plan.steps, 'steps');

    const pec = plan.postEnterCondition;
    if (pec !== undefined && pec !== null) {
        if (!isObj(pec)) err('postEnterCondition — object or null');
        else {
            if (pec.type === 'DOM') {
                if (typeof pec.selector !== 'string' || !pec.selector) err('postEnterCondition.selector — required for DOM');
            } else if (pec.type === 'State') {
                if (typeof pec.expr !== 'string' || !pec.expr) err('postEnterCondition.expr — required for State');
                if (!stateBridge) err('postEnterCondition — State type requires ui.stateBridge');
            } else err(`postEnterCondition.type — DOM|State required, got ${JSON.stringify(pec.type)}`);
            checkTimeout(pec.timeout, 'postEnterCondition.timeout');
        }
    }
    return { valid: errors.length === 0, errors };
}

const HELP = `nav-plan-schema — validate a navigation plan JSON
  node nav-plan-schema.mjs <plan.json> [--cwd <dir>]
  prints { valid, errors[] }; exit 1 when invalid`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const a = process.argv.slice(2);
    if (!a[0] || a.includes('--help') || a.includes('-h')) {
        console.log(HELP);
        process.exit(a[0] ? 0 : 1);
    }
    const cwdIdx = a.indexOf('--cwd');
    const cfg = loadConfig(cwdIdx >= 0 ? a[cwdIdx + 1] : process.cwd());
    const ctx = {};
    if (cfg.ok) {
        ctx.stateBridge = cfg.resolved.ui.stateBridge;
        ctx.interaction = cfg.resolved.e2e.interaction;
        const ad = cfg.resolved.e2e.adapterModule;
        ctx.adapterHasFindAndEnter = existsSync(ad) && /\bfindAndEnter\b/.test(readFileSync(ad, 'utf8'));
    } else console.error(`warning: config not loaded (${cfg.errors.join('; ')}) — conditional rules skipped`);
    let plan;
    try {
        plan = JSON.parse(readFileSync(a[0], 'utf8'));
    } catch (e) {
        console.log(JSON.stringify({ valid: false, errors: [`cannot read plan: ${e.message}`] }, null, 2));
        process.exit(1);
    }
    const res = validatePlan(plan, ctx);
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.valid ? 0 : 1);
}
