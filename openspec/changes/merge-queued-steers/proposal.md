# Proposal: merge-queued-steers

## Why

Steers queued while the agent works reach pi one per turn. pi's `steeringMode` defaults to `"one-at-a-time"`, and the bridge copies that mode at hand-off. So 4 queued steers cost at least 4 turns, and the agent restarts its reasoning for each one. Users want several quick corrections to land together as one message at the next turn.

## What Changes

- **Grouped pending steers (chat).** The held-steer bubbles stay, but the per-bubble `STEERING` header goes. One shared label sits above the group: `Steering · N · sends after this turn`, or `Steering · merged` when merged. The gap between bubbles gets tighter.
- **Merge.** From 2 held steers on, a `Merge N` button (call-merge icon, same class as `Clear all`) sits beside `Clear all`. It replaces every held steer with ONE held steer. Its text is the originals joined by a blank line (`"\n\n"`), and its images are the originals' images in order. The merged steer reaches pi as ONE user message at the next completed turn boundary (or the settle drain).
- **Split.** While a single merged steer is held, the button reads `Split N` (call-split icon) and restores the original steers, in order and with their ids. The bridge keeps the originals on the merged entry until hand-off. Merge/Split works until hand-off. Cancelling the merged steer removes all of it. Each original `promptId` is acked when the merged steer reaches pi.
- **Auto-merge setting.** Settings → Sessions gets a new `Steering` section between `Session list` and `Lifecycle & recovery`, with a toggle "Merge queued steers automatically" (**default OFF**). When ON, a steer queued while others are held is merged with them. A user Split pauses auto-merge until the queue empties. Flipping the setting changes no held steer; it applies from the next queued steer. It is a global dashboard config key (`mergeQueuedSteers`), relayed to bridges.
- New browser→server→bridge messages `merge_steering_entries` and `split_steering_entry`, wired like `remove_steering_entry` / `clear_steering_entries` (control tier, session-scoped, MCP-denylisted, ignored by ACP sessions).
- Mockup: mockups/2026-11-20-steer-batch (in this change)

Non-goals: changing pi's own `steeringMode`; merging follow-up queue entries; editing merged text; a per-folder override of the setting.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `mid-turn-prompt-queue`: held steers can be merged into one entry and split back, merged entries hand off as one message and ack every original `promptId`, auto-merge on admission, and the pending-steer UI is grouped under one label with Merge/Split controls.
- `settings-panel`: the Sessions page gains a `Steering` section with the `mergeQueuedSteers` toggle.

## Impact

- Bridge (`packages/extension/src/`): `steer-buffer.ts` (merged entries, `steerContent`, `merge`, `split`, `reset`, split-pause latch, bounds over originals, `admitSteer` auto-merge), `bridge.ts`, `bridge-handlers/{dispatch,lifecycle,instance}.ts`, `followup-drain.ts`.
- Shared (`packages/shared/src/`): `types.ts` (`SteerEntryView.mergedCount?`), `protocol.ts`, `browser-protocol.ts`, `ws-message-tiers.ts`, `config.ts`.
- Server (`packages/server/src/`): `browser-handlers/session-action-handler.ts`, `pairing/browser-gateway.ts`, `identity/ws-message-scope.ts`, `acp-bridge/server-requests.ts`, `preferences-relay.ts`, `routes/system-routes.ts`, `routes/preferences-auto-name-routes.ts`, `routes/preferences-claude-compat-routes.ts`, `event-wiring.ts`, `server.ts`.
- `packages/bus-client/src/generated/verbs.ts` (regenerated via `npm run codegen`); `packages/mcp-server-plugin/src/server/tools.denylist.ts`.
- Client (`packages/client/src/`): `components/chat/{PendingSteerCard,ChatView}.tsx`, `hooks/useSessionActions.ts`, `App.tsx`, `components/settings/SettingsPanel.tsx`, `lib/i18n/{i18n-hu,i18n-zh-CN}.ts`.
- Existing tests that change: `client/src/components/__tests__/ChatView.inline-steer.test.tsx` (per-bubble header assertions), `settings/__tests__/settings-page-composition.test.tsx` (section order), `server/src/acp-bridge` exhaustive switch, and the steer-buffer / hand-off / drain / dispatch suites.
- Wire compatible: the new fields are optional. A bridge that has not been reloaded drops the new verbs silently (`command-handler.ts` default → `undefined`), so Merge is a no-op on that session until it reloads (design Risks).

## Discipline Skills

- `review-code`: the non-trivial bridge buffer change, before commit.
- `doubt-driven-review`: already applied to this proposal/design during planning.
- No `security-hardening`: the new verbs reuse the existing session-scoped control-tier path, with no new auth, secrets or untrusted-input surface beyond `remove_steering_entry`. No `performance-optimization`: merge is O(entries ≤ 20). No `observability-instrumentation`: no new endpoint or job.
