## 1. Per-entry pane hydration (separate first commit)

- [x] 1.1 In `packages/client/src/lib/layout/editor-pane-state.ts`: (test-plan: #E13, #E14)
  - derive `VALID_VIEWERS` from `OPEN_PATH_VIEWERS ∪ PSEUDO_TAB_VIEWERS`;
  - change hydration from all-or-nothing to dropping only entries with an unknown `viewer`, keeping every other structural check all-or-nothing;
  - re-derive `activeIndex` (keep the surviving active tab, else clamp).

  Verify with `lib/__tests__/editor-pane-state.test.ts` cases: one unknown entry among three keeps two and the active tab; a persisted `docx` tab no longer resets the pane. Commit alone (design D2).

## 2. Core seam: `editor-pane-tab` slot

- [x] 2.1 Shared types:
  - `"editor-pane-tab"` in `SlotId` plus a `SLOT_DEFINITIONS` entry (`many`, react-only), classified `never` in `SlotPredicateInput`;
  - `SlotPropsMap["editor-pane-tab"]`;
  - `PluginClaim.pathPrefix` and the label-component field;
  - `"plugin"` added to `ViewerKind` (`file-kind.ts`).

  Verify with `tsc --noEmit` on `packages/shared`, including the exhaustiveness assertions.
- [x] 2.2 `dashboard-plugin-runtime`: (test-plan: #E1, #E2, #E3, #E4)
  - validator: normalize and keep `pathPrefix` and the label component; regex; reserved `diff|term|url|live`; required body component;
  - Vite emitter: import the label component and validate its export (extending the `component`/`predicate`/`shouldRender` list); emit `pathPrefix` and `LabelComponent`; add a cross-plugin prefix collision check following the `customType` precedent;
  - `ClaimEntry`: carry both fields;
  - `server/loader.ts` `deterministicSerializePlugins`: include both fields.

  Verify with:
  - validator and emitter tests for each rejection, the missing label export and the accept case;
  - a generated-registry assertion that both fields survive;
  - a hash test showing that a `pathPrefix`-only edit changes the hash.
- [x] 2.3 `viewer-kinds.ts`: add `"plugin"` to `PSEUDO_TAB_VIEWERS`, and narrow the `pseudoTabRegistry` type to exclude `plugin`. In `EditorPane.tsx`, add a `viewer === "plugin"` branch rendering the new `PluginTabHost` (resolves the claim by prefix; renders the body with `{path, session, isActive, onClose, pluginContext}` or the "Tab unavailable" placeholder plus Close). Update `editor-pane/__tests__/viewer-registry.test.tsx` (registry keys exclude `plugin`, union total 20, and `plugin` is rendered by `PluginTabHost`, not the registry). Verify that the partition proofs compile, and that RTL tests show a claimed prefix renders, an unclaimed prefix shows the placeholder, Close removes the tab, and no `/api/file` request is made. (test-plan: #E16)
- [x] 2.4 `EditorTabs.tsx`: render the claim's label component (always mounted) for plugin tabs, else the prefix. Verify with an RTL test that a background tab's label updates.
- [x] 2.5 Wire the opener and deep link: (test-plan: #E8)
  - `SplitWorkspaceContext.tsx`: add `openPluginTab(path)` (claimed-prefix check, then `openFile {viewer: "plugin"}`, which focuses or adds); exclude pseudo and plugin paths from the file-watch `openPathsKey`.
  - `App.tsx`: parse every `tab` value and add them to the `SplitRouteSync` apply key alongside `openNonce`. `SplitRouteSync`: call `openPluginTab` per value in order, ignoring unclaimed or built-in prefixes.
  - Add a shared helper `openPluginTabRoute(navigate, sessionId, paths[])` that does one navigation with a fresh `openNonce`.

  Verify with tests for open, multi-`tab`, focus-without-duplicate, re-open after close (fresh nonce), the session switch, the ignored case, and no virtual path in the watch set.
- [x] 2.6 Add the core server-initiated open: (test-plan: #X16)
  - plugin-server host API `ctx.openEditorTab(sessionId, path)`, own-prefix only, broadcasting `editor_tab_open {sessionId, path}`;
  - the `EditorTabOpenMessage` type in `shared/src/protocol.ts`;
  - an `App.tsx` handler that acts only on `/session/<sessionId>` or `/session/<sessionId>/editor` and calls `openPluginTabRoute`.

  Verify with tests for a foreign prefix rejected, a viewer of the session opening, and no navigation on another session, the settings overlay or landing.
- [x] 2.7 Run `doubt-driven-review` on the shipped public API (`SlotId`, `pathPrefix`/label, `ctx.openEditorTab`, `pluginMeta`) before merging group 2. Record the outcome in `design.md` D1.

## 3. Relay fixes (`packages/browser-plugin/src/server/`)

- [x] 3.1 Add the redaction helpers `redactExtensionUrl` and `isRelayConnectPage`, applied at every viewer egress (status broadcast, `/api/browser/profiles`, audit detail, `editor_tab_open` paths). Omit the connect page from tab lists. Refuse subscribe and input to it, auditing `viewer-subscribe-refused` with reason `extension-page`. Verify with: (test-plan: #X4, #X6)
  - a helper table test;
  - route and status tests asserting no `token=`, `mcpRelayUrl` or guid while connected, and an empty tab list when only the connect page exists;
  - a test that a subscribe to the connect page starts no screencast.
- [x] 3.2 In `relay-instance.ts`: answer `Target.setDiscoverTargets` `{}` locally. On enable, announce attached tabs. Then mirror the vendored `attachedToTarget`/`detachedFromTarget` as `targetCreated`/`targetDestroyed`, idempotent per `targetId`. Do not mirror child sessions; `{discover: false}` stops mirroring. Drop model→client attach/detach events for the connect page, and fail CDP-client commands addressed to its session. Unservable browser-level commands reply with `code: -32000`. Verify with `relay-instance.test.ts`: (test-plan: #X3, #X5)
  - no attached tab means success and the instance stays open;
  - enabling discovery after auto-attach announces exactly once;
  - the connect page is never announced nor attached-to on the CDP path;
  - no child-session announcement;
  - discover:false stops announcements;
  - the error code is present.
- [x] 3.3 `deny-list.ts`: move `Browser.setDownloadBehavior` to `ACK_AND_DROP_METHODS` (reply `{}`, never forwarded). `audit.ts`: add the kinds `dropped` and `open`. Verify with updated E12 tests: a success reply, not forwarded, audited `dropped`. (test-plan: #E11, #X7, #X8, #X9)
- [x] 3.4 Add a tab-metadata overlay refreshed by a relay-issued `Target.getTargetInfo` sent **through the extension** (bypassing the vendored cached handler) after main-frame `Page.frameNavigated`/`loadEventFired`, on subscribe, and after `Page.navigate`. A change calls the coalescing `status.schedule()`. Entries are deleted on tab removal and on close. `tabList()` keeps its id set and overrides only title and URL. Verify with tests: (test-plan: #X11, #P1)
  - a `Page.navigate` updates status;
  - a link-click navigation (an event without any CDP command) updates status;
  - a removed tab leaves no entry.
- [x] 3.5 Implement `resize`: (test-plan: #E5, #E6, #X10)
  - `viewer-input.ts`: add `resize` to `ALLOWED_KINDS` and `ViewerInputMessage` (`width`, `height`) → `Emulation.setDeviceMetricsOverride`, clamped; drop non-numeric values with audit.
  - `relay-instance.ts`: track whether the CDP client holds a device-metrics override per tab session (set by `setDeviceMetricsOverride`, released by `clearDeviceMetricsOverride`). While held, refuse viewer `resize` with `agent-emulation-active` and report `agentEmulation: true` in status.
  - `screencast-tap.ts`: clear the relay-set override on the last unsubscribe and in `closeAll`/finalize (best effort).

  Verify with BVA tests (319/320/3840/3841 and 239/240/2160/2161) and tests for clear on last unsubscribe, clear on instance close, the agent-emulation refusal with its status flag, and resize allowed again after the agent clears.
- [x] 3.6 Build an integration harness: real `agent-browser connect` and Playwright `connectOverCDP` against a relay backed by `FakeExtension`. Both must attach, create a target and navigate. For any further pre-attach verb that fails, add a tab-independent local answer. Verify the harness is green (skip with a reason when agent-browser is absent). (test-plan: #X1, #X2)

- [ ] 3.7 Bring `fake-relay-instance.ts` to parity: accept `resize` (audit it), report redacted tabs, and support `browser/open` resolution. Verify that the existing fake tests plus new parity tests pass under `PI_BROWSER_RELAY_FAKE=1`. (test-plan: #X15)

## 4. Prompt metadata seam (extension + client)

- [ ] 4.1 In `packages/extension/src/bridge.ts` `buildMeta`, copy `opts.pluginMeta` into `metadata.plugin`: (test-plan: #E7, #E12, #X14)
  - accept only a plain object that `JSON.stringify` serializes without throwing, at ≤ 2048 UTF-8 bytes;
  - produce metadata even with no message and no `toolCallId`;
  - route `ctx.ui.multiselect` through `buildMeta` too;
  - never override `message`, `toolCallId` or `kind`;
  - drop invalid input with a warning.

  Verify with tests for pass-through, a metadata-only `select`, core-key spoofing, a class instance or `BigInt`, and oversize.
- [ ] 4.2 Client: in the `useMessageHandler.ts` `prompt_request` case, copy `metadata.plugin` into the interactive request `params._pluginMeta`, and expose it in the `InteractiveUiRequestSnapshot` (`plugin-context.tsx`). Verify with a reducer/handler test that a `prompt_request` with `metadata.plugin` yields a snapshot carrying it.

## 5. Browser plugin bridge and open path

- [ ] 5.1 Add `packages/browser-plugin/src/bridge/index.ts` and the `package.json` `bridge` entry, registering the pi tools `browser_show_in_pane {instanceId, tabId?}` and `browser_await_human {instanceId, reason}`. Verify with a bridge test that both register and call `requestPluginServer("browser", "browser/open", …)`.
- [ ] 5.2 Server: `registerPiRequestHandler("browser/open")`. It takes `sessionId` from the handler context only, resolves the default tab (excluding the connect page; `no-tab` when none), calls `ctx.openEditorTab(sessionId, "browser:<inst>:<tab>")`, and audits `open` on accept and on refusal. Enforce the 5 s per (session, instance) rate limit for `browser_show_in_pane` only; `browser_await_human` is exempt. Prune entries older than 5 s on each call and drop them on instance close. Verify with tests for accept, the spoofed payload `sessionId` being ignored, `disabled`, `rate-limited`, the takeover exemption, `no-tab` and the unknown tab. (test-plan: #E9, #E10, #E15, #X12)
- [ ] 5.3 `browser_await_human`: use the per-call ToolContext `ctx.ui` (5th `execute` arg) and check `ctx.hasUI` (no UI → `cancelled`, reason `no-ui`). Open, then `ctx.ui.confirm(…, {pluginMeta: {pluginId: "browser", kind: "browser-takeover", instanceId}})`, returning `done` or `cancelled`. Verify with tests for confirm, decline, timeout and no UI, using a stub ToolContext. (test-plan: #X13)
- [x] 5.4 Shared protocol: restructure `BrowserRelayInputMessage` into a union discriminated on `kind` (existing kinds keep their fields; `resize` requires `width` and `height`), and add `agentEmulation?` to the tab status in `browser-protocol.ts`. Update the existing senders and receivers. Verify with `tsc` and union-narrowing type tests.

## 6. Browser pane tab (client)

- [ ] 6.1 Claim `editor-pane-tab` with `pathPrefix: "browser"`, the `BrowserPaneTab` body and the `BrowserTabLabel` label, then regenerate the registry. Verify the registry entry carries both fields.
- [ ] 6.2 `BrowserPaneTab`: extract the subscribe, frame and input logic from `RelayTile`. Subscribe only while mounted and viewable, re-subscribe on detached→viewable, and render the "no longer available", detached and waiting states. Verify by porting the `LiveViewTile.test.tsx` F5–F9 cases plus the background unsubscribe, re-subscribe and removed-tab tests. (test-plan: #F2, #F3, #F4, #F6)
- [ ] 6.3 Idle state: the last frame stays unobscured, with a non-blocking idle indicator and Bring to front. Verify with an RTL test (test-plan #F5).
- [ ] 6.4 Toolbar (redacted URL, Input toggle, Fit/1:1, Bring to front, Done). Verify that Input off sends no input and Bring to front still works (test-plan #F7).
- [ ] 6.5 Pointer Events (tap = click), `touch-action: none` and `user-select: none`. Verify a centre tap sends `{x: 0.5, y: 0.5}` and a drag leaves no selection (test-plan #F8).
- [ ] 6.6 Text-entry bridge. Verify `abc` + Enter sends four key inputs in order and the input is cleared (test-plan #F9).
- [ ] 6.7 Resize-to-pane via ResizeObserver (≤ 2/s, 16 px dead-band, none while Input is off). While status reports `agentEmulation: true`, send nothing and use Fit; resume when the flag clears. Verify with a fake-timer test and agentEmulation on/off tests (test-plan #F10, #P2).
- [ ] 6.8 Done action: shown for a pending prompt with `metadata.plugin.kind === "browser-takeover"`, a matching `instanceId` and the owning session; it sends the standard prompt response. Verify that one click resolves the prompt once, and Done disappears when the prompt is answered from chat or times out (test-plan #F11).
- [ ] 6.9 End-to-end agent open: `browser_show_in_pane` → `editor_tab_open` → the pane shows `browser:<inst>:<tab>` for a client on that session. Verify with an integration test covering re-open after close.
- [ ] 6.10 `BrowserRelayBadge` becomes a menu ("Open in pane", "Open all in pane", keyboard navigable), targeting the card's session via `openPluginTabRoute` (which also selects that session; "Open all" is one navigation with every tab). Verify with RTL click (test-plan #F13) and keyboard tests and the open-all de-duplication case.
- [ ] 6.11 `BrowserTabLabel`: title (fallback: URL host, then "Browser tab") plus a state dot from the relay store covering `live`, `no-frames`, `detached` and `client-screencast-active`. Verify with an RTL test (test-plan #F12, #F16).

## 7. Remove the content-view takeover

- [ ] 7.1 Delete the `content-view` claim, `LiveViewTile.tsx`, `live-view-gate.ts`, `dismissLiveView`/`reopenLiveView` and their tests, then regenerate the registry. Verify no `browser` claim on `content-view` remains and `packages/browser-plugin` tests pass.
- [ ] 7.2 Verify `SessionContentGate` with a non-browser fixture claim (spec `dashboard-shell-slots` "Content-view gate re-evaluates on slot-claims changes") (test-plan #F18).

## 8. Skill, docs

- [ ] 8.1 Update `packages/extension/.pi/skills/browser/references/dashboard-relay.md` (ack-and-drop, `browser_show_in_pane`, `browser_await_human`) and its `.AGENTS.md` sidecar. Verify the browser-skill registration test passes (test-plan #X17).
- [ ] 8.2 Update the DOX rows for every touched directory (`packages/browser-plugin/**`, `packages/client/src/components/editor-pane/`, `split/`, `lib/layout/`, `packages/dashboard-plugin-runtime/src/`, `packages/extension/src/`). Delegate the `docs/plugin-seams.md` slot and `pluginMeta` prose to DocScribe. Verify `node scripts/check-conventions.mjs` passes.
- [ ] 8.3 Update `packages/browser-plugin/README.md`: live view in the pane, bridge tools, prerequisites (Chrome plus the Playwright Extension on the server host). Verify by review.

## 9. Final gates

- [ ] 9.1 Run `review-code` on the full diff, then `npm test` with the pipefail log pattern from AGENTS.md. Verify zero failures.

## 10. E2E fold (Playwright, docker harness + `PI_BROWSER_RELAY_FAKE=1`)

Exemplar for all four: `tests/e2e/browser-relay.spec.ts` (harness port from `.pi-test-harness.json` `dashboardPort`, never `:18000`).

- [ ] 10.1 Badge → pane (test-plan #F1). Triple: fake relay with 2 tabs (input) · click badge, choose "Open in pane" (trigger) · session selected, pane shows the browser tab with frames beside the visible chat (observable).
- [ ] 10.2 `editor_tab_open` routing (test-plan #F14). Triple: broadcast for session S (input) · clients on S-chat, S-editor, another session, the settings overlay, landing (trigger) · on-route clients open or focus the tab, all others do not navigate (observable).
- [ ] 10.3 Unavailable placeholder (test-plan #F15). Triple: persisted `browser:` tab with the plugin disabled (input) · reload the pane (trigger) · placeholder naming `browser`, Close removes it from persisted state (observable).
- [ ] 10.4 Agent-initiated open e2e (test-plan #F17). Triple: agent session calls `browser_show_in_pane` (input) · tool executes (trigger) · client on that session shows `browser:<inst>:<tab>` active; re-open after close works (observable).

## 11. Manual-only (deferred post-merge)

- [ ] 11.1 Phone soft keyboard (test-plan: manual-only, #M1). Tap a field, focus the bridge input, type — the keyboard raises and characters land in the remote page.
- [ ] 11.2 Phone tap (test-plan: manual-only, #M2). Tapping a link in the frame acts as a click at the tapped point.
- [ ] 11.3 Idle indicator aesthetics (test-plan: manual-only, #M3). The idle dot/caption reads as idle, not broken — visual pass in the mockup loop.
