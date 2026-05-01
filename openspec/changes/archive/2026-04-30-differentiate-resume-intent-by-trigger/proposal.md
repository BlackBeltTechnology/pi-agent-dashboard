## Why

After `top-of-tier-on-status-change` landed, the ended→alive `onChange` branch in `server.ts` does one thing for every intent-tagged transition: `moveToFront(cwd, id)`. That's correct for two of the four user-driven resume paths but **wrong** for the other two:

| # | Trigger | Today | Should be |
|---|---|---|---|
| 1 | Resume button | top of alive ✅ | top of alive |
| 2 | Drag-to-resume | top of alive ❌ | **stay at the dropped slot** (clobbered today by `moveToFront`) |
| 3 | REST resume | top of alive ✅ | top of alive |
| 4 | Auto-resume on prompt-to-ended (`handleSendPrompt` ended branch spawns directly without tagging intent) | stays mid-bucket ❌ | **top of alive** (user is actively interacting) |
| 5 | Bridge auto-reattach (server reload, pi still alive) | layout preserved ✅ | layout preserved |

The two failures share the same root cause: the registry is a boolean (`tagged: yes/no`) but reality has three states (`tag-front`, `tag-keep-position`, `untagged`). Drag-to-resume already writes the dropped position to `sessionOrder` via `reorder_sessions`, so when the bridge re-registers and `moveToFront` fires, it **clobbers the slot the user just chose**. Auto-resume-on-prompt isn't tagged at all, so it falls into the bridge-reattach branch and never surfaces.

## What Changes

- **Modify** `pending-resume-intent-registry.ts` to record an `intent: "front" | "keep"` per id rather than a bare timestamp. Idempotent re-record refreshes both timestamp and intent (last-write-wins). TTL semantics unchanged (60 s, lazy expiry on read).
- **Modify** the `onChange` ended→alive branch in `server.ts` to switch on the consumed intent: `"front"` → `moveToFront` + broadcast, `"keep"` → no-op (drop position already persisted by an earlier `reorder_sessions`), `null/missing` → bridge-reattach branch (no mutation, no broadcast — unchanged).
- **Modify** `handleResumeSession` (`session-action-handler.ts`) to tag with `"front"` (default for button + REST + drag-to-resume *via the existing `onResume` callback*).
- **Add** a new browser → server message variant: `resume_session` gains an optional `placement: "front" | "keep"` field defaulting to `"front"` for backwards compatibility. Drag-to-resume sends `placement: "keep"`.
- **Modify** `SessionList.handleDragEnd` (drag-to-resume detection) to call a new client callback `onResumeKeepPosition(id)` — distinct from the regular `onResume(id, mode)` — so the UI can express the placement choice without overloading existing call sites.
- **Add** `useSessionActions.handleResumeSessionKeepPosition` that emits `resume_session` with `placement: "keep"`.
- **Modify** `handleSendPrompt`'s auto-resume branch (`session-action-handler.ts:184`) to tag the registry with `"front"` before calling `spawnPiSession`. The user is actively interacting with the session — surface it.
- **No protocol-breaking change.** New `placement` field is optional; existing clients that don't send it keep getting `"front"` semantics, identical to today.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `session-ordering`: extend the resume-related requirements to express the 3-way intent contract (front, keep, untagged) instead of the current 2-way (tagged-or-not). Requires modifying the existing "Continued sessions keep position" requirement and adding new requirements for drag-to-resume slot preservation and prompt-auto-resume top-of-tier surfacing.
- `auto-resume-on-prompt`: clarify that the prompt-on-ended path participates in the intent-tagged ordering contract (today this spec exists for the prompt-queue mechanics but doesn't address ordering). Add a requirement that auto-resume tags `"front"` so the resumed session surfaces at top.

## Impact

- `packages/server/src/pending-resume-intent-registry.ts` — registry shape changes from `Map<string, number>` to `Map<string, { intent: "front" | "keep"; timestamp: number }>`. Public API renamed: `record(id)` → `record(id, intent)`, `consume(id)` returns `"front" | "keep" | null` instead of `boolean`.
- `packages/server/src/server.ts` — `onChange` ended→alive branch switches on the consumed intent.
- `packages/server/src/browser-handlers/session-action-handler.ts` — `handleResumeSession` reads `msg.placement ?? "front"` and tags accordingly. `handleSendPrompt` ended-branch tags `"front"`.
- `packages/shared/src/browser-protocol.ts` — `ResumeSessionBrowserMessage` gains optional `placement: "front" | "keep"`.
- `packages/client/src/components/SessionList.tsx` — `handleDragEnd` calls `onResumeKeepPosition` instead of `onResume` when drop classifies as drag-to-resume.
- `packages/client/src/hooks/useSessionActions.ts` — new `handleResumeSessionKeepPosition` exported and threaded through `App.tsx`.
- `packages/client/src/App.tsx` — wire the new callback into `<SessionList onResumeKeepPosition={...} />`.
- Tests:
  - `pending-resume-intent-registry.test.ts` — extend to cover the 3-way intent return value, last-write-wins on re-record, and the `"keep"` round-trip.
  - `session-order-reboot.test.ts` — extend to assert `"keep"` intent does NOT mutate order, and `"front"` does.
  - New: `session-action-handler.test.ts` cases for `placement` field handling and prompt-auto-resume tagging `"front"`.
  - New: `SessionList.test.tsx` case asserting drag-to-resume uses the keep-position callback.
- Spec deltas: `session-ordering` (modified + added), `auto-resume-on-prompt` (added).
- **No persistence migration.** Registry is in-memory only.
- **No breaking change** for browsers: `placement` is optional and defaults to `"front"` (old behavior).
