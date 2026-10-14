# DOX — packages/browser-plugin/src/client

Files in this directory. One row per source file. See change: add-browser-relay.

| File | Purpose |
|------|---------|
| `BrowserPaneTab.tsx` | Browser pane tab body (see change note). See change: add-browser-editor-pane-tab. |
| `BrowserTabLabel.tsx` | Tab-strip label for a browser pane tab: live title → URL host → "Browser tab" + state dot (`live`/`no-frames`/`detached`/`client-screencast-active`). Reads the relay store; mounted for background tabs too. See change: add-browser-editor-pane-tab. |
| `index.tsx` | Client barrel. Exports `BrowserSettings`, `BrowserRelayBadge`, `BrowserRelayFeed`, `BrowserTabLabel`, `hasRelayTabsForBadge` (badge claim `shouldRender`: `hasRelayTabs(getRelayStatus())`), `catalog` — names match manifest claims, plugin-registry imports by name. See change: add-browser-editor-pane-tab; fix-empty-status-subcard. |
| `browser-api.ts` | REST client for `/api/browser/*`. Types mirror server `routes.ts`/`audit.ts` (`BrowserProfilesResponse`, `BrowserRouteProfile`, `BrowserRouteInstance`, `BrowserRouteTab`, `BrowserStatusResponse`, `BrowserAuditResponse`, `RelayConfig`). Fetchers `getBrowserStatus`/`getBrowserProfiles`/`getBrowserAudit`/`connectBrowserProfile`/`disconnectBrowserInstance`/`setBrowserEnabled`/`writeBrowserProfile` (`PUT /profile`, server-side-merged so other profiles' writeOnly tokens survive). `PLAYWRIGHT_EXTENSION_STORE_URL`. Relative URLs (client never imports the server subtree). Task 4.1. |
| `relay-store.ts` | Module-level store for the global `browser_relay_status` snapshot (`null` = unknown/cleared). `relayTabsOf` (array-checked flatten; single primitive for gate + badge), `hasRelayTabs`, `setRelayStatus` (assign → `bumpSlotClaimsVersion()` ONLY when `hasRelayTabs` flips → notify), `getRelayStatus`, `useRelayStatus`, `subscribeRelayStore`, `findRelayTab`, `useRelayStatusFeed` (WS stream + REST seed on mount/every `connected`; live push during fetch wins via seq; failed seed → `null`; unmount → `null`), `__resetRelayStoreForTests`. `useRelayStatusFeed` caller = `BrowserRelayFeed` ONLY. See change: add-browser-relay; add-browser-editor-pane-tab; fix-empty-status-subcard. |
| `BrowserRelayFeed.tsx` | `shell-headless` claim. Zero-UI; sole caller of `useRelayStatusFeed`; mounted once by `ShellHeadlessSlot` in App. See change: fix-empty-status-subcard. |
| `BrowserRelayBadge.tsx` | `session-card-badge` claim (gated by manifest `shouldRender: "hasRelayTabsForBadge"`). READS the relay store only; null when `relayTabsOf` empty. Menu button (`aria-haspopup="menu"`, `data-testid="browser-relay-badge"`): "Open in pane" per tab + "Open all in pane" → one `openPluginTabRoute` navigation to the card session; arrow/Home/End/Escape keyboard; stops click propagation. See change: add-browser-editor-pane-tab; fix-empty-status-subcard. |
| `BrowserSettings.tsx` | `settings-section` claim. Rows from `GET /status` + `GET /profiles` keyed by `profileDirectory`: label/email/`installed`/`hasToken`/instances+tab count. WRITE-ONLY token input (`type=password`, draft clears on save, persists via `PUT /api/browser/profile` — server-side-merged against the UNREDACTED config, never rendered). `zeroDialog` toggle (disabled without `hasToken`, 60 s-timeout help). `allowedDomains` editor (`Page.navigate`/`Target.createTarget` guard help). `Connect` (`installed`+`enabled`+`canOpenChrome` gated) / `Disconnect` per `instanceId`. `Enabled` toggle = kill switch (`PUT /enabled`). `canOpenChrome:false` → notice + no Connect. Web Store link when not installed. Renders `AuditList` per profile. Task 4.1. |
| `AuditList.tsx` | Per-profile audit list `GET /audit?profile=`. Refetch when `browser_relay_status.auditSeq` changes (last seq in a ref; same seq = no fetch). The FIRST observed seq is treated as a change (the mount fetch carries no seq), so a mutation landing before any status still shows — treating it as a baseline swallowed it. Newest-first time/kind/detail rows. Task 4.2. See change: add-browser-relay. |

Files in `__tests__/`:

| File | Purpose |
|------|---------|
| `tab-path.ts` | `browserTabPath(instanceId, tabId)` / `parseBrowserTabPath(path)` for `browser:<instanceId>:<tabId>` (instance ids may contain `:`). See change: add-browser-editor-pane-tab. |
| `test-utils.tsx` | Shared RTL harness. `FakeWs` (`emit(msg)`), `renderWithPlugin` (provider + `CurrentPluginLayer` + `BrowserRelayFeed` unless `feed:false`; `connectionStatus` option + `setConnectionStatus`), `SESSION` fixture. |
| `BrowserSettings.test.tsx` | Task 4.1 / F1–F3: not-installed → Connect disabled + Web Store link; token saved → input clears + `hasToken` true + token never rendered; kill switch → instances cleared + Connect disabled + reason; `canOpenChrome:false` → notice, no Connect. |
| `AuditList.test.tsx` | Task 4.2 / F4: higher `auditSeq` refetches + `denied` row appears; same `auditSeq` does not refetch. |
| `BrowserRelayBadge.test.tsx` | Badge menu semantics + gate/render agreement (`hasRelayTabsForBadge`) over a malformed-frame corpus. |
| `relay-feed.test.tsx` | `BrowserRelayFeed`: seed on mount/reconnect, live push wins, failed refresh + unmount clear, sole-subscriber. See change: fix-empty-status-subcard. |
| `i18n.test.ts` | Task 4.4: non-empty key sets + `zh-CN`/`hu` key parity. |
