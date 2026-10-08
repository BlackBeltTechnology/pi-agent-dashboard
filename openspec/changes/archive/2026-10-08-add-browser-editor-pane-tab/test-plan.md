# Test Plan — add-browser-editor-pane-tab

Stage: proposal (plan-proposal driving)   Generated: 2026-10-06

Levels: L1 = vitest (packages/*/**/__tests__/, jsdom/RTL counts as L1) · L3 = Playwright vs the docker harness (`docker/test-up.sh` derives the port; read it from `.pi-test-harness.json` `dashboardPort`, never `:18000`). No L2 rows: nothing in this change is multi-OS/process-install specific. L3 rows run against `PI_BROWSER_RELAY_FAKE=1`.

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | editor-pane-plugin-tabs · prefix claim | EP+BVA | L1 | automated | prefixes: `ab`, `a`, 33×`a`, `Browser`, `a b`, `term` | validate a manifest with each as `pathPrefix` | `ab` accepted; every other rejected with an error naming plugin+prefix; `term` rejected as reserved |
| E2 | editor-pane-plugin-tabs · collisions | decision-table | L1 | automated | two plugins both claiming `browser` | generate the registry | generation fails; the error names both plugins and `browser` |
| E3 | dashboard-shell-slots · `editor-pane-tab` slot | fault (missing export) | L1 | automated | claim whose label component name is not exported | generate the registry | generation fails naming the plugin and the missing export |
| E4 | dashboard-shell-slots · claim fields + hash | equivalence | L1 | automated | valid claim with `pathPrefix` + label; then edit `pathPrefix` only | normalize → emit → load; recompute `PLUGIN_REGISTRY_HASH` | both fields present on the runtime claim entry; the hash changes after the prefix-only edit |
| E5 | shared-protocol · resize input (incl. union narrowing) | BVA | L1 | automated | `resize` widths 319/320/3840/3841, heights 239/240/2160/2161; `kind:"resize"` switch | send each as `browser_relay_input` | 320/3840/240/2160 reach `Emulation.setDeviceMetricsOverride`; the others are dropped with an audit entry; the type narrows to required numeric `width`/`height` |
| E6 | browser-relay · resize payload validity | fault | L1 | automated | `resize` with `width:"800"`, or missing `height` | send as `browser_relay_input` | dropped with an audit entry; no emulation command sent |
| E7 | bridge-extension · pluginMeta size | BVA | L1 | automated | `pluginMeta` serializing to 2048 vs 2049 UTF-8 bytes | `ctx.ui.confirm(…, {pluginMeta})` | 2048 → `metadata.plugin` present; 2049 → dropped, warning logged, prompt still raised |
| E8 | editor-pane-plugin-tabs · deep link multi-tab | equivalence | L1 | automated | `/session/S/editor?tab=browser%3Ai%3A1&tab=browser%3Ai%3A2` | follow the link once | both tabs open exactly once; `browser:i:2` active; no duplicate when re-applied with a fresh nonce |
| E9 | browser-relay · open rate limit | decision-table | L1 | automated | `browser_show_in_pane` twice within 5 s (same session+instance); then `browser_await_human` within 5 s | invoke the tools | 2nd show returns `rate-limited` + audited refusal; the takeover open is still broadcast |
| E10 | browser-relay · limiter lifetime | state-transition | L1 | automated | limiter entry older than 5 s; instance closed | next `browser_show_in_pane` | old entry pruned (open accepted); map empty after instance close |
| E11 | browser-relay · audit kinds | equivalence | L1 | automated | one ack-and-drop (`setDownloadBehavior`) + one denial (`Network.getAllCookies`) | read `GET /api/browser/audit` | one row kind `dropped`, one row kind `denied` |
| E12 | bridge-extension · pluginMeta validity | decision-table | L1 | automated | plain object / class instance / contains `BigInt` / `pluginMeta`-only `ctx.ui.select` | raise the dialog | plain+only → `metadata.plugin` present; instance/BigInt → dropped with warning, prompt raised; core keys never overridden |
| E13 | editor-pane-plugin-tabs · per-entry hydration | decision-table | L1 | automated | persisted pane: 3 tabs, one with unknown viewer, active = a surviving tab; variant: a `docx` tab | hydrate | unknown tab dropped, other two kept, active preserved; the `docx` tab is kept (no wipe) |
| E14 | editor-pane-plugin-tabs · structural checks preserved | fault | L1 | automated | persisted state with `unread: 42` / missing `treeOpenRoots` | hydrate | whole state resets to empty (all-or-nothing for structure, per-entry only for unknown viewers) |
| E15 | browser-relay · default tab resolution | equivalence | L1 | automated | instance whose only attached tab is the connect page; then one normal tab added | `browser_show_in_pane` without `tabId` | first call → `no-tab` error, nothing broadcast; second → opens the normal tab |
| E16 | editor-pane-plugin-tabs · registry partition | equivalence | L1 | automated | `pseudoTabRegistry` keys; `ViewerKind` union | type-check + runtime assert | `plugin` not a registry key; union total 20; partition proof compiles |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | browser-relay · metadata coalescing | threshold | L1 | automated | 20 main-frame `frameNavigated` events in 100 ms on one tab | ≤ 1 `browser_relay_status` broadcast per 500 ms window; final status carries the last URL/title | 2 s |
| P2 | browser-pane-tab · resize throttle | threshold | L1 | automated | continuous divider drag for 2 s, input on | ≤ 4 `browser_relay_input resize` on the socket; last carries the final size | 2 s |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|--------------------------------|
| F1 | browser-plugin-settings · badge menu; browser-pane-tab · pane tab | state-convergence | L3 | automated | fake relay with 2 tabs | click badge → "Open in pane" | session selected; pane shows the browser tab with frames beside the visible chat |
| F2 | browser-pane-tab · subscribe lifecycle | state-transition | L1 | automated | open pane tab, then close it | mount → unmount | exactly one subscribe then one unsubscribe for the same `{instanceId, tabId}` |
| F3 | browser-pane-tab · lifecycle edges | state-transition | L1 | automated | tab backgrounds; re-activates; relay tab removed from status | switch tabs; delete relay tab | background → unsubscribe; active → one re-subscribe; removed → "no longer available" placeholder, input blocked |
| F4 | browser-pane-tab · re-subscribe on viewable | state-transition | L1 | automated | relay tab goes `detached/no-session` → `live` | status flip while pane tab active | exactly one new subscribe, no remount |
| F5 | browser-pane-tab · idle state | invariant | L1 | automated | frame rendered, then `no-frames` | status flip | the frame `<img>` stays visible and unobscured; idle indicator + Bring to front present |
| F6 | browser-pane-tab · detached states | state-transition | L1 | automated | `detached` reason `devtools`, then `no-session` | status flip | devtools → frame hidden, input blocked, overlay text; no-session → its overlay text, no "Waiting for frames…" |
| F7 | browser-pane-tab · input toggle | decision-table | L1 | automated | Input off | click / wheel / key on the frame | zero `browser_relay_input` sent; Bring to front still sent |
| F8 | browser-pane-tab · pointer input | equivalence | L1 | automated | tap at frame center; press-move-release across the frame | Pointer Events | one click `{x:0.5, y:0.5}`; drag leaves no document selection |
| F9 | browser-pane-tab · text bridge | state-convergence | L1 | automated | focus bridge input, type `abc` + Enter | keystrokes | 4 `key` inputs in order (a, b, c, Enter); input value empty after |
| F10 | browser-pane-tab · viewport follows pane | state-transition | L1 | automated | pane resize with input on; `agentEmulation: true`; flag clears | ResizeObserver fires | ≤ 2 req/s with 16 px dead-band; while flagged → zero requests and Fit; resumes after clear |
| F11 | browser-pane-tab · takeover Done | state-transition | L1 | automated | pending `browser-takeover` prompt for the instance; answered in pane / in chat / timed out | click Done; answer elsewhere; wait | Done visible only while pending; pane answer resolves the prompt exactly once and the tool returns `done`; chat answer or timeout removes Done (`cancelled`) |
| F12 | browser-pane-tab · state indicator | equivalence | L1 | automated | tab states `live` / `no-frames` / `detached` / `client-screencast-active` | status flips | label dot shows each of the four states |
| F13 | browser-plugin-settings · badge menu semantics | decision-table | L1 | automated | 2 relay tabs, one already open; keyboard-only user | "Open all in pane" / arrows+Enter | one navigation; every tab open once; last listed active; menu fully keyboard-operable |
| F14 | editor-pane-plugin-tabs · `editor_tab_open` routing | state-transition | L3 | automated | broadcast for session S; clients on S-chat / S-editor / another session / settings overlay / landing | receive `editor_tab_open` | on-route clients open or focus `browser:i:42`; all others do not navigate |
| F15 | editor-pane-plugin-tabs · unavailable placeholder | state-transition | L3 | automated | persisted `browser:` tab; disable the browser plugin | reload the pane | placeholder naming `browser` + Close; Close removes it from persisted state |
| F16 | editor-pane-plugin-tabs · background label | invariant | L1 | automated | pane tab in background; relay tab title changes | status update | tab strip label updates without the body being mounted |
| F17 | browser-relay · agent-initiated open e2e | state-convergence | L3 | automated | agent session calls `browser_show_in_pane` | tool executes | client on that session shows `browser:<inst>:<tab>` active; re-open after close works |
| F18 | dashboard-shell-slots · content-view gate | state-transition | L1 | automated | fixture plugin's `content-view` predicate flips on an idle session | slot-claims bump | the gate re-renders without any session event |
| M1 | browser-pane-tab · soft keyboard | hardware | — | manual-only | phone viewer, real soft keyboard | tap a field, focus the bridge input, type | keyboard raises; characters land in the remote page |
| M2 | browser-pane-tab · touch tap | hardware | — | manual-only | phone viewer | tap a link in the frame | the tap acts as a click at the tapped point |
| M3 | browser-pane-tab · idle indicator aesthetics | subjective | — | manual-only | the idle dot/caption treatment | human looks | "reads as idle, not broken" — visual pass in the mockup loop |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | browser-relay · agent-browser compat | fault-injection (real client) | L1 | automated | relay backed by `FakeExtension`; no attached tab | `agent-browser connect <cdpUrl>`; `open https://example.com` | connect succeeds; the tab is created inside the instance's tab group; no second browser spawned (skip when agent-browser absent) |
| X2 | browser-relay · Playwright compat | fault-injection (real client) | L1 | automated | same relay | `chromium.connectOverCDP(cdpUrl)`; `newPage().goto` | handshake completes; the page navigates to the allowed URL |
| X3 | browser-relay · discovery shim | state-transition | L1 | automated | `setDiscoverTargets` before any attach; after auto-attach; `{discover:false}`; child session attach | enable in each order | `{}` always; tab announced exactly once; false stops announcements; child sessions never announced; instance never closes |
| X4 | browser-relay · connect page refusal | fault | L1 | automated | connect page is a known tab | viewer subscribes / sends input to it; CDP client sends a command to its session | no screencast starts; `viewer-subscribe-refused` audited with `extension-page`; CDP command fails; no frame ever leaves |
| X5 | browser-relay · unservable browser-level command | fault | L1 | automated | `Browser.getVersion`-class command with no attached tab | send on the CDP socket | reply `{error:{code:-32000,…}}`; instance stays open |
| X6 | browser-relay · viewer-facing redaction | fault (leak hunt) | L1 | automated | connected instance; connect page open; extension tab with `?x=1#f` | GET `/api/browser/profiles` + `/audit`; read status stream | no `token=`, `mcpRelayUrl` or guid anywhere; query/fragment stripped; connect page absent from all lists |
| X7 | browser-relay · ack-and-drop | fault | L1 | automated | `Browser.setDownloadBehavior` on the CDP socket | send during handshake | success `{}` reply; not forwarded to the extension; audit kind `dropped` |
| X8 | browser-relay · cookie verbs | fault | L1 | automated | `Network.getAllCookies` / `Network.getCookies` / `Storage.getCookies` | send | `-32000` policy error; audit `denied`; not forwarded |
| X9 | browser-relay · navigation fences | decision-table | L1 | automated | `file:` `javascript:` `vbscript:` `data:` `blob:`; allowedDomains exact / `.dot` / lookalike `github.com.evil.io` | `Page.navigate` + `Target.createTarget` | schemes denied; exact+subdomain allowed; lookalike denied; case-insensitive |
| X10 | browser-relay · emulation ownership | state-transition | L1 | automated | agent sets / clears `Emulation.setDeviceMetricsOverride`; viewer resize before, during, after; last unsubscribe; instance finalize | sequence per state | during agent hold: viewer resize refused + `agentEmulation:true` in status; after clear: applied; relay override cleared on last unsubscribe; best-effort clear at finalize |
| X11 | browser-relay · tab metadata sources | state-transition | L1 | automated | CDP `Page.navigate`; viewer link-click navigation; viewer subscribe; tab removed | each event | status shows new url+title in every source case; removed tab leaves no entry and no ghost tab |
| X12 | browser-relay · open errors | fault | L1 | automated | payload `sessionId:"T"` from session S; relay disabled; unknown instance/tab | invoke `browser_show_in_pane` | broadcast always carries `S`; `disabled` / unknown errors name the cause; nothing broadcast on refusal; every call audited `open` |
| X13 | browser-pane-tab · takeover outcomes | decision-table | L1 | automated | confirm / decline / timeout / no-UI session | `browser_await_human` | `done` / `cancelled` / `cancelled` / `cancelled` with reason `no-ui` and no prompt raised |
| X14 | bridge-extension · pluginMeta faults | fault | L1 | automated | value that throws `JSON.stringify` | raise dialog | dropped with warning; prompt raised without `metadata.plugin` |
| X15 | browser-relay · fake parity | equivalence | L1 | automated | `PI_BROWSER_RELAY_FAKE=1` | resize, open resolution, tab list | fake accepts+audits `resize`; open resolves; tabs redacted like the real relay |
| X16 | editor-pane-plugin-tabs · host prefix rule | fault | L1 | automated | browser plugin calls `ctx.openEditorTab(S, "term:1")` and `("other:x")` | host API | both rejected; nothing broadcast |
| X17 | default-browser-skill · recipe content | equivalence | L1 | automated | `references/dashboard-relay.md` | run the browser-skill registration test | file registered; contains `browser_show_in_pane`, `browser_await_human` and the ack-and-drop wording |

## Coverage summary

- Requirements covered: 24/24 (editor-pane-plugin-tabs 5 · browser-pane-tab 7 · browser-relay 9 · browser-plugin-settings 1 · dashboard-shell-slots 2 · shared-protocol 2 · default-browser-skill 1 · bridge-extension 1 — REMOVED requirements have no scenarios by definition)
- Scenarios by class: edge 16 · perf 2 · frontend 21 (18 automated + 3 manual-only) · error 17
- Scenarios by level: L1 51 · L3 4 · — 3
- Scenarios by disposition: automated 53 · manual-only 3

## New infra needed

- none. L3 reuses `tests/e2e/browser-relay.spec.ts` (harness exemplar) with `PI_BROWSER_RELAY_FAKE=1`; X1/X2 reuse the vitest forks pool with a spawned `agent-browser` (skip-with-reason pattern already used in the repo).
