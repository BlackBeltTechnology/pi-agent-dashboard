# Test Plan — fix-empty-status-subcard

Stage: design   Generated: 2026-10-14

The hard gate is cleared. No Triple slot is left unfillable after doubt-review cycles 1–3, which pinned:
- the gate primitive (`relayTabsOf` / `hasRelayTabs`);
- the bump order;
- the D5 re-seed and clear rules;
- the mount placement;
- the validator rule.

Levels:
- **L1** covers relay-store and slot logic in vitest + jsdom. These tests seed the store directly or emit through the `test-utils.tsx` fake WS.
- **L3** uses the existing relay-fake harness leg (`PI_E2E_SEED=1 PI_BROWSER_RELAY_FAKE=1`, which seeds one socket-less `Fake` instance with `tabId: 1`; the F3 kill switch removes it). The default harness has the browser plugin off and serves as the zero-tab baseline.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | design D1 — `relayTabsOf`/`hasRelayTabs` | EP (payload classes) | L1 | automated | statuses: `null`; `{instances: []}`; `{instances: [{tabs: []}]}`; `{instances: [{tabs: [t1]}]}`; `{instances: [{tabs: []},{tabs: [t1,t2]}]}`; `{}` (no instances); `{instances: {}}` (non-array); `{instances: [{}]}` (no tabs); `{instances: [{tabs: "x"}, {tabs: [t1]}]}` | call `relayTabsOf` + `hasRelayTabs` | lengths `0,0,0,1,2,0,0,0,1`; `hasRelayTabs` is `true` exactly for lengths ≥1; no call throws; the return type is a strict boolean (`=== true`/`=== false`) |
| E2 | session-card-subcards — gate/render agreement (browser claim) | invariant over E1 corpus | L1 | automated | each E1 status seeded into the store | render `BrowserRelayBadge` and evaluate `hasRelayTabsForBadge()` | for every status, the badge renders a non-null element **iff** `hasRelayTabsForBadge()` is `true`; no `SlotErrorBoundary` fallback is rendered |
| E3 | session-card-subcards — STATUS hidden with zero tabs | decision table (goal × automation × relay tabs × browser plugin visible) | L1 | automated | desktop `SessionCard` with registry claims {goal `hasGoal`, automation `isAutomationRun`, browser `hasRelayTabsForBadge`}; rows: (no goal, no auto, 0 tabs), (no goal, no auto, 1 tab), (goal, no auto, 0 tabs), (no goal, auto, 0 tabs), (no goal, no auto, 1 tab, `isPluginVisible("browser")=false`) | render card | `STATUS` title is present only in rows 2, 3, 4; it is absent in rows 1 and 5 |
| E4 | session-card-subcards — composer STATUS group hidden with zero tabs | EP | L1 | automated | `ComposerSessionActions` for a session with no goal / no automation; browser claim registered; relay store 0 tabs, then 1 tab | render the composer | 0 tabs → no STATUS group label node is rendered; 1 tab → STATUS label present with the badge trigger |
| E5 | session-card-subcards — every badge claim is gated | contract | L1 | automated | generated `packages/client/src/generated/plugin-registry.tsx` | iterate `session-card-badge` claims | each claim has `predicate` or `shouldRender`; allow-list is empty; test fails if the browser claim's `shouldRender` is removed |
| E6 | dashboard-shell-slots — slot definition | contract | L1 | automated | `SLOT_DEFINITIONS`, `SlotPropsMap` | read `"shell-headless"` | entry exists with `multiplicity: "many"`, payload tier `react-only`; `SlotPropsMap["shell-headless"]` is an empty object type (type-level assertion compiles) |
| E7 | dashboard-shell-slots — exactly one App mount | static analysis | L1 | automated | source of `packages/client/src/App.tsx` | count `<ShellHeadlessSlot` JSX occurrences and locate them | exactly 1 occurrence; it lies inside the `apiProvider` arrow body (between `const apiProvider` and its closing `)`), i.e. inside `PluginContextProvider` |
| E8 | dashboard-shell-slots — validator rejects gated headless claim | EP (field variants) | L1 | automated | manifests with a `shell-headless` claim carrying (a) `shouldRender: "x"`, (b) `predicate: "x"`, (c) neither | `validateManifest` | (a) and (b) fail with an error string containing both the plugin id and `shell-headless`; (c) passes |
| E9 | dashboard-shell-slots — no wrapper element, no intents | contract | L1 | automated | registry with two `shell-headless` claims rendering `<i data-testid="h1"/>` and `<i data-testid="h2"/>`; plus an intent posted to `shell-headless` | render `<div data-testid="root"><ShellHeadlessSlot/></div>` | `root.children` are exactly `h1`,`h2` (no wrapper element between); the intent is not rendered |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | session-card-subcards — first relay tab arrives | state-transition 0→1 | L1 | automated | mounted desktop `SessionCard` (no goal/auto) + mounted `BrowserRelayFeed`; store 0 tabs; no further session prop changes | fake WS emits `browser_relay_status` with 1 tab | converges to `STATUS` title present containing the badge trigger; the session object passed to the card is referentially unchanged throughout |
| F2 | session-card-subcards — last relay tab closes | state-transition 1→0 | L1 | automated | as F1, after it converged with 1 tab | fake WS emits status with 0 tabs | converges to no `STATUS` title; no empty `SessionSubcard` panel remains in the DOM |
| F3 | design D3 — bump only on flip | state-transition (non-flip edges) | L1 | automated | spy on `bumpSlotClaimsVersion`; store sequence `null → 0 tabs → 1 tab → 2 tabs → 2 tabs → 0 tabs → null` via `setRelayStatus` | apply the sequence | bump called exactly 2 times (at `0→1` and `2→0`); store listeners notified 6 times |
| F4 | design D3 — snapshot visible to gate when bumped | ordering | L1 | automated | a `useSlotClaimsVersion` subscriber that reads `getRelayStatus()` inside its listener | `setRelayStatus` with a 0→1 flip | the value read inside the claims-version listener is the new (1-tab) snapshot |
| F5 | session-card-subcards — feed independent of cards | state-transition | L1 | automated | `ShellHeadlessSlot` mounted with the browser registry, zero `SessionCard`s | fake WS emits status with 1 tab; then mount a `SessionCard` (no goal/auto) | `getRelayStatus()` holds the 1-tab snapshot before any card exists; the newly mounted card shows `STATUS` with the badge |
| F6 | dashboard-shell-slots — runtime enable mounts claim | state-transition (disabled→enabled) | L1 | automated | registry with a `shell-headless` claim rendering `<i data-testid="hl"/>`; `setEnabledSet` excludes the plugin | `setEnabledSet` including the plugin + `bumpSlotClaimsVersion()` (the `usePluginEnabledSet` path) | `hl` absent before, present after, with no remount of the slot's parent |
| F7 | dashboard-shell-slots — disabled plugin claim unmounted | state-transition (enabled→disabled) | L1 | automated | as F6, plugin enabled and `hl` mounted | `setEnabledSet` excluding the plugin + bump | `hl` is removed from the DOM; for the browser feed, the store is `null` after unmount |
| F8 | dashboard-shell-slots — mounted with zero sessions / any branch | invariant | L1 | automated | `ShellHeadlessSlot` inside a `PluginContextProvider` with `sessions=[]`, `selectedSessionId=null` | render | the headless claim is mounted (E7 pins that every App return branch goes through `apiProvider`) |
| F9 | D5 — re-seed fires on mount when already connected | state-transition | L1 | automated | `useShellConnectionStatus()` mocked to `"connected"` from the start; REST `GET /api/browser/profiles` mocked to return 1 instance / 1 tab | mount `BrowserRelayFeed` | exactly one REST call; store converges to 1 tab |
| F10 | session-card-subcards — snapshot refreshed after reconnect | state-transition connected→disconnected→connected | L1 | automated | store holds 1 tab; REST mock returns 0 tabs | connection status `connected → disconnected → connected` | exactly one new REST call on the second `connected`; store converges to 0 tabs; card with no goal/auto shows no `STATUS` |
| F11 | D5 — live push wins over in-flight seed | race | L1 | automated | REST mock deferred (manual resolve) returning 1 tab; reconnect triggers the seed | fake WS emits 0-tab status **after** the fetch began, then resolve REST | the store ends at 0 tabs (the seed result is dropped) |
| F12 | design D2 — feed is the sole subscriber | contract | L1 | automated | mount `BrowserRelayFeed` + `BrowserPaneTab` + `BrowserTabLabel` + `BrowserRelayBadge`; REST spy | reconnect once | exactly 1 REST seed call; a single WS status frame results in exactly 1 `setRelayStatus` call |
| F13 | session-card-subcards — STATUS hidden end-to-end with zero tabs | rendered UI | L3 | automated | default docker harness (`PI_E2E_SEED=1`, relay fake off) with a seeded idle session | open the dashboard, locate the seeded session card | the card contains no element with text `STATUS` (see `tests/e2e/card-block-toggles.spec.ts`) |
| F14 | session-card-subcards — badge appears and disappears end-to-end | rendered UI, state-transition | L3 | automated | relay-fake harness leg (`PI_BROWSER_RELAY_FAKE=1`, Fake instance with `tabId: 1`) | (a) load the dashboard; (b) use the F3 kill switch to close the Fake | (a) the seeded idle session card shows `STATUS` containing the browser badge trigger; (b) it converges to no `STATUS` on that card without a page reload |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | session-card-subcards — failed refresh clears snapshot | fault-injection (abort) | L1 | automated | store holds 1 tab; REST mock rejects (network error) | connection status `disconnected → connected` | store is `null`; bump fired (1→0 flip); card with no goal/auto shows no `STATUS`; no unhandled rejection |
| X2 | dashboard-shell-slots — throwing headless claim isolated | fault-injection (render throw) | L1 | automated | two `shell-headless` claims: one throws during render, the other renders `<i data-testid="ok"/>`; sibling app content `<p data-testid="app"/>` | render | `ok` and `app` present; error contained by the `SlotErrorBoundary` (console error, no uncaught throw) |
| X3 | design D1 — malformed frame does not crash the gate | fault-injection (bad payload) | L1 | automated | fake WS emits `{type:"browser_relay_status", instances: {}}`, then `{…, instances:[{tabs:null},{tabs:[t1]}]}` | render a mounted card + feed | first frame → no `STATUS`, no throw; second → `STATUS` with a badge menu listing exactly 1 tab |

---

## Coverage summary

- Requirements covered: 2/2 ADDED requirements (session-card-subcards STATUS gate: 8 scenarios; dashboard-shell-slots `shell-headless`: 7 scenarios), plus design D1–D5 invariants.
- Scenarios by class: edge 9 · perf 0 · frontend 14 · error 3
- Scenarios by level: L1 24 · L2 0 · L3 2
- Scenarios by disposition: automated 26 · manual-only 0

## New infra needed

- none. L3 reuses the default harness and the existing relay-fake leg (`ci-e2e-browser.yml` `e2e-browser-relay`).
