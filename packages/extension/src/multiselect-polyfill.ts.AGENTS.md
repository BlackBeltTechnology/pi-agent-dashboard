# multiselect-polyfill.ts — index

Polyfill `ctx.ui.multiselect`. Exports `polyfillMultiselect`, `PolyfillCtx`. Primary path delegates to bridge-patched `ctx.ui.multiselect` (PromptBus → DashboardDefaultAdapter); legacy fallback renders `MultiSelectList` via `ctx.ui.custom`.
