# Tasks — provider quota plugin (server-side)

## 0. Dependency + resolvable entry (gates everything)
- [x] **Depend on `@latentminds/pi-quotas`** (do NOT vendor), pinned exactly to
      `0.4.0` — **NO upstream change required**. The server entry **deep-imports
      the raw TS as published** (`@latentminds/pi-quotas/src/lib/quotas.js`):
      permitted precisely because the package has no `exports` field (subpaths
      stay open), and the dashboard server runs entirely through jiti which
      transpiles the `.ts` on the fly. No PR, fork, patch, or `exports`-map wait.
      Verified end-to-end: jiti resolves the deep import from the plugin's real
      installed context (see `src/pi-quotas.d.ts` + design.md "Packaging").
      The original task text's "secure an upstream exports map" path is
      explicitly NOT used and NOT needed.

## 1. Plugin scaffold (bundled, disabled by default)
- [x] Scaffold `packages/quota-plugin/` (server + client entries,
      `pi-dashboard-plugin` manifest, `configSchema.json`, `settings-section`).
      **No bridge entry.** `private: true` (bundled). configSchema `enabled`
      defaults false; the self-gating server entry makes zero fetch until
      `enabled===true` (strict), independent of the platform's load default.
- [x] Add `@latentminds/pi-quotas` dependency (pinned `0.4.0` per Task 0);
      AGENTS.md rows (`packages/quota-plugin/{,,src/,src/server/}AGENTS.md`).
      Client package.json gains the plugin dep so the client build bundles it.

## 2. Server entry — credential resolution via the host abstraction
- [x] Resolve provider credentials through the server's OWN auth abstraction
      (`getModelRegistry().getApiKeyAndHeaders` → `InternalAuthStorage`, with
      OAuth refresh, + `readAuthJson()` for the raw credential/`accountId`),
      deep-imported from `@blackbelt-technology/pi-dashboard-server`. **Never**
      reads a hardcoded `~/.pi/agent/auth.json` path in the plugin.
- [x] Adapt that resolver to the 2-method `{ get, getApiKey }` `AuthStorage`
      shape and pass to `fetchProviderQuotas` (lib TTL cache).
- [x] Exclude `anthropic`; suppress `not_applicable`; validate/clamp windows
      (Date→ISO, usedPercent 0..100, drop windows without valid `windowSeconds`);
      forward only `QuotaWindowDto[]` (never tokens) incl. `windowSeconds`.

## 3. Server entry — gate + endpoint
- [x] Fetch ONLY when `plugins.quota.enabled` AND `acknowledgedToS` AND that
      provider's `enabled` are all true (server-owned config; never migrate-on).
      Turning any off stops the fetch + `clearQuotaCache(provider)`.
- [x] Expose guarded `GET /api/quota` → `{ providers:[{provider,windows[]}] }`;
      broadcast a `quota_update` browser message on refresh. No event-store
      persistence. Logger records provider id + error KIND only (never a token).

## 4. Client entry
- [x] Quota widget: one mini-slider per enabled provider (fill = pace severity,
      worst window drives it; `now` tick; minimal `title` tooltip
      `over by X%`/`on pace`). Renders into the `content-inline-footer` slot
      (new claim — no `TokenStatsBar` surgery, no mobile-segment policy needed).
      Returns `null` when empty. — (test-plan: automated)
- [x] Pace helper (`src/pace.ts`): safe math (ms↔s, EPS/stale/`windowSeconds≤0`
      → unavailable BEFORE dividing); shared, pure, unit-tested fn.
- [x] Click → shared Dialog primitive `useUiPrimitive(UI_PRIMITIVE_KEYS.dialog)`,
      pre-selected to that provider, selector `All · per-provider`. No hand-rolled modal.
- [x] `settings-section`: ToS acknowledgement gate + master enable + per-provider
      enable toggles (off each); reactive `usePluginConfig`. NOTE: explicit
      "window selection" omitted — `@latentminds/pi-quotas` exposes no per-window
      fetch knob; the widget shows the worst window and the dialog shows all
      windows, so a selection control would be cosmetic-only (Simplicity-first).

## Tests
- [x] Pace math (L1): on/ahead/critical; `elapsedRaw≤EPS`→unavailable (no Infinity);
      `secondsToReset≤0`→stale; `windowSeconds≤0`/NaN `resetsAt`→unavailable; ms/s
      correct. (see sibling `*.test.ts`) — (test-plan: automated)
- [x] Gate (L1): un-acked OR provider-disabled OR plugin-disabled → server makes NO
      quota fetch; upgrade never auto-enables. (mock config + `fetchProviderQuotas`)
      — (test-plan: automated)
- [x] Credential path (L1): server entry resolves creds via the host auth
      abstraction (mock `InternalAuthStorage`/`readAuthJson`), NOT a file path;
      token never in `/api/quota` output NOR logs (also broadcast). — (test-plan: automated)
- [x] Server (L1): Anthropic excluded; API-key/`not_applicable` → omitted;
      `/api/quota` returns normalized windows incl. `windowSeconds`; cache dropped
      when a provider is disabled. — (test-plan: automated)
- [x] Client (L1): widget renders from `/api/quota`; absent when empty/disabled;
      severity colour; `now` tick; no-JSX-slot-nullish-fallback lint. — (test-plan: automated)
- [x] Dialog (L3): click opens shared `ui:dialog`; selector switches provider↔All;
      Esc close; `role=dialog`+`aria-modal` (real client-utils `Dialog` primitive).
      — (test-plan: automated)
- [x] Loader (L1): plugin load failure isolated → `/api/health.plugins[]` reports it,
      shell unaffected. — (test-plan: automated)

## Validate
- [x] `npm test` green (31/31 in quota-plugin); `openspec validate
      add-provider-quota-plugin --strict` passes.
- [x] Manual (test-plan: manual-only): enable a non-Anthropic OAuth provider (Codex)
      → `/api/quota` returns windows; widget + dialog render; over-pace shows
      warning + `over by X%`; disabling clears it; Anthropic never fetched.
      (deferred to post-merge verification)
- [x] Rebuild: server change → `curl -X POST .../api/restart`; client change →
      `npm run build && curl -X POST .../api/restart`. (deferred to post-merge)
