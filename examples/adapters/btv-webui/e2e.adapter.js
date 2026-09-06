/**
 * Example project adapter — keyboard-driven TV web app (the plugin's origin project).
 *
 * Shows what a `keyboard` interaction project must provide on top of the kit defaults:
 *   - keyMap: remote-control key names → browser key events the app listens to
 *   - findAndEnter: reach a target by focus movement, then press Enter
 *   - focusExpr / snapshotState: app-level focus id and state for Focus checks and diagnostics
 *
 * Copy to <e2e.adapterModule> and adjust. The kit is imported from <e2e.kitDir>.
 */
import { defaultAdapter, resolveTarget } from './kit/index.js';

const KEY_MAP = {
    ...defaultAdapter.keyMap,
    UP: 'ArrowUp',
    DOWN: 'ArrowDown',
    LEFT: 'ArrowLeft',
    RIGHT: 'ArrowRight',
    ENTER: 'Enter',
    BACK: 'Backspace',
    HOME: 'y',
    MENU: 'w',
    SEARCH: 't',
    EXIT: 'q'
};

/** Focus id the app publishes on its state bridge. */
const FOCUS_EXPR = 'window.$pinia?.focus?.focusId';

const readFocus = (page) => page.evaluate((expr) => new Function(`return (${expr});`)(), FOCUS_EXPR);

/** Press a key and wait until the focus id changes (or the timeout elapses). Returns true when it changed. */
const pressUntilFocusChanges = async (page, key, timeout) => {
    const before = await readFocus(page);
    await page.keyboard.press(KEY_MAP[key] ?? key);
    return page
        .waitForFunction((args) => new Function(`return (${args.expr});`)() !== args.before, { expr: FOCUS_EXPR, before }, { timeout })
        .then(() => true)
        .catch(() => false);
};

export default {
    ...defaultAdapter,
    keyMap: KEY_MAP,
    focusExpr: FOCUS_EXPR,

    async waitForAppReady(page, opts = {}) {
        await defaultAdapter.waitForAppReady(page, opts);
        // The app ignores direction keys until its initial screen sequence finishes and key handling is unblocked.
        await page.waitForFunction(
            () => window.$pinia?.common?.initialStartScreen === false && window.$pinia?.common?.blockGlobalKeyHandler === false,
            null,
            { timeout: opts.timeout ?? 15000 }
        );
    },

    async press(page, key, { delay = 0 } = {}) {
        await page.keyboard.press(KEY_MAP[key] ?? key, { delay });
    },

    /**
     * Keyboard findAndEnter: the target must already be rendered. Move focus DOWN through rows until the
     * target element carries the app's focused-state class, then RIGHT along the row, then press Enter.
     * Returns false when the target never receives focus within the key budget.
     */
    async findAndEnter(page, target, { timeout = 10000, maxRows = 20, maxCols = 30 } = {}) {
        const locator = resolveTarget(page, target).first();
        const isFocused = () => locator.evaluate((el) => el.classList.contains('--focused') || el.closest('.--focused') !== null).catch(() => false);
        const deadline = Date.now() + timeout;

        for (let row = 0; row < maxRows && Date.now() < deadline; row++) {
            for (let col = 0; col < maxCols && Date.now() < deadline; col++) {
                if (await isFocused()) {
                    await this.press(page, 'ENTER');
                    return true;
                }
                if (!(await pressUntilFocusChanges(page, 'RIGHT', 1500))) break; // end of row
            }
            if (!(await pressUntilFocusChanges(page, 'DOWN', 3000))) break; // end of page
        }
        return false;
    },

    async snapshotState(page) {
        return page
            .evaluate(() => {
                const p = window.$pinia;
                return {
                    focusId: p?.focus?.focusId ?? null,
                    route: window.location.pathname,
                    menuId: p?.gnb?.currentSubGnb?.menu_id || p?.gnb?.currentGnb?.menu_id || null,
                    loadedBlocks: Array.isArray(p?.home?.pageBlockInfo) ? p.home.pageBlockInfo.length : null
                };
            })
            .catch(() => ({}));
    }
};
