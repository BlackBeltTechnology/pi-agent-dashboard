# Tasks: replace-replayed-greeting

## 1. State-replay — singleton current greeting (reload path)

- [ ] 1.1 In `packages/shared/src/state-replay.ts` `replayEntriesAsEvents`, special-case
      `entry.type === "custom_message"` AND `entry.customType === "ib-greeting"` AND
      `entry.display`: do NOT emit inline. Record the slot of the FIRST greeting
      (`messages.length` on first encounter) and keep overwriting a `latestGreeting`
      (message + ts + entryId) with each subsequent greeting.
- [ ] 1.2 After the entry loop (before the flow-event emission), if `latestGreeting` is
      set, splice ONE `message_start` + `message_end` pair (carrying `customType:
      "ib-greeting"`, latest content, `entryId` = latest entry id) into `messages` at the
      recorded slot. Emit nothing when no greeting exists.
- [ ] 1.3 Non-greeting `custom_message` entries keep their current inline
      `message_start` + `message_end` emission unchanged (per-entry `entryId`).
- [ ] 1.4 `display` falsy / absent greeting → still skipped (the existing
      `entry.display` guard), no singleton handling.

## 2. Reducer — greeting replaces in place (live + replay path)

- [ ] 2.1 In `packages/client/src/lib/chat/event-reducer.ts` `message_end`, in the
      `msg?.role === "custom" && msg?.display` branch, when `msg.customType ===
      "ib-greeting"`, use a stable row id `custom-ib-greeting` instead of
      `custom-${entryId ?? messages.length}`; keep the existing replace-in-place
      (`findLastIndex`) and append logic otherwise.
- [ ] 2.2 Non-greeting custom messages keep `custom-<entryId>` (unchanged, not
      collapsed). `display` falsy → still no row.

## 3. Lock test — query route passthrough

- [ ] 3.1 In `packages/invoicebot-plugin/src/server/__tests__/routes.test.ts`, add a lock
      test POSTing `/query` with `{ cwd, view: "current-greeting", session_id: "sess-x" }`
      and asserting the recording engine received `args` containing `view:
      "current-greeting"` AND `session_id: "sess-x"` verbatim (no reshaping/dropping). No
      route code change.

## Tests (vitest — scoped)

- [ ] T1 Replay singleton: three `ib-greeting` entries (A, B, C) replay to exactly one
      `message_start` + one `message_end`, both content C, `entryId` = latest id, at the
      first greeting's slot.
- [ ] T2 Replay isolation: `ib-greeting` entries + an unrelated `x-note` entry replay to
      one greeting pair + one `x-note` pair (x-note content + entryId intact).
- [ ] T3 Replay no-greeting: display-flagged custom messages with no `ib-greeting` replay
      unchanged (regression guard).
- [ ] T4 Reducer replacement: two `ib-greeting` `message_end`s (A then B) → exactly one
      row, id `custom-ib-greeting`, content B.
- [ ] T5 Reducer isolation: `ib-greeting` (A then B) + one `x-note` → one greeting row
      (B) + one separate `x-note` row.
- [ ] T6 Reducer hidden: `customType:"ib-greeting"`, `display:false` → no row.

## Validate

- [ ] V1 `openspec validate replace-replayed-greeting --strict` passes.
- [ ] V2 Scoped tests green: `packages/shared` replay suite, `packages/client`
      event-reducer suite, `packages/invoicebot-plugin` routes suite; `tsc` clean;
      `npm run build` succeeds. Full dashboard suite not required. E2E OFF.
