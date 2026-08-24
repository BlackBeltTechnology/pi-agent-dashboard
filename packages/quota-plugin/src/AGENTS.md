# DOX — packages/quota-plugin/src

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `client.tsx` | Client entry. `QuotaWidget` (content-inline-footer): per-provider mini-slider from `GET /api/quota` (polled 60s), fill = pace severity of worst window, `now` tick, `title` tooltip; renders `null` when empty (honest degradation). `QuotaDialog`: shared `ui:dialog` primitive via `useUiPrimitive(UI_PRIMITIVE_KEYS.dialog)`, `All · per-provider` selector, per-window pace bars + projected %. `QuotaSettings` (settings-section): ToS ack gate + master `enabled` + per-provider toggles, writes via `usePluginSend({type:"plugin_config_write", id:"quota"})`. Re-exports `catalog`. Imports only client-safe modules (never the server entry / pi-quotas). |
| `pace.ts` | Pure pace/burn-rate math. `computePace({usedPercent,resetsAt,windowSeconds}, now)` → `{state, elapsedPercent, projected, overage, warn, severity}`. Guards BEFORE dividing: `windowSeconds<=0`/non-finite→unavailable; non-finite `resetsAt`→unavailable; `secondsToReset<=0`→stale; `elapsedRaw<=PACE_EPS(0.01)`→unavailable. Severity green/orange/red (`projected>=150`||`used>=90`→red). `paceLabel()` → `over by X%`/`on pace`/`pace unavailable`/`reset pending`. Never `Infinity`/`NaN`. |
| `pace.test.ts` | Unit tests for `computePace`/`paceLabel`: on/ahead/critical pace, just-reset→unavailable, stale, `windowSeconds<=0`/NaN `resetsAt`→unavailable, ms↔s consistency. |
| `types.ts` | Wire contract: `QuotaWindowDto` (label, usedPercent, resetsAt ISO, windowSeconds, optional currency), `ProviderQuota`, `ApiQuotaResponse`, `QuotaPluginConfig`. No token fields. |
| `i18n.ts` | i18n `catalog` (zh-CN + hu) merged under `plugin.quota.*`; English fallbacks passed inline at call sites via `useT`. |
| `pi-quotas.d.ts` | Ambient module decl for `@latentminds/pi-quotas/src/lib/quotas.js` (deep raw-TS import; upstream has no `exports` map). Decouples typecheck from the dependency's pi-coding-agent peer types. See design.md "Packaging (Task 0)". |
| `__tests__/widget.test.tsx` | `QuotaWidget` render tests: renders from `/api/quota` with `now` tick; severity colour; renders nothing when empty or on fetch failure. |
| `__tests__/dialog.test.tsx` | `QuotaDialog` tests against the REAL client-utils `Dialog` primitive: `role=dialog`+`aria-modal`, pre-selection, selector switch (All / per-provider), Esc closes. |

See change: add-provider-quota-plugin.
