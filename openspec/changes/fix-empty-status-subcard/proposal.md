## Why

The session card's STATUS subcard renders as an empty, titled panel on almost every desktop session card. Its visibility gate, `useSlotHasVisibleClaimsForSession("session-card-badge")` (`packages/client/src/components/session/SessionCard.tsx:1929`), only checks claim `predicate`/`shouldRender`. The browser plugin's `BrowserRelayBadge` claim declares neither (`packages/client/src/generated/plugin-registry.tsx:733`), but returns `null` whenever there are zero relay tabs (`packages/browser-plugin/src/client/BrowserRelayBadge.tsx:67`). That claim always counts, so the gate always passes and an empty `STATUS` frame is drawn.

The badge cannot simply be gated. It is also the only always-mounted subscriber to `browser_relay_status`: if it mounted only when tabs exist, no subscriber would be mounted to see the first tab. No existing plugin slot is always mounted at shell level and accepts React claims (`footer-segment`, `toast`, `gate`, and `breadcrumb` are descriptor-only), so this change adds one.

## What Changes

- **New slot `shell-headless`**: react-only, multiplicity `many`, no predicate input. `App.tsx` mounts it exactly once, inside `PluginContextProvider`, independent of layout (desktop, mobile, or focus mode), selection, and session count. Its claims are zero-UI hosts for plugin-wide hooks such as message subscriptions. The runtime exports a `ShellHeadlessSlot` consumer.
- **Browser plugin**: a new `BrowserRelayFeed` claim on `shell-headless` owns `useRelayStatusFeed()`. It re-seeds from REST each time the shell connection becomes `connected`, because the server does not push status on connect. `BrowserRelayBadge` no longer subscribes. The `session-card-badge` claim declares `shouldRender: "hasRelayTabsForBadge"`, which is exported from the client entry and reads the relay store through the shared `hasRelayTabs(status)` helper. The component uses the same helper for its null check.
- **Gate invalidation**: `setRelayStatus` assigns the snapshot first, then calls `bumpSlotClaimsVersion()` only when `hasRelayTabs` flips. Idle session cards re-evaluate without a session broadcast.
- **Guard**: a contract test asserts that every registry claim on `session-card-badge` declares a `predicate` or `shouldRender`.
- **Composer side effect, intended for the zero-tabs case only**: the composer's STATUS group (`ComposerSessionActions.tsx:323,355`) uses the same slot. It now also stays hidden with zero relay tabs, as `chat-view` "Empty Status group leaves no label" already requires. The composer's existing disregard of the per-plugin visibility filter is unchanged.

Not in scope: per-session vs global relay badge scoping. Relay status is global, so the badge still appears on every session card while any relay tab exists (open question in `design.md`). Also out of scope: making intent-store contributions count toward the STATUS gate (a limitation that already exists and is documented in D4).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `dashboard-shell-slots`: ADDED requirement for the `shell-headless` slot.
- `session-card-subcards`: ADDED requirement saying the STATUS subcard hides when no `session-card-badge` claim would render, and every badge claim is gated.

## Impact

- `packages/shared/src/dashboard-plugin/slot-types.ts` and `slot-props.ts`: new slot id, definition, and props entry. This is a minor version per `dashboard-shell-slots` "Adding a new slot is a minor version bump".
- `packages/dashboard-plugin-runtime/src/slot-consumers.tsx`: `ShellHeadlessSlot`. The Vite plugin, the registry generator and `manifest-validator.ts` derive slot ids from `SLOT_DEFINITIONS`, so they need no change.
- `packages/client/src/App.tsx`: a single `<ShellHeadlessSlot/>` mount.
- `packages/browser-plugin`: manifest (`package.json` claims), `src/client/{BrowserRelayBadge,relay-store,index}.tsx|ts`, the new `BrowserRelayFeed.tsx`, and tests.
- `packages/client/src/generated/plugin-registry.tsx`: regenerated (`npm run generate:plugin-registry`).
- `packages/dashboard-plugin-skill` slot templates: no change. The list is not exhaustive (`render.ts:27`).
- `CHANGELOG.md` `Unreleased`: an entry for the new slot.
- No server, protocol, or persistence change, so no migration. Rollback is reverting the commit. Third-party plugins are unaffected because the slot is additive.

## Discipline Skills

- `systematic-debugging`: root cause already established. Failing tests come before the fix.
- `doubt-driven-review`: the new slot is public plugin API, which is effectively irreversible within a major version. It was reviewed during planning.
- `review-code`: non-trivial change across runtime, shell, and plugin before commit.
- No security, performance, or observability triggers apply.
