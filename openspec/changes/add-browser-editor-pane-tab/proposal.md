## Why

The browser relay's live view (`add-browser-relay`) takes over the whole session content area through a global `content-view` claim. As a result, chat and browser can never be seen together, every session shows the browser, and phone use is click-only. A live end-to-end test on 2026-10-06 (server on `192.168.16.204:8000`, viewers on the LAN) also found that the relay is not usable as shipped:

- It leaks the extension pairing token and relay guid. `GET /api/browser/profiles` returns the extension's `connect.html?…&token=…&mcpRelayUrl=…` tab URL verbatim.
- Neither supported CDP client can attach. `agent-browser connect` fails on `Target.setDiscoverTargets: No attached tab`, and Playwright `connectOverCDP` fails on the denied `Browser.setDownloadBehavior`.
- After a navigation, the reported tab title and URL never update.

This change moves the live view into the editor pane as a first-class tab, next to files, terminals and live previews. It fixes the relay defects that block that tab from working.

## What Changes

**Editor-pane plugin tabs (new core extension point)**
- New slot id `editor-pane-tab`. A claim carries a body component, a `pathPrefix` (e.g. `browser`) and an optional label component. These fields are threaded through manifest normalization, registry generation and the runtime claim entry.
- Tabs with path `<prefix>:<rest>` render the claim's body. The label renders in the tab strip and stays mounted for background tabs.
- Built-in prefixes (`diff`, `term`, `url`, `live`) are reserved. A cross-plugin duplicate fails registry generation, following the `customType` precedent.
- Every plugin-tab open is one navigation to `/session/<id>/editor?tab=<virtual-path>[&tab=…]` with a fresh `openNonce`, through a shared helper. This selects the session and opens or focuses the tab, including re-opening it after it was closed. The editor route applies it through a new `openPluginTab` opener.
- A tab whose plugin is gone renders a "tab unavailable" placeholder with Close.
- Plugin servers get `ctx.openEditorTab(sessionId, path)` (own prefix only) and clients handle the core `editor_tab_open` message. This is the generic agent-initiated open.
- Virtual (pseudo/plugin) tab paths are excluded from the pane's file-watch set.
- Pane-state hydration becomes per-entry instead of all-or-nothing, and the known-viewer set is derived from the viewer partition. This also fixes today's bug where one persisted docx/pptx/spreadsheet/asciidoc/email/diagram tab resets a session's whole pane. It ships as its own first commit.

**Browser tab in the editor pane (browser plugin)**
- Each relay tab opens as the pane tab `browser:<instanceId>:<tabId>`. It subscribes only while active, and re-subscribes when its relay tab becomes viewable again.
- Toolbar:
  - redacted read-only URL;
  - Input on/off;
  - Fit/1:1;
  - Bring to front;
  - **Done ✓**, shown only while a takeover is pending.

  The label shows the live title and state.
- Opening paths:
  1. The session-card badge becomes a menu of relay tabs ("Open in pane" / "Open all in pane").
  2. Agent-initiated open: a new browser-plugin **bridge** registers the pi tool `browser_show_in_pane {instanceId, tabId?}`. The server receives it over the existing plugin request lane, which supplies the caller's `sessionId` from its socket, never from arguments. It calls a new core host API, `ctx.openEditorTab(sessionId, path)` (own prefix only), which broadcasts the core message `editor_tab_open {sessionId, path}`. Clients currently on that session's route open the tab; clients elsewhere (other session, settings, overlays) ignore it. `browser_show_in_pane` is rate-limited to one per 5 s per (session, instance); the takeover open is exempt.
- Ownership: an agent-initiated open goes to the calling session's pane. A manual open goes to the pane of the session whose badge was used.
- Mobile input:
  - Pointer Events, so a tap becomes a click;
  - `user-select: none`;
  - a soft-keyboard text bridge.
- Remote viewport resize: a new input kind `resize`, clamped. The client sends it only while Input is on.
  - It is refused while the agent holds its own emulation on that tab (`agentEmulation` in status); the pane falls back to Fit.
  - The override is cleared on the last unsubscribe and on instance close.
- Login takeover: the bridge tool `browser_await_human {instanceId, reason}` shows the tab, then raises a confirm prompt through the normal `PromptBus` path with namespaced plugin metadata (`kind: "browser-takeover"`). The pane's Done button answers that same prompt. The outcome is `done` or `cancelled`.
- Mockup: `mockups/editor-pane-tab.html` (in this change). The current placement is in `mockups/current-placement.html` (in this change).

**Prompt metadata seam (extension)**
- `ctx.ui.*` dialog options gain an optional `pluginMeta` object (a plain object, ≤ 2048 UTF-8 bytes), copied into `prompt.metadata.plugin`. It can never override core keys (`message`, `toolCallId`, `kind`). Today `buildMeta` drops every custom option.
- The client keeps `metadata.plugin` on interactive requests and in the plugin-context snapshot. Today only `toolCallId` survives.

**Relay fixes (found in live testing)**
- **Security.** Every viewer-facing payload (`/ws` relay messages, `/api/browser/*` except the `connect` response, audit detail):
  - omits the extension's connect page, and refuses subscribe/input to it; the CDP-client path filters it too;
  - strips the query string and fragment from `chrome-extension:` URLs;
  - never carries the token, guid or `mcpRelayUrl`.
- **CDP-client compatibility (outcome-based).** Real `agent-browser connect` and Playwright `connectOverCDP` must attach.
  - `Target.setDiscoverTargets` is answered locally. Discovery events are emitted only for attached tabs, using their real target info.
  - `Browser.setDownloadBehavior` is acknowledged and dropped (**behavior change**: no longer a `-32000` denial). It is audited with a new kind, `dropped`.
- **Tab metadata.** Title and URL are refreshed via `Target.getTargetInfo` after main-frame navigation/load events and on subscribe, then broadcast. The vendored relay never delivers `targetInfoChanged`.
- **Audit.** New kinds `open` and `dropped`.
- **Spec sync.** The deny-list text gains `vbscript:`, which the code already denies.

**Removals**
- **BREAKING (plugin-internal):** the browser plugin drops its `content-view` claim (`LiveViewTile`, `isLiveViewActive`, `dismissLiveView`/`reopenLiveView`). The relay no longer replaces the chat. The `content-view` slot and the generic `SessionContentGate` are unchanged.

## Capabilities

### New Capabilities
- `editor-pane-plugin-tabs`: the plugin-claimable editor-pane tab. Covers prefix ownership, the label, collisions, the unavailable placeholder, per-entry persistence, the `?tab=` deep link, and server-initiated opens (`editor_tab_open`).
- `browser-pane-tab`: the browser plugin's pane tab. Covers subscription lifecycle, frame and idle rendering, the toolbar, desktop/touch/text input, viewport resize, opening paths, and the takeover Done action with the `browser_await_human` tool.

### Modified Capabilities
- `browser-relay`:
  - ADDED: standard CDP clients attach, viewer-facing redaction, tab metadata tracking, and the `browser_show_in_pane` open announcement.
  - MODIFIED: deny-list (`setDownloadBehavior` ack-and-drop), screencast tap (`resize` input kind), tab viewability (connect page not listed), and audit trail (kinds `open`, `dropped`).
- `browser-plugin-settings`:
  - ADDED: the badge menu.
  - REMOVED: `Live-view tile`, `Live-view tile handles non-viewable tabs`, `Live view can be dismissed and re-opened`, and `Content-view gate follows plugin predicate changes`. The last one moves to `dashboard-shell-slots`.
- `dashboard-shell-slots`: ADDED the `editor-pane-tab` slot (a minor version of `pi-dashboard-shared`) and the generic content-view gate requirement.
- `shared-protocol`: the `resize` input kind (discriminated union), `agentEmulation` on tab status, and the core `editor_tab_open` message.
- `default-browser-skill`: the dashboard-relay recipe documents ack-and-drop, `browser_show_in_pane` and `browser_await_human`.
- `bridge-extension`: ADDED namespaced `pluginMeta` on dialog prompts.

## Discipline Skills

- `security-hardening`:
  - token/guid/connect-page redaction at every viewer egress;
  - the viewer input allowlist growing a `resize` kind;
  - an unspoofable `sessionId` on agent-initiated opens, plus the own-prefix rule on `ctx.openEditorTab`;
  - `pluginMeta` unable to spoof core prompt keys;
  - `?tab=` carrying untrusted path input.
- `doubt-driven-review`: three irreversible public-API steps:
  - a new `SlotId` plus `PluginClaim.pathPrefix` / label component in `pi-dashboard-shared`;
  - the `pluginMeta` dialog option;
  - the behavior change from denying `Browser.setDownloadBehavior` to acknowledging and dropping it.
- `observability-instrumentation`: the new `editor_tab_open` path and `browser_await_human` outcomes. These need `open` audit rows on both accept and refuse, so a failed agent-initiated open can be diagnosed.
- `review-code`: before commit. The change touches more than 3 React components and more than 3 server modules.

## Impact

- **Shared** (`packages/shared`):
  - `file-kind.ts`: `ViewerKind` gains `plugin`;
  - `dashboard-plugin/slot-types.ts`, `slot-props.ts` and `manifest-types.ts`: the slot, its props, `pathPrefix` and the label component;
  - `browser-protocol.ts`: the `resize` discriminated union and `agentEmulation`;
  - `protocol.ts`: `editor_tab_open`.
- **Plugin runtime** (`packages/dashboard-plugin-runtime`):
  - `manifest-validator.ts`: normalization and shape checks;
  - `vite-plugin/index.ts`: label import/export validation, emit, collision check;
  - `slot-registry.ts`: `ClaimEntry` fields;
  - `server/loader.ts`: registry hash fields;
  - `plugin-context.tsx`: `_pluginMeta` in the interactive snapshot;
  - a shared `openPluginTabRoute` helper.
- **Extension** (`packages/extension/src/bridge.ts`): the `buildMeta` `pluginMeta` pass-through.
- **Client** (`packages/client`):
  - `components/editor-pane/` (`EditorPane.tsx` plugin branch, `PluginTabHost`, `EditorTabs.tsx` label, `viewer-kinds.ts`, `pseudo-tab-registry.tsx` type);
  - `components/split/SplitWorkspaceContext.tsx` (`openPluginTab`);
  - `SplitRouteSync` / `SessionSplitView.tsx` (`?tab=`);
  - `lib/layout/editor-pane-state.ts` (per-entry hydration, derived `VALID_VIEWERS`);
  - `App.tsx` (the `tab` param in the apply key);
  - `hooks/useMessageHandler.ts` (keep `metadata.plugin`).
- **Browser plugin** (`packages/browser-plugin`):
  - client: new `BrowserPaneTab` and `BrowserTabLabel`; `BrowserRelayBadge` becomes a menu; `LiveViewTile` and `live-view-gate.ts` are removed; `relay-store` dismiss logic goes;
  - server: `relay/relay-instance.ts` (discovery shim, tab metadata, redaction, error code, emulation ownership), `relay/fake-relay-instance.ts` (parity for `resize`, `open` and redaction), `status.ts` (connect-page subscribe refusal), `relay/deny-list.ts`, `relay/viewer-input.ts` and `relay/screencast-tap.ts` (`resize`), `audit.ts` (kinds), `routes.ts` / status egress (redaction), a `registerPiRequestHandler("browser/open")`;
  - bridge: new `src/bridge/index.ts` with the two pi tools;
  - `package.json`: claims and the `bridge` entry.
- **Skill**: `packages/extension/.pi/skills/browser/references/dashboard-relay.md` and its `.AGENTS.md` sidecar.
- **Compatibility and rollback**:
  - New APIs are additive. The behavior changes are the `setDownloadBehavior` ack-and-drop and the removed browser `content-view` claim.
  - The per-entry hydration guard ships first and survives a feature revert.
  - Older clients ignore `metadata.plugin`.
  - No server data migration.
- **Tests**:
  - vitest for the validator, emitter and collisions; pane dispatch, labels and persistence; the opener and deep link; relay redaction, shims and metadata; the `resize` allowlist; `buildMeta`; the bridge tools;
  - an integration harness with real `agent-browser` and Playwright against `FakeExtension`;
  - Playwright E2E against the fake relay (`PI_BROWSER_RELAY_FAKE=1`).
