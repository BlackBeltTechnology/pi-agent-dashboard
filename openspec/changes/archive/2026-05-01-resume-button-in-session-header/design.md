## Context

The dashboard's chat panel is rendered by `ChatPanel` inside `App.tsx`, with a sticky `SessionHeader` at the top. When the displayed session transitions to `status: "ended"` (server reload, pi crash, bridge disconnect, user-initiated shutdown), the header continues to show name / model / thinking-level / elapsed-time / Attach / Flow / Modules / ChangedFiles / refresh — but no resume affordance.

Resume / Fork affordances exist in two places today:

1. **Sidebar `SessionCard.tsx:544-563`** — green Resume + blue Fork pills, gated on `(!isAlive || isHidden) && session.sessionFile`, disabled while `session.resuming`.
2. **Mobile `MobileActionMenu`** — kebab → Resume entry, plumbed via `mobileActions.onResume` from `App.tsx:838`.

Both ultimately call `handleResumeSession(sessionId, mode)` which sends a `resume_session` WebSocket message. The protocol, server-side spawn, and `pendingResumeIntents` machinery are unchanged by this proposal — see existing `session-resume` capability spec.

The desktop `SessionHeader.tsx` accepts a `mobileActions?: { onResume?, ... }` prop bag but currently only uses it inside the mobile branch (`isMobile === true`). The desktop branch (`SessionHeader.tsx:351+`) renders the toolbar without any resume hook.

## Goals / Non-Goals

**Goals:**
- Surface Resume + Fork affordances in the desktop `SessionHeader` toolbar when the viewed session is ended and has a `sessionFile`.
- Reuse the existing `handleResumeSession` callback — no new server contract, no new WebSocket message, no new state.
- Match the sidebar card's exact visual language (green/blue pills, MDI icons, tooltips, `resuming` disable behavior) so the affordance is instantly recognizable.
- Replace the meaningless elapsed-time tombstone text with the buttons when ended (slot reuse, no toolbar bloat).

**Non-Goals:**
- Mobile changes — `MobileActionMenu` already exposes Resume; not promoting it to row-1.
- Auto-resume on dashboard reload — explicit click stays the contract (avoids surprise spawns).
- New error / retry affordances — `ChatView`'s existing `onRetryAfterError` covers mid-turn LLM failures and is a different state (alive but failed). The new buttons are scoped strictly to `status === "ended"`.
- Resume of sessions without `sessionFile` — pre-pi-0.69 sessions remain non-resumable; same gate as sidebar card.

## Decisions

### Decision 1: Reuse `mobileActions.onResume` shape, but lift to a top-level `onResume` prop

The existing `mobileActions: { onResume?: (mode: "continue" | "fork") => void }` is mobile-scoped. Rather than re-using it from the desktop branch (which would couple desktop to a "mobile" prop bag and confuse intent), introduce a new top-level `onResume?: (mode: "continue" | "fork") => void` prop on `SessionHeader`. `App.tsx` passes the same `(mode) => handleResumeSession(selectedId, mode)` callback into both `mobileActions.onResume` and the new top-level prop.

**Alternatives considered:**
- _Reuse `mobileActions.onResume` from desktop_: rejected — naming lies, future mobile-specific mutations would force conditionals.
- _Pass `sessionId` + `handleResumeSession` separately_: rejected — exposing the resolver on the header inverts the established `App.tsx`-owns-session-state pattern.

### Decision 2: Slot — replace elapsed-duration with Resume/Fork pills when ended

The desktop toolbar reads (left → right): `name … duration ⟲refresh`. When `status === "ended"`, swap the duration `<span>` for the button pair. Rationale:
- Duration on a tombstone session is decorative, not informative.
- Keeps the always-on toolbar (Attach / Flow / Modules / ChangedFiles) visually identical between active and ended states.
- Aligns to the sidebar card layout, which also surfaces Resume in the same right-side region.

**Alternatives considered:**
- _Append after duration_: rejected — duplicate signals (faded duration + bright button) for the same "this is dead" semantic.
- _Banner above chat_: rejected — fights with `connectionBanner` and `MissingRequiredBanner` for the same vertical space; overlap risk.

### Decision 3: Visual parity with sidebar card

Use the exact classnames + icons from `SessionCard.tsx:548-562`:
- Resume: `border-green-500/30 text-green-400 hover:bg-green-500/10`, `mdiPlayCircleOutline`.
- Fork: `border-blue-500/30 text-blue-400 hover:bg-blue-500/10`, `mdiSourceFork`.
- Both: `text-[10px] px-1.5 py-0.5 rounded border`, `disabled:opacity-50 disabled:cursor-not-allowed` while `session.resuming`.

This is a deliberate copy — extracting a shared component is out of scope (would force refactoring SessionCard's `e.stopPropagation` semantics and the `(!isAlive || isHidden)` predicate that doesn't apply to the header).

### Decision 4: No `e.stopPropagation` in header buttons

Sidebar card buttons call `e.stopPropagation()` to avoid triggering the card's onClick (which navigates to the session). The header is not clickable as a whole, so the stop-propagation is unnecessary. Omit it to keep the header click handlers minimal.

### Decision 5: Render gate

Buttons render iff:

```
session.status === "ended"  &&  Boolean(session.sessionFile)  &&  Boolean(onResume)
```

The third clause makes the prop opt-in — callers (including tests, future Storybook) that don't pass `onResume` get the original behavior. This matches the pattern used for `onRefresh`, `onOpenDiffView`, etc. on the same component.

## Risks / Trade-offs

- **[Risk]** Flicker during bridge mid-reattach where `status` momentarily reads `"ended"` then flips back to `"active"`.
  → **Mitigation**: `session.resuming` is set when the user (or auto-resume path) initiates a respawn; the disabled state masks the brief window. The cold-start `force status=ended` override in `session-scanner.ts` only fires before any bridge connects, so cannot flap. No new flicker surface introduced.

- **[Risk]** Duplicate Resume invocations if user clicks twice before `resuming` propagates from server broadcast.
  → **Mitigation**: `disabled={session.resuming}` matches sidebar card behavior; the existing `pendingResumeIntents` registry on the server deduplicates regardless. Worst case: one extra ignored WebSocket message.

- **[Risk]** Visual debt — the same button pair now lives in three places (sidebar card, mobile kebab, desktop header).
  → **Trade-off**: extracting `<ResumeForkButtons />` shared component requires unifying three slightly different gating rules and `e.stopPropagation` semantics; defer until a fourth caller appears or sidebar card is refactored.

- **[Risk]** User confusion about which Resume to click when both sidebar card AND header are visible (desktop wide layout).
  → **Trade-off**: both invoke the same callback; same outcome. Net positive — the closer affordance reduces travel.

## Migration Plan

No migration. Pure additive UI change. No persisted state changes, no protocol changes, no settings migration.

Rollback: revert the `SessionHeader.tsx` + `App.tsx` diff. No data implications.

## Open Questions

None blocking. Future considerations (out of scope for this change):
- Should the chat input's send button auto-resume on Enter when ended? (Probably yes — there's an existing `auto-resume-on-prompt` capability spec covering this; verify alignment.)
- Should we add a one-line "Session ended" hint above the input box on ended sessions? (UX polish, separate proposal.)
