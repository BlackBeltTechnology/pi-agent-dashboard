## Context

- `apiBase` = `deriveApiBase(wsUrl) || VITE_API_URL`, pushed to the module store via `setGlobalApiBase` (`packages/client/src/App.tsx:462-466`). `""` means same-origin.
- `getApiBase()` reads that store (`packages/client/src/lib/api/api-context.ts`).
- Two existing global wrappers, installed in `packages/client/src/main.tsx:182,188`:
  - `installDeviceAuthFetch` (`packages/client/src/lib/pairing/device-auth.ts:162`) — attaches the paired-device bearer to **same-origin** `/api/` + `/v1/` requests (`shouldAttachBearer`, `device-auth.ts:147`).
  - `installGrantChannelFetch` (`packages/client/src/lib/access-grants/grant-channel.ts:100`) — attaches the grant capability header to same-origin `/api/*`.
- Plugin clients receive no API base from the SDK; they call `fetch("/api/...")` (e.g. `packages/quota-plugin/src/client.tsx:153`).
- Core relative calls also exist: `hooks/usePluginEnabledSet.ts:29`, `hooks/useHostPlatform.ts:50`, `hooks/useLaunchSource.ts:35`, `components/packages/PluginStalenessBanner.tsx:36`, `components/settings/ModelSelector.tsx:401`, `components/settings/SettingsPanel.tsx:2830`, `hooks/useDebugToolsVisible.ts:34`, `lib/roles/useRolePick.ts:34`, `lib/state/custom-event-groups.ts:24` (all under `packages/client/src/`).

## Goals / Non-Goals

Goals:
- Every root-relative `/api/` fetch reaches the selected server.
- Local credentials (device bearer, grant capability) never sent to a remote origin.
- Zero change for same-origin / local mode.

Non-Goals:
- Plugin SDK `apiBase` accessor (option B) — not needed once the host rewrites; may follow separately.
- Rewriting `/v1/` paths (Anthropic-messages bridge surface) — out of scope; listed as open question.
- `Request`-object inputs — the browser already resolved them to an absolute local URL; indistinguishable from a deliberate local call.
- WebSocket URLs, `EventSource`, `<img src>` — not `fetch`.

## Decisions

**D1 — Host-level rewrite over per-plugin fix.** One wrapper covers 11 plugin packages + 9 core call sites + future plugins. Per-plugin (SDK accessor) needs every author to remember; the existing rule already failed for core.

**D2 — Match rule.** Rewrite iff ALL hold:
1. `getApiBase()` is non-empty (read at call time — honours a server switch without reinstall).
2. input is a `string` starting with `/api/` (not `//`, not absolute). `URL` and `Request` inputs are absolute by construction → pass through.

Result: `${getApiBase()}${input}` (path + query + hash preserved verbatim).
Rationale: strings beginning with `/api/` are unambiguously "the dashboard server I'm talking to"; absolute strings/URLs express explicit intent.

**D3 — Install outermost.** `installApiBaseFetch()` runs after the two credential wrappers in `main.tsx`, so it executes first per call. The inner wrappers then see a cross-origin URL → `shouldAttachBearer`/`shouldAttach` return false → no local credential leaks. Cross-origin auth stays whatever core prefixed calls already get (parity).

**D4 — Idempotent.** `window.__piApiBaseFetch` guard, mirroring the two existing wrappers.

**D5 — Explicit-local escape.** Code that truly wants the local server while remote must use an absolute URL (`window.location.origin + path`). No current call site needs it (audit of the 9 core sites: all mean "the connected server").

## Risks / Trade-offs

- Global monkey-patch order is load-bearing → test asserts no bearer/grant header on a rewritten request.
- A plugin that deliberately targeted the local server via a relative path would change behaviour → none found; D5 documents the escape.
- `credentials: "same-origin"` on core calls now cross-origin → cookie not sent; matches prefixed core calls today.

## Migration / Rollback

No data or config migration. Rollback = remove the `installApiBaseFetch()` line in `main.tsx`.

## Open Questions

- Should `/v1/` (bridge) also follow the selected server? Default: no, until a use case appears.
