# Design: replace-proposal-dialog-with-race-handling

## Three-Layer Model

```
LAYER 1  Detector filter (already exists)
         packages/shared/src/openspec-activity-detector.ts
         isActive=false  → swallowed (reads = passive)
         isActive=true   → flows downstream

LAYER 2  Server coalescing (NEW)
         packages/server/src/event-wiring.ts
         pendingReplaceProposal: per-session, single slot
         Newer event overwrites; same name = no-op;
         rejected name = ignored

LAYER 3  Client commit/suggestion split (NEW)
         Dialog component
         committedTarget    = what the button attaches
         latestSuggestion   = what server is currently suggesting
         Diverge → banner with explicit [Use latest] action
```

### Critical invariant

> What the user sees on the button is exactly what attaches on click.

The server may freely update `pendingReplaceProposal` as the LLM
emits new events. The dialog's *commit target* only changes through
an explicit user click on `[Use latest]`. This is the entire reason
for the layer split.

## State Machine

```
                    ┌───────────────────────────────────┐
                    │                                   │
                    │   pendingReplaceProposal = null   │
   ┌──────────────▶ │   (no dialog rendered)            │
   │                └───────────────────────────────────┘
   │                            │
   │              event { changeName: X, isActive: true }
   │              X != attachedProposal
   │              X != pendingReplaceProposal
   │              X not in rejectedReplaceProposals
   │                            │
   │                            ▼
   │                ┌───────────────────────────────────┐
   │                │  pendingReplaceProposal = X       │
   │                │  (dialog open, committedTarget=X) │
   │                └───────────────────────────────────┘
   │                            │
   │             ┌──────────────┼──────────────────────┐
   │             │              │                      │
   │     event for Y         user clicks         user clicks
   │     (Y != X)            [Replace]           [Dismiss]
   │             │              │                      │
   │             ▼              ▼                      ▼
   │   pendingReplaceProposal   attachedProposal  rejectedReplaceProposals
   │   = Y (overwrite,          = committedTarget  += committedTarget
   │   server broadcast)        attach + rename;   pendingReplaceProposal
   │             │              clear pending       = null
   │             │              proposal               │
   │             │                  │                  │
   │             ▼                  └──────────────────┴───┐
   │   Client sees Y != commit                              │
   │   Renders banner:                                      │
   │   "Newer: Y. [Use latest]"                             │
   │                                                        │
   │   user clicks [Use latest]:                            │
   │     committedTarget := Y                               │
   │                                                        │
   └────────────────────────────────────────────────────────┘
                                                            │
                  ┌─────────────────────────────────────────┘
                  │
                  ▼
   agent_end event clears:
     pendingReplaceProposal := null
     rejectedReplaceProposals := empty
```

## Decision Log

### D1: Coalesce, don't queue

Queueing every pending suggestion would spam the user with sequential
dialogs (most are noise — `openspec list`, `openspec show`, repeated
bashes inside the same loop). Coalescing into one slot, latest wins,
matches user intent: "if the LLM has now moved on to E, that's the
relevant question — not B from 30 seconds ago."

### D2: Server holds suggestion, client holds commit target

Alternative considered: client-only state. Rejected because:
- Reconnect would lose the dialog (server has no record).
- Multiple browsers viewing the same session would each see different
  dialog targets depending on which events they observed.
- `pendingReplaceProposal` integrates naturally into the existing
  `session_updated` broadcast / replay pipeline.

Alternative considered: server-only state with auto-rebound commit
target. Rejected because of the footgun documented in `proposal.md`
(button text mutates while user is reaching for it).

### D3: Rejection memory keyed on changeName, cleared on agent_end

Without rejection memory: user dismisses, the very next bash command
emitting the same name re-opens the dialog. Infinite loop in practice.

Scope of rejection: only the specific `changeName` is remembered. If
the LLM later legitimately moves to a different change, the dialog
should re-fire — the user's dismissal was about *that* suggestion,
not all future ones.

Lifetime: `agent_end` clears the rejection set. Rationale: same loop
of LLM activity = same intent context; new turn = fresh slate. This
mirrors the existing clearing of `openspecPhase` / `openspecChange`
in the `agent_end` handler (~line 353 of `event-wiring.ts`).

Alternative: 60s TTL. Rejected because turn duration is highly
variable (a long apply-change can run >5 min) and a wall-clock TTL
would re-prompt mid-turn.

### D4: Esc / click-outside count as dismissal (with rejection memory)

Treating Esc as "snooze without memory" creates the same infinite
loop as D3 describes. Esc = dismiss = remember. The `[Use latest]`
banner action is the only way to accept a non-committed suggestion;
explicit `[Replace]` accepts the committed target.

### D5: Manual attachment to a now-deleted proposal bypasses the dialog

If `attachedProposal = "X"` but `X` no longer appears in OpenSpec
poll output (archived or deleted), there is no real conflict — the
attached thing is gone. The server SHALL auto-attach the new
changeName as if no proposal had been attached. Probing `X`'s
existence requires a poller-state read at the time of the event;
acceptable because OpenSpec poll output is already in memory.

### D6: One dialog component, banner is conditional

Two options for the divergence UI:
1. Same dialog, conditional banner slot.
2. Two distinct dialog states.

Choosing (1) because the only thing that changes is whether a banner
appears above the buttons. Mounting/unmounting on every divergence
would lose user focus and feel jumpy.

## Touched Files

| File | Change |
|---|---|
| `packages/shared/src/types.ts` | Add `pendingReplaceProposal?: string \| null` and `rejectedReplaceProposals?: string[]` to `DashboardSession` |
| `packages/shared/src/browser-protocol.ts` | Add `accept_replace_proposal` and `dismiss_replace_proposal` message types |
| `packages/server/src/event-wiring.ts` | Add the third branch + `agent_end` clear + deleted-proposal bypass |
| `packages/server/src/browser-handlers/session-meta-handler.ts` | Handlers for accept/dismiss; reuse `attachRenameTarget` for the rename path |
| `packages/server/src/proposal-attach-naming.ts` | (Read-only) used by the accept handler |
| `packages/client/src/components/SessionOpenSpecActions.tsx` (or new dialog component) | Render the dialog when `pendingReplaceProposal` is set; commit/suggestion split state. **Build on `unify-dialog-system`'s `Dialog` shell** (custom body, not `Confirm` preset) — do not hand-roll. |
| `packages/server/src/__tests__/` | Tests covering coalesce, rejection memory, agent_end clear, deleted-proposal bypass, race scenarios |

## Open Question (deferred)

If a user *manually* attaches B, then the LLM works on B for a while,
then the LLM pivots to C — this design fires a dialog. But what if
the user manually attaches B, the LLM writes to B *and* C in
overlapping ways within the same turn? The dialog would fire for C,
suggesting replacement, even though the user's mental model might be
"B is the parent, C is a child". This proposal does NOT solve
multi-proposal sessions; that's a larger scope (would need a
proposal-set rather than a single attachment). Out of scope here.
