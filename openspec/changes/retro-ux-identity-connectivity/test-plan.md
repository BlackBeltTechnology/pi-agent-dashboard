# Test Plan — retro-ux-identity-connectivity

Stage: design   Generated: 2026-10-12

Levels: L1 = vitest (`packages/client/src/**/__tests__/*.test.tsx`; capture-helper pure logic in `tests/e2e/helpers/__tests__/*.test.ts`, the `e2e/helpers` vitest project). L3 = Playwright `tests/e2e/*.spec.ts` in the docker harness (port from `.pi-test-harness.json`, never hardcoded).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | ui-state-capture: opt-in matrix | BVA (count) | L1 | automated | 2 states, default themes, widths `[375,768,1440]`, `RETRO_UX_CAPTURE=1`, a fake page whose `screenshot` records paths | `captureStates` | exactly 18 recorded paths, each `mockups/after/<surface>/<state>--<theme>-<mode>--<width>.png` under the active change dir |
| E2 | ui-state-capture: `only` filter | EP (valid/invalid id) | L1 | automated | states `[list, empty]`; `only: ["empty"]`, then `only: ["nope"]` | `captureStates` | first run captures only `empty`; second throws an error naming the surface and `nope` before any `goto` call |
| E3 | ui-state-capture: archived refusal | decision table (flag × dir kind) | L1 | automated | change dir resolving to `openspec/changes/archive/2026-…-x/`, to an active dir, and to nothing; `RETRO_UX_CAPTURE` on/off | `captureStates` | archived + on → throws, nothing written; missing + on → throws; active + on → writes; any + off → zero writes |
| E4 | ui-state-capture: stub declaration | EP | L1 | automated | a fixture state with `stubs: []` | `captureStates` | throws "state <id> declares no stubbed endpoint" before navigation |
| E5 | known-servers: Verified pill | decision table (fingerprint × canManage) | L1 | automated | list `[{host:"office-mac.local",fingerprint:"sha256:abc"},{host:"192.168.16.202"}]`, `canManage` true and false | render `KnownServersSection` | exactly one "Verified" pill, on office-mac, in both cases; its accessible description mentions verification at add time |
| E6 | known-servers: read-only | decision table | L1 | automated | `canManage: false`, 2 servers, one with `movedTo` | render | no add/remove/update buttons; read-only note text present; "Moved to" text still shown |
| E7 | server-selector: state pills | decision table (probe outcome) | L1 | automated | entries probing to available, unreachable (fetch throws, server probe `refused`), denied (403 `network_not_allowed`), CORS (fetch throws, server probe `reachable`), name-not-found, moved | open the dropdown | each entry shows a distinct text pill (Available / Unreachable / Network not allowed / Blocked in this browser / Name not found / Moved); `data-unreachable`/`data-denied`/`data-cors-blocked`/`data-name-not-resolved` set on the matching items |
| E8 | server-selector: trigger word | EP (connected bool) | L1 | automated | `connected` true, then false | render trigger | visible word "Connected" / "Offline"; accessible name contains "connected" / "offline"; `title="Switch server"` kept |
| E9 | passkey-user-auth: status pills | EP (status enum) | L1 | automated | users with status `active`, `invited`, `revoked`, and one `active` with 2 orphaned credentials | render `UsersSection` | `user-status-*` texts "Active", "Invite pending", "Revoked"; `user-orphaned-*` is a separate pill "2 orphaned"; all existing testids present |
| E10 | passkey-user-auth: testids preserved | EP | L1 | automated | each state: disabled, unstable, list, invite open | render | `users-disabled`, `users-unstable`, `users-add-form`, `users-invite`, `user-<id>`, `user-status-<id>`, `user-orphaned-<id>`, `user-invite-<id>` all render in their state; `PasskeyImpactNote` renders the passed `testId` |
| E11 | known-servers discovery: diagnostic disclosure | state | L1 | automated | `discoverServers` resolves `[]` | click "Scan network" | headline visible; the 5 reasons are inside a collapsed `<details>` (not visible); manual-add Address input visible and labelled |
| E12 | known-servers discovery: manual-add validation | EP (parse valid/invalid/duplicate) | L1 | automated | input `192.168.16`, then `192.168.16.202:8000` already known, then `http://lab-mini.local:8000` | submit | invalid → error text linked by `aria-describedby`, input `aria-invalid="true"`, no POST; duplicate → message naming host:port, no POST; valid → one POST, input cleared |
| E13 | all surfaces: contract probes | decision table (state × theme × width) | L3 | automated | every fixture state of users, server-selector, known-servers, discovery; themes `{base,dark}`,`{base,light}`,`{nord,dark}`; widths 375/768/1440 | `captureStates` without `RETRO_UX_CAPTURE` | every `contrast`, `size`, `focus` list empty; no file written under `openspec/` |
| E14 | passkey-user-auth: target size | BVA (breakpoint) | L3 | automated | Users `list` state at width 375 and 1440 | measure bounding boxes | "Add user" height ≥ 44 at 375 and ≥ 36 at 1440; each row action (tier select, Invite QR, Revoke) height ≥ 32 at both |
| E15 | all surfaces: no palette classes | EP | L1 | automated | source of the 5 in-scope components | regex scan for `(bg|text|border|ring)-(red|green|blue|yellow|amber|gray|slate|zinc|neutral|emerald|orange|purple|indigo|sky)-\d` and `#[0-9a-f]{3,8}` / `rgba(` | zero matches, except the documented `bg-white` QR quiet zone in `UsersSection.tsx` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | server-selector: APG keyboard | state-transition | L1 | automated | 3 entries (current, available, unreachable) | focus trigger → Enter → ArrowDown ×2 → End → Home → Escape | menu opens with focus on the first item; focus moves per key; Escape closes, trigger focused, `aria-expanded="false"` |
| F2 | server-selector: keyboard switch | state-transition | L1 | automated | available entry `office-mac.local:8000` | Enter, ArrowDown to it, Enter | `onSwitch("office-mac.local", 8000)` called once; menu closed |
| F3 | server-selector: blocked entry | state-transition (illegal edge) | L1 | automated | unreachable entry | focus it with ArrowDown, press Enter, then click it | item has `aria-disabled="true"`, is focusable, reason text visible and referenced by `aria-describedby`; `onSwitch` never called |
| F4 | server-selector: Tab closes | state-transition | L1 | automated | open menu | press Tab | menu closed; focus not inside the menu |
| F5 | server-selector: probing | async convergence | L1 | automated | entry whose `/api/health` fetch is held pending | open the dropdown, then resolve the fetch `ok:true` | entry shows "Checking…" while pending, then converges to "Available"; never blank in between |
| F6 | server-selector: portalled menu probes | async convergence | L3 | automated | `open-mixed` fixture | `open(page)` then probe `root` = `page.getByRole("menu")` | probe measures > 0 text nodes (non-vacuous) and all failure lists empty in all 3 themes |
| F7 | ui-state-capture: stubs survive reload | state-transition | L3 | automated | users `unstable` fixture | `install` → `goto` → `setThemeMode(light)` (reload) → `open` | the `users-unstable` callout renders after the reload; the stubbed `/api/users` handler was hit ≥ 2 times |
| F8 | ui-state-capture: open per width | state-transition | L3 | automated | server-selector `open-mixed` | capture at 375 then 1440 | at both widths `getByRole("menu")` is visible when the screenshot is taken |
| F9 | passkey-user-auth: focus ring | state-transition | L3 | automated | Users `list` state, each theme | Tab through every button, select and input in the section | each focused control has computed `outline-style: solid`, `outline-width ≥ 2px`, colour = resolved `--focus-ring` |
| F10 | known-servers: two-click remove | state-transition | L1 | automated | 1 server | click Remove → Cancel; click Remove → Confirm remove | after Cancel: entry kept, 0 DELETE calls; after Confirm: 1 `DELETE /api/known-servers` call, entry gone |
| F11 | known-servers discovery: live region | async convergence | L1 | automated | `discoverServers` pending, then resolving 2 servers | click "Scan network", resolve | `aria-live="polite"` region reads "Scanning…" then "Found 2 dashboards." |
| F12 | visual fidelity to approved board | visual/subjective | — | manual-only | `mockups/after/**` vs `mockups/identity-connectivity.html` proposed column | human side-by-side review | [judgment: real render matches the approved design — no automatable observable beyond the probes] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | known-servers: load failure | fault-injection (abort) | L1 | automated | `listKnownServersWithAccess` rejects (503) | mount `KnownServersSection` | error callout with Retry; "No remote servers saved" absent; Retry re-calls the list once and renders entries on success |
| X2 | known-servers: remove failure | fault-injection (abort) | L1 | automated | `removeKnownServer` rejects 403 | Remove → Confirm remove | entry still listed; error text next to that entry |
| X3 | known-servers: move-accept refused (Settings) | fault-injection (abort) | L1 | automated | `acceptKnownServerMove` resolves `false` | click "Update" on the moved entry | entry unchanged; error text next to it |
| X4 | server-selector: move-accept refused | fault-injection (abort) | L1 | automated | `acceptKnownServerMove` resolves `false` (non-operator) | activate "Update nas to nas-2.local:8000" | refusal shown as text in the menu; entry unchanged |
| X5 | known-servers: scan failure | fault-injection (abort) | L1 | automated | `discoverServers` rejects `Error("connection refused")` | click "Scan network" | severity-error callout "Scan failed: connection refused" with Retry; empty-state diagnostic also shown |
| X6 | known-servers discovery: add-confirm failure | fault-injection (abort) | L1 | automated | `addKnownServer` rejects | Add → confirm on a discovered server | error text next to that server; no "Already added" state |
| X7 | passkey-user-auth: copy failure | fault-injection (abort) | L1 | automated | `copyText` resolves `false` | click "Copy link" in the open invite | message rendered in `--severity-error-fg` (not `--status-error`), `role="status"` |
| X8 | server-selector: server-side probe unavailable | fault-injection (abort) | L1 | automated | browser fetch throws and `probeKnownServer` rejects | open the dropdown | entry renders "Unreachable" pill, `aria-disabled="true"` |

---

## Coverage summary

- Requirements covered: 12/12 (ui-state-capture 3, passkey-user-auth 1, server-selector 4, known-servers 4 — the MODIFIED "Surface scan errors in the UI" via X5)
- Scenarios by class: edge 15 · perf 0 · frontend 12 · error 8
- Scenarios by level: L1 28 · L2 0 · L3 6 · — 1
- Scenarios by disposition: automated 34 · manual-only 1

## New infra needed

- `tests/e2e/helpers/ui-capture.ts` + `tests/e2e/fixtures/retro-ux/` (task 2.1, 2.2) — new helper and fixtures inside the existing L3 harness; no new level.
