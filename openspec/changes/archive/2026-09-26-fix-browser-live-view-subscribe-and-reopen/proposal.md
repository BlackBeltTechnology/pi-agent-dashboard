## Why

The browser relay's live view is unusable in its most common state. A connected instance whose only tab is the Playwright extension's own `connect.html` page reports that tab as `live`, the tile subscribes, the relay refuses silently (no debugger session on that tab), and the tile shows "Waiting for frames…" forever. Separately, once the user presses **Close** the view cannot be brought back except by a page reload or an unrelated tab change, and the shell's content-view gate can miss the relay's late status on an idle session.

## What Changes

- Relay `browser_relay_status` reports a tab with no debugger session as `state: "detached"` with a new `reason: "no-session"` instead of the default `live`.
- The tile renders a `no-session` overlay ("Tab not viewable yet — the agent has not attached to it (extension pages cannot be viewed)") and stops forwarding input for it.
- The tile re-sends `browser_relay_subscribe` when its tab becomes viewable (leaves `detached`), so a tab the agent later attaches starts streaming without a reload.
- A refused subscribe is audited (`viewer-subscribe-refused`, detail = reason) instead of being dropped silently.
- The `browser-relay-badge` pill becomes a button: clicking it re-opens a dismissed live view (and the card click still selects its session).
- The shell's `content-view` gate subscribes to the slot-claims invalidation signal, so a plugin predicate flip re-renders the gate on an idle session.

Out of scope: mounting the `content-view` slot in the mobile layout (width < 768 px or height < 600 px) — separate change.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `browser-relay`: tab status reports `detached/no-session` for tabs without a debugger session; refused subscribes are audited.
- `browser-plugin-settings`: live-view tile shows the `no-session` overlay, re-subscribes when the tab becomes viewable, and can be re-opened from the badge after Close.

## Impact

- `packages/shared/src/browser-protocol.ts` — `BrowserRelayTabStatus.reason` union gains `"no-session"` (additive; old clients ignore it and render `detached`).
- `packages/browser-plugin/src/server/relay/relay-instance.ts` (`tabList`, `subscribe`), `server/audit.ts` kind list if enumerated.
- `packages/browser-plugin/src/client/` — `LiveViewTile.tsx`, `BrowserRelayBadge.tsx`, `relay-store.ts` (`reopenLiveView`), i18n catalog (+ `zh-CN`/`hu` parity).
- `packages/client/src/App.tsx` — content-view gate re-evaluated on `useSlotClaimsVersion()`.
- No persistence, no migration. Rollback = revert; the protocol change is additive.

## Discipline Skills

- `review-code`: before commit, per project doctrine.
- No auth/secret/untrusted-input surface is added (viewer messages keep the existing allowlist and `_deny` path), no latency budget changes, no irreversible step — so `security-hardening`, `performance-optimization`, `observability-instrumentation` and `doubt-driven-review` are not triggered. The new `viewer-subscribe-refused` audit row reuses the existing audit ring.
