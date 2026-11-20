# Design: merge-queued-steers

## Context

See proposal.md (Why). Current state:

- The bridge holds dashboard steers in `createSteerBuffer` (`packages/extension/src/steer-buffer.ts:67`). Entries are `{ id, text, images?, promptId? }` (`steer-buffer.ts:30-35`). Ids are `<instanceNonce>:<seq>` (`steer-buffer.ts:99-101`). The cap and byte ceiling are checked per entry on `push` (`steer-buffer.ts:84-98`). `take(mode)` splices 1 entry, or all for `"all"` (`steer-buffer.ts:119-123`); `shift()` is used by the settle drain (`steer-buffer.ts:125`).
- Admission: `admitSteer` (`steer-buffer.ts:142-164`), called from `bufferSteerSend` (`packages/extension/src/bridge.ts:574-576`).
- Hand-off: `handOffHeldSteers` (`packages/extension/src/bridge-handlers/lifecycle.ts:1014-1047`) reads pi's `steeringMode` (`lifecycle.ts:1021-1023`), `take`s, emits `queue_update`, then for each entry calls `sendUserMessage(buildUserMessageContent(entry.text, entry.images), { deliverAs: "steer" })` and `inst.ackSteerDelivered(entry.promptId)` (`lifecycle.ts:1033-1039`).
- Settle drain: `followup-drain.ts:75-83` ships `steerBuffer.shift()` ahead of follow-ups and calls `ackSteer?.(steer.promptId)`.
- Mutations: `remove_steering_entry` / `clear_steering_entries` are handled in `bridge-handlers/dispatch.ts:478-496`, with a session-id guard at `dispatch.ts:478-483`. The server relays them unchanged in `browser-handlers/session-action-handler.ts:1240-1262`, routed in `pairing/browser-gateway.ts:2350-2353`, scoped in `identity/ws-message-scope.ts:38,51`, tiered `control` in `shared/src/ws-message-tiers.ts:51,68`, ignored for ACP in `acp-bridge/server-requests.ts:128-130`, and MCP-denylisted in `mcp-server-plugin/src/server/tools.denylist.ts:161,206`. The client sends them from `hooks/useSessionActions.ts:159,164`.
- Wire view: `SteerEntryView { id, text, imageCount }` (`packages/shared/src/types.ts:853`), from `views()` (`steer-buffer.ts:80-81`).
- UI: `PendingSteerCard` renders one bubble with a `Steering` header and spinner (`client/src/components/chat/PendingSteerCard.tsx:44-60`). `PendingSteerClearAll` is at `PendingSteerCard.tsx:91`. `ChatView` maps each steer into its own `ChatEnter` wrapper with `mt-4 mb-4` and shows Clear all from 2 entries (`client/src/components/chat/ChatView.tsx:2658-2663`).
- Server→bridge preference relay: `buildPreferencesUpdate` (`server/src/preferences-relay.ts:12-20`). It is pushed at register (`server/src/event-wiring.ts:602`), at the initial-prompt arm (`event-wiring.ts:1940`), and broadcast on PATCH (`routes/preferences-auto-name-routes.ts:65`). The bridge applies a field only when it is a boolean (`bridge-handlers/dispatch.ts:202-215`).
- Live config keys: `completedFirst` is declared in `shared/src/config.ts:1343`, defaulted at `config.ts:1789`, parsed at `config.ts:2793`, and hot-applied in `server/src/routes/system-routes.ts:749-751`. The client maps it in `CONFIG_FIELD_PAGE` (`client/src/components/settings/SettingsPanel.tsx:356`), diffs it in `computeConfigPartial` (`SettingsPanel.tsx:390-391`), and renders it in the `Session list` section (`SettingsPanel.tsx:2230`, toggle `:2254`). That section is followed by `Lifecycle & recovery` (`SettingsPanel.tsx:2349`).

## Goals / Non-Goals

**Goals:** one held steer can carry N originals and reach pi as one user message; Merge and Split are lossless until hand-off; the auto-merge default is set globally.

**Non-Goals (design-level):** no change to pi's `steeringMode` or to `take(mode)` semantics (a merged entry is one entry); no persistence of merge state across bridge reloads (the buffer is in memory already).

## Decisions

### D1. A merged entry stores its originals; text, images and bytes are derived

`SteerEntry` becomes a union: `PlainSteer = { id, text, images?, promptId? }` (today's shape, `steer-buffer.ts:30-35`) | `MergedSteer = { id, parts: PlainSteer[] }` (≥ 2 parts, never nested). `entryBytes` (typed for a text-bearing entry, `followup-buffer.ts:66-72`) is only ever called on a `PlainSteer`. One exported helper, `steerContent(entry)` → `{ text, images, promptIds }`, is the only reader used by `views()`, the hand-off and the settle drain. For a plain entry it returns its own fields. For a merged entry it returns `parts[*].text` joined by `"\n\n"`, the concatenated `parts[*].images`, and the defined `parts[*].promptId`s.
*Alternative:* store the joined text and images plus a copy of the originals. Rejected: it double-counts bytes against the ceiling and gives two sources of truth.

### D2. Bounds count originals: `totalBytes()` and the cap flatten parts

`totalBytes()` (today `Σ entryBytes(entry)`, `steer-buffer.ts:73`) and the cap check (today `entries.length`, `steer-buffer.ts:84`) both iterate over the flattened originals: `originals() = entries.flatMap(e => e.parts ?? [e])`. A merged entry therefore counts the full bytes and the count of its parts. Merge and split never change either total, so they never fail on bounds and never open room. The `"\n\n"` separators are deliberately not counted: ≤ 2·19 = 38 bytes over a multi-MB ceiling, so a merged queue may exceed the ceiling by at most 38 bytes.

### D3. `merge()` and `split()` are pure buffer mutations; the handler emits once

`buffer.merge()` with fewer than 2 entries (one plain or one merged entry) is a no-op returning `false`: id unchanged, latch unchanged. Otherwise it flattens every entry, in buffer order, into ONE merged entry and returns `true`. **Id rule:** if the first entry is already merged, the result keeps that id and appends the rest to its `parts`. Otherwise a fresh id `<nonce>:<++seq>` is minted (`seq` advanced directly, not via `push`, so there is no bounds re-check). Keeping the id means auto-merge, which appends to the head merged entry on every admission, never churns the id that the browser's ✕ / Split are aimed at. `buffer.split(id)` replaces the merged entry `id`, at its position, with its `parts` (original ids, texts, images, promptIds). It returns `false` for an unknown or plain id. Neither emits anything. The bridge handlers own the single `inst.emitQueueUpdate()`:
- `merge_steering_entries` → `merge()`; ALWAYS emit `queue_update` (a no-op merge re-announces, so a browser that raced a hand-off re-syncs); no feedback.
- `split_steering_entry { id }` → `split(id)`; on `true` emit `queue_update`; on `false` with an id that is not held, send `command_feedback("split_steering_entry", "Steer already sent or cancelled")`; with a held plain id (e.g. a double-clicked Split) send no feedback. Either way, emit `queue_update` (re-announce, same as merge).
- Both sit under the existing session-id guard (`dispatch.ts:478-483`).
*Alternative:* merge only selected ids. Rejected: the agreed UI has one `Merge N` for the whole group.

### D4. Originals inside a merged entry are addressed only through it

While merged, the original ids are not held entries. A `remove_steering_entry` for an absorbed original id is refused with the existing "Steer already sent or cancelled" feedback (`dispatch.ts:486-488`). The client never renders original ids while merged, so only a click that raced a merge sends one (e.g. ✕ on a bubble just as auto-merge absorbed it). The re-announced `queue_update` then shows the merged bubble. `remove_steering_entry` for the merged id removes all of its originals; none of their promptIds is ever acked.

### D5. Auto-merge on admission; Split pauses it until the buffer empties

- **Setting → admission.** `admitSteer(buffer, input, sinks)` gets an optional `sinks.autoMerge?: () => boolean`, built in `bufferSteerSend` (`bridge.ts:574-576`) as `() => inst.mergeQueuedSteers`. `inst.mergeQueuedSteers: boolean` is declared beside `autoNameSessions` in the `BridgeInstance` interface (`bridge-handlers/instance.ts:144`) and initialised to `false` where `autoNameSessions` is initialised in `bridge.ts` and is set from `preferences_update` only when it is a boolean (same pattern as `dispatch.ts:202-215`).
- **Rule.** After a successful `push`, if `sinks.autoMerge?.()` is true, `!buffer.splitPaused`, and the buffer held ≥ 1 entry BEFORE this push, call `buffer.merge()`. "Held before" (not "≥ 2 entries after") means the 3rd, 4th, … steer joins an existing merged entry. Then the dropped-image feedback (if any) is sent and ONE `queue_update` is emitted, in today's order (`steer-buffer.ts:155-162`).
- **Latch.** `splitPaused` lives in the buffer. A successful `split()` sets it, whether or not auto-merge is on: a user who splits and then turns auto-merge on before the queue empties keeps their split. A manual `merge()` that returns `true` clears it (the user re-expressed merge intent). Any mutation that leaves the buffer empty clears it: the check runs at the end of `take`, `shift`, `removeById` and `clear`, including `clear()`'s early return on an already-empty buffer (`steer-buffer.ts:113`). A new `reset()` (empty the buffer + clear the latch) replaces the `clear()` call inside the session-change block (`lifecycle.ts:127-133`). That block runs only when a buffer is non-empty, and that suffices: an empty buffer already has a clear latch.
- **Flip then admit.** Turning the setting on while `"a"`, `"b"` are held separately changes nothing; the next admitted `"c"` merges all three (held-before ≥ 1). The first auto-merge of a plain head mints a fresh id; later ones keep it (D3).
- **No retroactive effect.** A `preferences_update` only stores the value; held entries are untouched (user decision Q2). With the latch set, new steers stay separate and Merge stays available (user decision Q1).
*Alternative:* re-merge on every push. Rejected by the user: it undoes their Split.

### D6. Hand-off and settle drain treat a merged entry as one message

`take(mode)` and `shift()` are unchanged: a merged entry is one element, so `"one-at-a-time"` hands off the whole merged steer. `handOffHeldSteers` (`lifecycle.ts:1033-1039`) and the settle drain (`followup-drain.ts:79-83`) build the content from `steerContent(entry)` and, after the one `sendUserMessage` returns, ack each promptId: `for (const id of promptIds) ack(id)`. The `DrainDeps.ackSteer` signature stays the same; the drain loops. A session switch mid-hand-off drops a taken merged entry with all its acks, the same as today's per-entry drop (`lifecycle.ts:1027-1030`).

### D7. Wire + relay surface

- `SteerEntryView.mergedCount?: number` (count of originals, present only on a merged entry); `text`/`imageCount` are derived. The server cache passes the view through unchanged (`server/src/event-wiring.ts:2090-2097`).
- `MergeSteeringEntriesFromBrowserMessage` / `MergeSteeringEntriesToExtensionMessage` `{ type, sessionId }` and `SplitSteeringEntryFromBrowserMessage` / `SplitSteeringEntryToExtensionMessage` `{ type, sessionId, id }` (sibling naming: `RemoveSteeringEntryFromBrowserMessage`, `browser-protocol.ts:1506`; `RemoveSteeringEntryToExtensionMessage`, `protocol.ts:1581`) are added to the message unions of `browser-protocol.ts` and `protocol.ts`. They are also tiered `control` (`ws-message-tiers.ts`), session-scoped (`ws-message-scope.ts`), routed (`browser-gateway.ts:2350`-style cases), relayed by `handleMergeSteeringEntries` / `handleSplitSteeringEntry` (`session-action-handler.ts`, same `sessionManager.get` guard), added as ignored cases to the exhaustive ACP switch (`server-requests.ts:128-130`), MCP-denylisted (`tools.denylist.ts`), and added to the bus-client verbs via `npm run codegen` in `packages/bus-client` (`src/generated/verbs.ts:23,55,123,155` list the sibling verbs).

### D8. Setting: global config key relayed through `preferences_update`

- `mergeQueuedSteers: boolean` (default `false`) is added to `shared/src/config.ts` (type, default, boolean parse, next to `completedFirst` at `:1343,1789,2793`), to the server runtime config type (`server.ts:525`-style field), AND to the boot mapping in `server/src/cli.ts:286` (`mergeQueuedSteers: fileConfig.mergeQueuedSteers`). The runtime config is rebuilt field by field there (`cli.ts:250-289`, with a warning at `:280-283` about dropped fields), so without this line the setting would reset to absent after every restart.
- `system-routes.ts` hot-applies it (`:749-751` pattern) and, on change, calls a new optional dep `onSteeringConfigChanged?.()` IMMEDIATELY AFTER the assignment `config.mergeQueuedSteers = reloaded.mergeQueuedSteers` (calling it earlier, e.g. beside the vault hook at `:733`, would broadcast the old value) (pattern: `onVaultConfigChanged`, `system-routes.ts:248,733`). `server.ts` wires it (`:3176`) to `piGateway.broadcast(buildPreferencesUpdate(preferencesStore, steering))`.
- `buildPreferencesUpdate(store, steering: { mergeQueuedSteers: () => boolean })` takes a REQUIRED second argument, so no caller can silently omit the field. The one existing one-argument test call (`server/src/__tests__/preferences-claude-compat-routes.test.ts:34`) is updated. Every production caller passes it: `event-wiring.ts:602,1940` (through a new `getMergeQueuedSteers` dep, pattern `isCompletedFirst`, `server.ts:2000`) and both PATCH broadcasters (`routes/preferences-auto-name-routes.ts:65`, `routes/preferences-claude-compat-routes.ts:45`, through their deps).
- `PreferencesUpdateExtensionMessage.mergeQueuedSteers?: boolean`.
*Alternatives:* (a) the preferences store with its own PATCH route, rejected because the brief fixes it as a Save-bar config key on the Sessions page; (b) the server stamping a flag on each forwarded steer `send_prompt`, rejected because there are several ingress paths (browser WS, REST `session-api.ts`, ACP).

### D9. Client: grouped steers with mutually exclusive Merge/Split

- `PendingSteerCard` loses its header row. A new `PendingSteerGroupLabel` (testid `pending-steer-group-label`) renders once above the stack, with the spinner: `Steering` (one plain entry), `Steering · N` (N ≥ 2 entries), or `Steering · merged` (exactly one entry with `mergedCount ≥ 2`), each followed by `· sends after this turn`.
- `ChatView` renders the label, the bubbles in their `ChatEnter` wrappers with a tight gap (the per-bubble `mt-4 mb-4` becomes a `gap-1` stack with the outer margin on the group), and a right-aligned control row.
- Control row, as in the mock's ternary (`mock.tsx:137-139`): exactly one entry with `mergedCount ≥ 2` → `Split N` (testid `pending-steer-split`, N = `mergedCount`). Otherwise, ≥ 2 entries that all have an `id` → `Merge N` (testid `pending-steer-merge`, N = number of bubbles). `Clear all` keeps its ≥ 2-entries rule. A mixed `[merged, plain]` therefore shows `Merge 2`, which flattens into one merged entry. Both buttons use `QUEUE_CLEAR_ALL_CLASS` with `mdiCallMerge` / `mdiCallSplit`, and carry the mock's `aria-label`s ("Merge N steers into one message" / "Split back into N steers") and `title`s ("Send as one message" / "Send as separate messages") (`mock.tsx:62-80`). The group label is right-aligned like the bubbles (`mock.tsx:107-116`). The mock's testids `merge-steers`/`split-steers` are renamed to the component's `pending-steer-*` convention.
- `normalizeSteering` carries `mergedCount`. `SettingsPanel.tsx`'s local `Config` interface (`:227`-area, beside `completedFirst?`) gains `mergeQueuedSteers?: boolean`. The SessionCard queue count (`components/session/SessionCard.tsx:1253`, `steering.length`) is deliberately unchanged: it counts pending messages, and a merged steer is one message. `useSessionActions` gains `mergeSteeringEntries()` / `splitSteeringEntry(id)`, threaded through `App.tsx:2687` into new OPTIONAL `ChatView` props `onMergeSteers` / `onSplitSteer` (optional like `onCancelSteer`: `team-app`'s `ChatPane.tsx:98` mounts `ChatView` without steer props). A control renders only when its handler is provided. New i18n keys (English defaults, plus `i18n-hu.ts` / `i18n-zh-CN.ts` entries next to `session.steering` at `:1883` / `:1213`).

### D10. Settings: `Steering` section

A new `Section` titled `Steering` sits between `Session list` and `Lifecycle & recovery` on the Sessions page. It holds one `ToggleField` "Merge queued steers automatically", testid `settings-merge-queued-steers`, bound to `config.mergeQueuedSteers ?? false`, with the agreed hint. Also: `CONFIG_FIELD_PAGE.mergeQueuedSteers = "sessions"` and a `computeConfigPartial` diff line. The section-order test (`settings/__tests__/settings-page-composition.test.tsx:286`) gains `Steering`.

## Risks / Trade-offs

- [Version skew: the bridge (`@blackbelt-technology/pi-dashboard-extension`) and the server are separate npm packages. A session whose bridge was not reloaded drops the new verbs silently (`command-handler.ts:1229-1230` default → `undefined`), and its views never carry `mergedCount`] → there Merge is a no-op until that session's bridge reloads (`npm run reload`, or a pi restart). Accepted, with no version gate: the merge buttons are additive, nothing is lost, and the bridge version is already visible on the session (`extensionIdentity.version`) for diagnosis.
- [A buffered slash steer (an unrecognised `/foo` buffered by the `sessionPrompt` fallback, `bridge.ts:1585-1589`) loses its command meaning once joined into a merged text] → accepted trade-off. Mid-stream slash steers are rare, Split restores them before hand-off, and the merged bubble shows the text.
- [A merged steer may carry many images in one message (up to the 20-entry cap of originals). There is no per-message image ceiling beyond the steer buffer's aggregate byte ceiling] → accepted. Provider image limits sit well above 20 originals' worth for typical pastes, and Split restores per-message delivery.
- [The merged text loses per-steer boundaries for the model] → the blank-line join keeps paragraphs distinct. Split is available until hand-off.
- [A race: Merge or Split sent while the hand-off takes the entries] → the hand-off removes entries synchronously (`lifecycle.ts:1024-1025`). A merge then finds < 2 entries (no-op + re-announce); a split of a taken id gets "already sent" feedback.
- [The split-pause latch is invisible] → it clears as soon as the buffer empties (normally the next turn) or on a manual Merge, and Merge stays available.

## Migration Plan

No data migration. The config key is absent, which means `false` (today's behaviour). Rollback = revert. Absent fields read as non-merged.
