/**
 * Polyfill for `ctx.ui.multiselect(...)` — a method the dashboard bridge's
 * `ask_user` tool advertises but which `pi-coding-agent`'s
 * `ExtensionUIContext` does not expose. Without this, any TUI dispatch of
 * `method: "multiselect"` crashes with `"ctx.ui.multiselect is not a function"`.
 *
 * Fallback chain (introduced by change fix-multiselect-auto-cancel-on-dashboard):
 *
 *   1. PRIMARY  — bridge-patched `ctx.ui.multiselect` (PromptBus path).
 *      The bridge attaches this method on session_start so the dashboard
 *      browser renders a real `MultiselectRenderer` dialog and the TUI
 *      adapter renders a `MultiSelectList` overlay in the terminal.
 *
 *   2. FALLBACK — legacy `ctx.ui.custom` + `MultiSelectList` overlay.
 *      Reached when (a) running against an older pi without the bridge
 *      patch, (b) running outside the bridge entirely, or (c) the bridge
 *      patch was removed for some reason. TUI-only — does NOT render a
 *      browser dialog in dashboard / RPC mode (which is exactly the bug
 *      that motivated the primary path).
 *
 * The result contract is unchanged in either branch:
 *   - resolves to `string[]` when the user confirms a selection
 *     (possibly empty if nothing is checked)
 *   - resolves to `undefined` when the user cancels (Escape / Cancel)
 *
 * See change: fix-multiselect-auto-cancel-on-dashboard.
 */
import { MultiSelectList } from "./multiselect-list.js";

// Intentionally loose: `ctx` shape varies slightly across pi versions; the
// polyfill only needs `ctx.ui.multiselect` (primary) or `ctx.ui.custom` (fallback).
export interface PolyfillCtx {
  ui: {
    multiselect?: (
      title: string,
      options: string[],
      opts?: { message?: string },
    ) => Promise<string[] | undefined>;
    custom<T>(
      factory: (tui: unknown, theme: unknown, keybindings: unknown, done: (result: T) => void) => unknown,
      options?: unknown,
    ): Promise<T>;
  };
}

export function polyfillMultiselect(
  ctx: PolyfillCtx,
  title: string,
  options: string[],
  opts?: { message?: string },
): Promise<string[] | undefined> {
  // Primary path: delegate to the bridge-patched ctx.ui.multiselect (which
  // routes through PromptBus → DashboardDefaultAdapter → client
  // MultiselectRenderer). This is the only working path on pi 0.70 RPC mode
  // (dashboard headless sessions).
  const ui = ctx.ui as PolyfillCtx["ui"] & { multiselect?: Function };
  if (typeof ui.multiselect === "function") {
    return Promise.resolve(ui.multiselect(title, options, opts));
  }

  // Legacy fallback: TUI overlay via ctx.ui.custom. Used when the bridge
  // patch is absent (older pi / non-bridge embedding) OR a future pi version
  // restores ctx.ui.custom in RPC mode. NOTE: in pi 0.70 RPC mode
  // ctx.ui.custom is a no-op that resolves to undefined synchronously, so
  // this branch returns undefined immediately on dashboard headless
  // sessions — the primary path above is the only effective route there.
  return ctx.ui.custom<string[] | undefined>((_tui, _theme, _keybindings, done) => {
    const list = new MultiSelectList(title, options, opts?.message);
    list.onConfirm = (selected) => done(selected);
    list.onCancel = () => done(undefined);
    return list as unknown;
  });
}
