/**
 * Project adapter — the only project-specific code generated specs call.
 * Every member is optional; unset members fall back to the kit defaults (pointer interaction).
 * See <kitDir>/README.md and the plugin's references/adapter-contract.md.
 */
import { defaultAdapter } from './kit/index.js';

export default {
    ...defaultAdapter

    // ── Keyboard-driven apps (e2e.interaction: "keyboard") ────────────────
    // Required: move focus to the target with key presses and activate it.
    // async findAndEnter(page, target, { timeout = 10000 } = {}) {
    //     const loc = this.locator(page, target).first();
    //     for (let i = 0; i < 30; i++) {
    //         if (await loc.evaluate((el) => el === document.activeElement).catch(() => false)) {
    //             await this.press(page, 'Enter');
    //             return true;
    //         }
    //         await this.press(page, 'ArrowDown');
    //     }
    //     return false;
    // },

    // Logical key name → Playwright key (remote controls, custom shortcuts).
    // keyMap: { ...defaultAdapter.keyMap, Back: 'Backspace', Home: 'y' },

    // JS expression evaluated in the page that returns the focused area/id (used by Focus checkpoints).
    // focusExpr: "window.__APP__?.focus?.id ?? ''",

    // Extra fields attached to failure diagnostics.
    // async snapshotState(page) {
    //     return page.evaluate(() => ({ route: location.pathname, focus: window.__APP__?.focus?.id }));
    // },

    // Replace the readiness wait entirely when the default (domcontentloaded → renderSelector → readyExpr) is not enough.
    // async waitForAppReady(page, { renderSelector = null, timeout = 30000 } = {}) { ... }
};
