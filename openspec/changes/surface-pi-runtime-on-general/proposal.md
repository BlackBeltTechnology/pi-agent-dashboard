## Why

Which pi install the dashboard runs on is a first-class configuration concern — it decides what every session spawns and what the server imports. Today it *looks* like developer plumbing: the picker (`PiRuntimeSection`) lives on **Settings → Developer**, wedged between `devBuildOnReload`, diagnostics dumps and spawn-failure logs.

That placement was deliberate (`select-pi-runtime-install` design **D12**): the picker sits immediately above `ToolsSection` because the two edit the same `~/.pi/dashboard/tool-overrides.json`, and splitting them across pages would leave two writers of one file with nothing on screen saying so. D12 explicitly names discoverability on General as the half of the rationale it traded away.

The trade has a hole. General's only pointer at the pi runtime is `PiVersionAdvisory`, which renders **only** when `compat.error || compat.upgradeRecommended` (`PiVersionAdvisory.tsx:20-21`). A user on a healthy pi who wants to see or change which install is in use gets no signal at all on the page they land on. The door exists only while the room is on fire.

This change closes the discoverability hole **without** reopening D12: the editing surface stays on Developer next to Tools, and General gains a permanent read-only status row that states the resolved runtime and links to the picker.

## What Changes

- **New `PiRuntimeStatusRow` on Settings → General**, rendered in the General block of `SettingsPanel.tsx` near `PiVersionAdvisory`. Always visible — not gated on version skew. It states, read-only:
  - *Sessions spawn* → resolved version
  - *Server imports* → resolved version
  - a divergence warning when the two disagree, reusing the existing `consumerMessage`
  - a **`Change…`** affordance that navigates to Settings → Developer and scrolls the `pi-runtime-section` into view.
- **Data source: the existing `/api/health` → `piRuntime` shape.** `/api/health` is already polled client-side every 60s by `usePiCompatibility`, but that hook today retains only `body.compatibility` — it discards `piRuntime`. The hook is widened to expose `piRuntime` from the same response, and — because the hook is instance-scoped — it is invoked **once per panel** from `SettingsPanel`, which passes `piRuntime` down to the row and `compatibility` down to the advisory (whose internal hook call is removed). One fetch, one cadence, one poller; no new endpoint, no filesystem enumeration on the most-visited settings page.
- **The row does NOT label automatic-vs-pinned.** `PiDivergenceHealth` carries versions and divergence only; `pinned` lives on the guarded `GET /api/pi/installs`. Adding `pinned` to the unauthenticated health shape was rejected (see design D2), and fetching `/api/pi/installs` from General was rejected on cost (design D3). The pinned/automatic distinction remains one click away, rendered by the picker itself.
- **`requestRailNavigate` gains an optional scroll target.** Today (`SettingsPanel.tsx:906`) it navigates to a *page*; the `Change…` link needs navigate-then-scroll-to-section. The existing `data-testid="pi-runtime-section"` anchor is the target. Gating semantics are exactly the rail helper's own: it guards only when leaving a *plugin* page with unsaved edits (built-in draft state survives page switches by design, D5a of `reorganize-settings-pages-and-descriptions`) — identical to the Save Bar page chips, which share the helper. No new or strengthened gate is introduced.
- **`PiVersionAdvisory` gains the same `Change…` affordance**, so the skew banner points at the fix instead of only naming the problem.
- **Non-goals**: moving `PiRuntimeSection` or `ToolsSection` off Developer; any change to `POST /api/pi/runtime`, `PUT /api/tools/:name`, the override store, or the picker's own behaviour; re-litigating the Settings page taxonomy.

## Capabilities

### Modified Capabilities
- `pi-runtime-selection`: gains a discoverability requirement — a permanent, read-only summary of the resolved pi runtime SHALL be reachable from Settings → General regardless of version-skew state, and SHALL link to the picker. The picker's location, data model, write path and atomicity requirements are unchanged. The advisory-affordance requirement added here defers to the `pi-core-version-check` capability by reference for the advisory's triggering states and copy — it governs the affordance only.
- `pi-core-version-check`: mechanism-only amendment — the advisory now receives `compatibility` from its host panel (which polls `/api/health` once per panel instance) instead of calling the polling hook itself. States, copy and cadence are unchanged.
- `settings-panel`: the General page's requirements gain the pi-runtime status row (as an added requirement in that capability). The Developer page requirements are unchanged. Page navigation gains an optional section-scroll intent.

## Impact

- **New code**:
  - `packages/client/src/components/settings/PiRuntimeStatusRow.tsx` — read-only summary + `Change…` link.
- **Touched code**:
  - `packages/client/src/hooks/usePiCompatibility.ts` — widen the hook to expose `piRuntime` beside `compatibility` (same `/api/health` fetch). **Breaking for its consumer**: the return shape changes from `PiCompatibility | null` to an object carrying both fields.
  - `packages/client/src/components/settings/SettingsPanel.tsx` — invoke the widened hook once; render the row in the General block; pass `piRuntime` to the row and `compatibility` + `onChangeRuntime` to the advisory; extend `requestRailNavigate` with an optional scroll target.
  - `packages/client/src/components/packages/PiVersionAdvisory.tsx` — consume `compatibility` via a prop (its internal `usePiCompatibility` call moves up to the panel); add an optional `onChangeRuntime` prop rendering the `Change…` affordance.
  - `packages/client/src/components/__tests__/PiVersionAdvisory.test.tsx` — replace the `vi.mock` hook mock with prop-driven render cases (the component no longer imports the hook); cover the affordance in both alert states and the unchanged render when `onChangeRuntime` is absent.
  - i18n catalogues — new keys for the row's copy and the shared `Change…` label (`packages/client/src/lib/i18n/`: zh + hu, per convention).
  - `packages/client/src/components/settings/AGENTS.md`, `packages/client/src/components/packages/PiVersionAdvisory.tsx.AGENTS.md` — purpose rows.
  - Unit tests: new `packages/client/src/components/settings/__tests__/` coverage for the row; extension of `settings-page-composition.test.tsx`.
  - `tests/e2e/pi-runtime-picker.spec.ts` — its `openDeveloper()` helper comment documents the Developer placement; add coverage for the General row and the `Change…` path, including a `/api/health` route stub supplying `piRuntime` fixture state (the spec already stubs `/api/health` in one flow; the shared helper does not).
- **No impact** on the server, `packages/shared` types, persistence, the WebSocket protocol, the bridge extension, or the auth surface. `/api/health` is read as-is; its shape is not widened.
- **Compatibility**: additive at the user-visible surface. Two internal shapes change and are updated in the same change: the `usePiCompatibility` return (one consumer: the advisory, via a new prop) and the advisory's props (previously zero). With `piRuntime` absent or null on `/api/health` — an older server, or a current server whose `piRuntimeSnapshot()` threw (runtime discovery failure) — the row renders nothing — same degradation path `PiVersionAdvisory` already uses for a null `compatibility`.
- **Risk — a second surface naming the runtime can drift from the picker.** Mitigated by the row being strictly read-only and sourcing from the same server resolution the picker reports, never from client-side inference.
- **Risk — General grows another always-on element.** Accepted: two lines of text, and it is the page's subject matter (the version advisory already claims that slot conditionally).

## Discipline Skills

- `review-code` — non-trivial client change touching a shared navigation helper (`requestRailNavigate`) used by the Save Bar page chips; a regression there is silent and affects every settings page.
- `doubt-driven-review` — the change deliberately preserves an existing recorded decision (D12) while reversing the half of it that was traded away. Worth stress-testing that the read-only-row split genuinely keeps a single writer of `tool-overrides.json` rather than merely appearing to.
- `security-hardening` — **only as a guard on the rejected path**: `system-routes.ts:70-76` states `/api/health` carries versions and never paths because it is unauthenticated. If implementation is tempted back toward Fork-2 (`pinned` on the health shape) or toward exposing a resolved path in the summary row, that constraint is the gate.

No other discipline skills apply: no new endpoint, job or external call (observability), no latency budget or large-data path (performance), no migration or public-API break.
