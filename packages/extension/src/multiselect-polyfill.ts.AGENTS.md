# multiselect-polyfill.ts — index

Polyfill `ctx.ui.multiselect`. Exports `polyfillMultiselect`, `PolyfillCtx`. Primary path delegates to bridge-patched `ctx.ui.multiselect` (PromptBus → DashboardDefaultAdapter); legacy fallback renders `MultiSelectList` via `ctx.ui.custom`.

`opts` type carries `allowOther?: boolean` (passed through to `ctx.ui.multiselect`). See change: add-ask-user-inline-other.
