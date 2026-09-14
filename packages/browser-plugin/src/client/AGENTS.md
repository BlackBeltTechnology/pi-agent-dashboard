# DOX — packages/browser-plugin/src/client

Files in this directory. One row per source file. See change: add-browser-relay.

| File | Purpose |
|------|---------|
| `index.tsx` | Client barrel. Exports `BrowserSettings`, `LiveViewTile`, `BrowserRelayBadge`, `isLiveViewActive`, `catalog` — names match manifest claims, plugin-registry imports by name. |
| `browser-api.ts` | REST client for `/api/browser/*`. Types mirror server `routes.ts`/`audit.ts` (`BrowserProfilesResponse`, `BrowserRouteProfile`, `BrowserRouteInstance`, `BrowserRouteTab`, `BrowserStatusResponse`, `BrowserAuditResponse`, `RelayConfig`). Fetchers `getBrowserStatus`/`getBrowserProfiles`/`getBrowserAudit`/`connectBrowserProfile`/`disconnectBrowserInstance`/`setBrowserEnabled`/`writeBrowserProfile` (`PUT /profile`, server-side-merged so other profiles' writeOnly tokens survive). `PLAYWRIGHT_EXTENSION_STORE_URL`. Relative URLs (client never imports the server subtree). Task 4.1. |
| `relay-store.ts` | Module-level relay store — the global `browser_relay_status` snapshot. `setRelayStatus` (bumps `bumpSlotClaimsVersion()` on a MATERIAL instance/tab change; `auditSeq` excluded; a material change also RE-ARMS the dismissed live view), `getRelayStatus`, `hasLiveInstance` (≥1 instance with ≥1 tab AND not dismissed), `dismissLiveView` (the tile's Close), `useRelayStatus` (reactive), `__resetRelayStoreForTests`. Task 4.3. See change: add-browser-relay. |
| `live-view-gate.ts` | `isLiveViewActive(session?)` → `hasLiveInstance()`. Manifest predicate for the content-view claim (claims MUST be predicate-gated; ungated occludes chat). Session arg ignored — relay is global. Reads the module store, no hooks. Task 4.3. |
| `BrowserRelayBadge.tsx` | `session-card-badge` claim. ALWAYS-MOUNTED `browser_relay_status` subscriber (`usePluginMessage` → `setRelayStatus`); pill `data-testid="browser-relay-badge"` hidden when `!hasLiveInstance()`. Label `{n} browser tabs`. This subscription is what makes the content-view predicate flip. Task 4.3. |
| `BrowserSettings.tsx` | `settings-section` claim. Rows from `GET /status` + `GET /profiles` keyed by `profileDirectory`: label/email/`installed`/`hasToken`/instances+tab count. WRITE-ONLY token input (`type=password`, draft clears on save, persists via `PUT /api/browser/profile` — server-side-merged against the UNREDACTED config, never rendered). `zeroDialog` toggle (disabled without `hasToken`, 60 s-timeout help). `allowedDomains` editor (`Page.navigate`/`Target.createTarget` guard help). `Connect` (`installed`+`enabled`+`canOpenChrome` gated) / `Disconnect` per `instanceId`. `Enabled` toggle = kill switch (`PUT /enabled`). `canOpenChrome:false` → notice + no Connect. Web Store link when not installed. Renders `AuditList` per profile. Task 4.1. |
| `AuditList.tsx` | Per-profile audit list `GET /audit?profile=`. Refetch when `browser_relay_status.auditSeq` changes (last seq in a ref; same seq = no fetch). The FIRST observed seq is treated as a change (the mount fetch carries no seq), so a mutation landing before any status still shows — treating it as a baseline swallowed it. Newest-first time/kind/detail rows. Task 4.2. See change: add-browser-relay. |
| `LiveViewTile.tsx` | `content-view` claim. One `RelayTile` per `{instanceId, tabId}` from the relay store. `browser_relay_subscribe` on mount / `unsubscribe` on unmount (tab removal unmounts). Renders `browser_relay_frame` JPEG. Pointer/key/wheel → `browser_relay_input` (`mouse`/`key`/`scroll`) with `normalizePoint(rect)` coords `[0,1]` (never pixels). `no-frames` overlay + `bringToFront`; `detached`/`devtools` overlay blocks input. `Close` clears the plugin's OWN gate state (`dismissLiveView()`), because the shell's `onClose` is a deliberate no-op — that is what unmounts the tile and fires the cleanup unsubscribe. Task 4.3. See change: add-browser-relay. |

Files in `__tests__/`:

| File | Purpose |
|------|---------|
| `test-utils.tsx` | Shared RTL harness. `FakeWs` (records `message` listeners, `emit(msg)`), `renderWithPlugin` (provider + `CurrentPluginLayer`), `SESSION` fixture. |
| `BrowserSettings.test.tsx` | Task 4.1 / F1–F3: not-installed → Connect disabled + Web Store link; token saved → input clears + `hasToken` true + token never rendered; kill switch → instances cleared + Connect disabled + reason; `canOpenChrome:false` → notice, no Connect. |
| `AuditList.test.tsx` | Task 4.2 / F4: higher `auditSeq` refetches + `denied` row appears; same `auditSeq` does not refetch. |
| `LiveViewTile.test.tsx` | Task 4.3 / F5–F9: tab list drives tiles + tab-1 unsubscribe; unmount unsubscribes; ≥5 JPEG src changes; no-frames overlay + `bringToFront`; DevTools overlay blocks input; coordinate BVA (320×200 box for a 1280×800 frame). |
| `BrowserRelayBadge.test.tsx` | Task 4.3: badge hides with no live instance, appears with tab count, drives `isLiveViewActive`. |
| `i18n.test.ts` | Task 4.4: non-empty key sets + `zh-CN`/`hu` key parity. |
