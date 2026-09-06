/**
 * Pointer-interaction defaults for the adapter contract (references/adapter-contract.md).
 * A project adapter spreads this object and overrides what it needs.
 */
import { loadKitConfig } from '../config-loader.js';

const KEY_MAP = {
    ArrowUp: 'ArrowUp',
    ArrowDown: 'ArrowDown',
    ArrowLeft: 'ArrowLeft',
    ArrowRight: 'ArrowRight',
    Enter: 'Enter',
    Escape: 'Escape',
    Backspace: 'Backspace',
    Tab: 'Tab',
    Space: 'Space'
};

/**
 * Resolve a target descriptor to a Locator.
 * @param {import('@playwright/test').Page} page
 * @param {string|{by:string,value:string,name?:string,nth?:number}} target - bare string = css
 */
export function resolveTarget(page, target) {
    const t = typeof target === 'string' ? { by: 'css', value: target } : target;
    let loc;
    switch (t.by) {
        case 'testid': {
            const attr = loadKitConfig().config.ui.testIdAttribute;
            loc = page.locator(`[${attr}="${t.value}"]`);
            break;
        }
        case 'role':
            loc = page.getByRole(t.value, t.name ? { name: t.name } : undefined);
            break;
        case 'text':
            loc = page.getByText(t.value);
            break;
        case 'css':
            loc = page.locator(t.value);
            break;
        case 'predicate':
            throw new Error(
                `target.by "predicate" is not supported by the default adapter — implement adapter.findAndEnter for state-driven targets`
            );
        default:
            throw new Error(`unknown target.by "${t.by}"`);
    }
    return Number.isInteger(t.nth) ? loc.nth(t.nth) : loc;
}

/** @returns {Promise<{tag:string,id:string,classes:string,testid:string|null,text:string}|null>} */
export async function describeActiveElement(page) {
    const attr = loadKitConfig().config.ui.testIdAttribute;
    return page.evaluate((testIdAttr) => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        return {
            tag: el.tagName.toLowerCase(),
            id: el.id || '',
            classes: el.className || '',
            testid: el.getAttribute(testIdAttr),
            text: (el.textContent || '').trim().slice(0, 80)
        };
    }, attr);
}

export const defaultAdapter = {
    keyMap: KEY_MAP,
    focusExpr: null,

    async waitForAppReady(page, { renderSelector = null, readyExpr = null, timeout = 30000 } = {}) {
        await page.waitForLoadState('domcontentloaded');
        if (renderSelector) {
            await resolveTarget(page, renderSelector).first().waitFor({ state: 'visible', timeout });
        }
        // per-spec readyExpr (from the TC render condition) wins over the config default
        const expr = readyExpr || loadKitConfig().config.e2e.readyExpr;
        if (expr) {
            await page.waitForFunction(new Function(`return (${expr});`), null, { timeout });
        }
    },

    async press(page, key, { delay = 0 } = {}) {
        await page.keyboard.press(this.keyMap[key] ?? key, delay ? { delay } : undefined);
    },

    locator(page, target) {
        return resolveTarget(page, target);
    },

    /** Locate → wait visible → click. Returns false when not found within timeout. */
    async findAndEnter(page, target, { timeout = 10000 } = {}) {
        const loc = resolveTarget(page, target).first();
        try {
            await loc.waitFor({ state: 'visible', timeout });
        } catch {
            return false;
        }
        await loc.click();
        return true;
    },

    async snapshotState() {
        return {};
    }
};
