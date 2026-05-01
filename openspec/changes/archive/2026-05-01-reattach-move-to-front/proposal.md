## Why

When the dashboard server restarts (manual restart, crash recovery, `pi-dashboard restart`), the bridge in every still-alive pi session reconnects and re-registers via `session_register`. Today the server treats this as "preserve the user's drag order" — the design rationale of `preserve-session-order-on-reboot` was that an idle dashboard reboot must not clobber a manually-curated layout.

In practice that policy buries exactly the cards the user is most likely to look for after a reboot. Concrete repro: 11 alive sessions in `/Users/robson/Project/pi-agent-dashboard`; the session that was actively running before restart sits at index 10, hidden eleven cards down from the top.

The user has explicitly opted into the inverse default ("always surface re-registered alive sessions at the top"), with an escape-hatch config flag for users who prefer the current preservation behavior.

## What Changes

- **BREAKING (default behavior)**: bridge reattach after a dashboard restart now moves the registering session to the front of `sessionOrder` for its cwd by default. The previous `preserve` behavior is opt-in via config.
- New `registerReason: "spawn" | "reattach"` field on the `session_register` protocol message (extension → server). Optional; omission is interpreted as `"spawn"` for backwards compatibility with older bridges.
- New `reattachPlacement: "preserve" | "streaming-only" | "always"` config field in `~/.pi/dashboard/config.json` with default `"always"`.
- Server `event-wiring.ts onSessionRegistered` hook applies the configured policy when `registerReason === "reattach"`.
- Bridge tracks a `hasRegisteredOnce` boolean on `BridgeContext`; first `sendStateSync` after process boot tags `"spawn"`, every subsequent reconnect tags `"reattach"`. Session-change paths (new/fork/resume in `handleSessionChange`) always tag `"spawn"` because they introduce a fresh sessionId.
- Settings UI exposes the dropdown in the existing `SettingsPanel.tsx`.

## Capabilities

### New Capabilities
_(none — this change extends existing capabilities)_

### Modified Capabilities
- `session-ordering`: adds a fourth outcome to the resume-intent contract (`reattach`) and the configuration that governs it; modifies the "Bridge auto-reattach preserves layout" scenario to reflect the new default.
- `dashboard-config`: adds the `reattachPlacement` field.
- `bridge-protocol`: adds the optional `registerReason` field on `session_register`.

## Impact

- **Code**: `packages/extension/src/{bridge-context.ts,session-sync.ts}`, `packages/shared/src/{protocol.ts,config.ts}`, `packages/server/src/{event-wiring.ts,server.ts}`, `packages/client/src/components/SettingsPanel.tsx`.
- **Protocol**: backwards compatible. Old bridges (no `registerReason` field) are treated as `"spawn"` so their reconnects preserve the old order — they get the new "always promote" benefit only after upgrading.
- **Config**: existing installs without `reattachPlacement` get the new `"always"` default. Users who liked the old behavior set `reattachPlacement: "preserve"`.
- **Persisted data**: no migrations. `sessionOrder` shape unchanged.
- **Tests**: bridge `session-sync` test suite + new server `reattach-placement` test suite.
- **Risk**: low. The change is gated behind explicit policy and the bridge tags reattach unambiguously — no heuristic guessing at the server. Worst-case regression is the user's drag-order being clobbered after a reboot, which they recover by either dragging again or setting `reattachPlacement: "preserve"`.
