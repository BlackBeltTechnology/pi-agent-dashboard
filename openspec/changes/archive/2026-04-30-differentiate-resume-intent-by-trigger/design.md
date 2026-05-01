## Context

The `top-of-tier-on-status-change` change replaced a 2-arm switch in `server.ts onChange` ended→alive with a single `moveToFront(cwd, id)` call gated by `pendingResumeIntents.consume(id)`:

```ts
endedSessionIds.delete(sessionId);
if (!pendingResumeIntents.consume(sessionId)) {
  return;                                              // bridge reattach
}
sessionOrderManager.moveToFront(session.cwd, sessionId);  // user resume
broadcast({ type: "sessions_reordered", ... });
```

This treats every user-tagged ended→alive transition identically. But the four user-driven resume paths are not equivalent:

```
   Trigger             What user expects               What pendingResumeIntents
                                                       knows about it today
   ─────────────────   ─────────────────────────────   ────────────────────────
   Resume button       "bring it back, prominently"    record() called → tagged
   Drag-to-resume      "I dropped it HERE between A    record() called → tagged
                        and B; keep that slot"         (same as button — wrong)
   REST API resume     "bring it back"                 record() called → tagged
   Auto-resume on      "I'm typing into it; surface    record() NOT called →
   prompt-to-ended      it"                            falls into bridge-reattach
                                                       branch → no mutation (wrong)
   Bridge reattach     "I just reloaded the app, do    record() NOT called →
                        not move things around"        no mutation (correct)
```

Two bugs follow:

**Bug A — Drag-to-resume clobbered by `moveToFront`.** `SessionList.handleDragEnd` writes the dropped position (e.g. `[A, X, B]`) via `reorder_sessions` and then calls `onResume(id, "continue")`. That triggers `handleResumeSession` → `pendingResumeIntents.record(id)` → bridge re-registers → `onChange` ended→alive fires `moveToFront` → order becomes `[X, A, B]`. The drop slot is lost.

**Bug B — Prompt-to-ended doesn't surface.** `handleSendPrompt` detects `status === "ended"` and calls `spawnPiSession(...)` directly without touching `pendingResumeIntents`. The bridge re-registers, `consume` returns false, the branch returns early. The session re-appears mid-bucket where its `startedAt` lands it, even though the user is **literally typing into the chat**.

## Goals / Non-Goals

**Goals:**

- ✅ A 3-way contract: `"front"` (move to top), `"keep"` (leave order alone), `null/missing` (bridge reattach — leave order alone, identical to today's untagged path).
- ✅ Drag-to-resume preserves the dropped slot. The earlier `reorder_sessions` write is the source of truth; the resume round-trip MUST NOT clobber it.
- ✅ Prompt-to-ended auto-resume surfaces the card at top of the alive tier, matching the user's mental model ("I just acted on this — show it to me").
- ✅ Backwards compatible at the WS protocol level. Old browsers that send `resume_session` without a `placement` field continue to behave as they do today (i.e. front-placement, since today's only tag-driven path is move-to-front).
- ✅ Backwards compatible at the registry-API level for **server-internal callers** — but the public shape changes (boolean → enum), and that's an intentional, single-package surface area.

**Non-Goals:**

- ❌ A 4th intent. There's no need for "keep-but-broadcast" or "front-but-quiet"; the two real placements are "use the slot the user already chose" vs. "I want this prominent now."
- ❌ Persisting intents across server restarts. The registry remains in-memory. Stale entries clear on the existing 60 s lazy-expiry path.
- ❌ Removing `moveToFront` from `session-order-manager.ts`. It's the right primitive for the `"front"` arm; no need to re-fold it back into ad-hoc remove + insert.
- ❌ Changing the renderer's active/ended split. Still alive on top, ended on bottom. Drag-to-resume still incurs a transient "card disappears into ended bucket then reappears at drop slot" flash during the bridge round-trip — same as today.

## Decisions

### D1: Registry stores `{ intent, timestamp }` instead of bare `timestamp`

```ts
interface PendingResumeIntent {
  intent: "front" | "keep";
  timestamp: number;
}
type Registry = Map<string, PendingResumeIntent>;
```

`record(id, intent)` writes the entry; `consume(id)` returns `"front" | "keep" | null` (null = no entry / expired). Last-write-wins on re-record (same as today's timestamp-refresh behavior; the new field follows the same rule).

**Alternatives considered:**

- **Two registries (`pendingResumeIntentsFront`, `pendingResumeIntentsKeep`).** Doubles the lookup surface and the sweep cost. The two are mutually exclusive per id at any moment, so one map keyed by intent is cleaner.
- **Pass intent through a side-channel (e.g. annotate the spawn record).** Couples ordering to spawn lifecycle, which already has its own concerns (`pendingDashboardSpawns`, `headlessPidRegistry`). Keeping intent in its own registry maintains separation.

### D2: WS protocol gains `placement?: "front" | "keep"` on `resume_session`

```ts
interface ResumeSessionBrowserMessage {
  type: "resume_session";
  sessionId: string;
  mode: "continue" | "fork";
  entryId?: string;
  placement?: "front" | "keep";   // NEW — defaults to "front" server-side
}
```

Server-side default keeps every existing browser working unchanged. Old clients hit the `?? "front"` fallback in `handleResumeSession`, get the post-`top-of-tier` behavior they already have today.

**Alternatives considered:**

- **Two separate message types (`resume_session_front`, `resume_session_keep`).** Visually loud, and forces callers to pick — but makes the protocol contract explicit at the type level. Rejected: the optional-field shape with a documented default is cheaper at the call sites and at the protocol-versioning layer.
- **Infer placement server-side from a `dragHint` or similar implicit signal.** Fragile; the click and the drag both hit the same `handleResumeSession` if we don't differentiate at the message level.

### D3: Drag-to-resume gets its own client callback

Keeping the existing `onResume(id, mode)` callback signature unchanged minimises churn at the `<SessionCard>` and `<MobileActionMenu>` call sites (button + menu). Only `SessionList.handleDragEnd` needs the new entrypoint:

```ts
interface SessionListProps {
  onResume?: (id: string, mode: "continue" | "fork") => void;       // unchanged
  onResumeKeepPosition?: (id: string) => void;                       // NEW
}
```

`useSessionActions` exports both:

```ts
function handleResumeSession(id, mode, entryId?) { ... placement: "front" ... }
function handleResumeSessionKeepPosition(id)     { ... placement: "keep"  ... }
```

**Alternatives considered:**

- **Overload `onResume` with a `placement` arg**: `onResume(id, mode, placement)`. Three positional args is a smell, and the only caller that passes `"keep"` is the drag handler — every other caller wants the default. Rejected.
- **Always send `placement: "keep"` from `handleDragEnd` AND `placement: "front"` everywhere else, no default**: forces the field on every call site. Rejected: optional-with-default keeps the registry's "behave like today" contract for callers that don't care.

### D4: `handleSendPrompt` auto-resume branch tags `"front"`

The current code path:

```ts
if (promptSession?.status === "ended") {
  pendingResumeRegistry.record(promptSession.cwd, ...);   // queues the prompt
  // ... session.update(resuming: true), broadcast ...
  await spawnPiSession(...);                              // ← no intent tag
}
```

becomes:

```ts
if (promptSession?.status === "ended") {
  pendingResumeRegistry.record(promptSession.cwd, ...);
  pendingResumeIntents.record(msg.sessionId, "front");    // NEW
  // ...
  await spawnPiSession(...);
}
```

Rationale: the user is actively typing into the session. There is no defensible UX where "I just sent a prompt to this thing, please don't surface it." If a future use case wants the prompt to NOT surface (e.g. a background queued reply), it should be a different message type, not a different intent on this one.

### D5: No deprecation, no migration window

The `pending-resume-intent-registry` is server-internal. The boolean → enum API change ships in lockstep with `server.ts`'s call-site update. No TypeScript-level breakage outside the package; no users of the registry exist outside `packages/server/src/`.

The WS protocol change is forward-compatible: old browsers omit `placement`, server defaults to `"front"`. No version skew failure mode.

## Risks / Trade-offs

**[R1: Drag-to-resume still has a transient visual flash]** — between the drop and the bridge re-register, the card is briefly classified as ended and shown in the ended bucket, then re-appears at the drop slot once status flips to alive. → *Mitigation*: out of scope for this change. Same behavior as today; the renderer's status-driven split is what causes it. Could be addressed later by an "optimistic alive" overlay during the resume round-trip.

**[R2: The registry's TTL is 60 s, but a slow spawn could exceed that]** — if `spawnPiSession` takes longer than 60 s, the intent expires before the bridge re-registers, and the ended→alive branch falls into the bridge-reattach arm (no mutation). → *Mitigation*: same risk as today. Spawns this slow are pathological; if it becomes a problem we lift the TTL to 120 s as a separate one-line change.

**[R3: A buggy or malicious browser sends `placement: "keep"` for a button-click resume]** — the card stays where it was instead of surfacing. → *Mitigation*: Trust boundary — browser is already trusted to spawn sessions. The "wrong" placement is cosmetic; user can always click again. No security concern.

**[R4: Two rapid resumes (button → quick second click) re-record the intent]** — last-write-wins. If the first was `"front"` and the second is `"keep"` (or vice versa), the second wins. → *Mitigation*: this is correct semantics. The most recent user action expresses the most recent intent. Documented in the spec scenario "Re-record overwrites prior intent."

**[R5: Auto-resume-on-prompt now broadcasts `sessions_reordered`]** — extra WS traffic for every prompt to an ended session. → *Mitigation*: prompts to ended sessions are not a hot path; the broadcast is one message per resume. Negligible bandwidth.

## Migration Plan

Single commit, no flag, no migration:

1. Update `pending-resume-intent-registry.ts` (signature change).
2. Update every call site **in the same commit**: `server.ts onChange`, `handleResumeSession`, `handleSendPrompt`, all server-internal tests.
3. Add `placement?` to `ResumeSessionBrowserMessage` in `browser-protocol.ts`.
4. Update `useSessionActions.ts` and `SessionList.handleDragEnd` to use the new callback.
5. Tests land alongside (TDD-first per `tasks.md`).

Rollback: revert the commit. Old browsers continue to work because they never sent `placement`; new browsers continue to work because the server still understands resume_session without it (defaulting to `"front"`).

## Open Questions

1. **Should drag-to-resume across folders be supported?** Today, drag-to-resume requires the dragged ended session and the `over` alive session to be in the same group (`group.sessions.find(...)` for both). Cross-folder drags are not detected as resume. Out of scope for this change but worth noting.

2. **Should the `"keep"` arm broadcast `sessions_reordered`?** No, because the order didn't change. The earlier `reorder_sessions` from the drag already broadcast. This avoids redundant traffic and matches the bridge-reattach arm's silence.
