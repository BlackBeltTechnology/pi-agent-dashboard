## Context

`SessionState.pendingPrompt` is written client-side when the composer fires
`send_prompt`, and today it has SEVERAL exits — this design's first draft wrongly
claimed one. Verified inventory:

| Exit | Site |
|---|---|
| ack `prompt_received{fresh:true}` → `sent` | `event-reducer.ts:222` `applyPromptReceived` |
| ack `fresh:false` → drop | same |
| user `message_start` → drop | `event-reducer.ts:1408` |
| `agent_start` → drop | `event-reducer.ts:1209` |
| abort / force-kill / cancel-pending → drop | `useSessionActions.ts:61-138` |
| 30s safety timeout → drop + `lastError` | `usePendingPromptTimeout.ts` (`TIMEOUT_MS=30_000`, `paused`-aware) wired at `App.tsx:1097` |

Ack relay path: `bridge.ts:1279-1340` / `command-handler.ts:451-625` emit
`prompt_received` → `event-wiring.ts:1482` `browserGateway.sendToSubscribers` →
`useMessageHandler.ts:443` → reducer.

Two facts reshape the problem:

1. **A timeout already exists (30s) and already surfaces an error** — it clears
   `pendingPrompt` and sets `lastError: "No response from session…"`
   (`App.tsx:1102-1106`). So "stuck forever" cannot be literally true for the
   selected session; the E2E specs likely time out (Playwright default) BEFORE
   the 30s safety net fires. The user-visible symptom is "stuck for the whole
   test window", not "stuck eternally".
2. **The composer disable is status-blind.** `App.tsx:1848` passes
   `pendingPrompt={!!selectedState.pendingPrompt}` and `CommandInput.tsx:704`
   computes `pendingIdle = pendingPrompt === true && !isWorking`. After a
   SUCCESSFUL ack (`sending` → `sent`) the boolean is still `true`, so the
   composer stays disabled. This alone violates contract scenario 1
   independently of whether the ack arrives.

Subscription model matters too: the browser subscribes to the SELECTED session
only (`App.tsx:903-932`), yet `handleSendPromptToSession` (card quick-send)
writes `pendingPrompt` for arbitrary sessions. On that path neither the ack nor
`message_start` can reach this browser — only the 30s timeout settles it. That
path is structurally unackable today.

Because `message_start`/`agent_start` also clear the bubble, a bubble that stays
`sending` for the whole test implies the ack AND the user-message echo are both
missing for this browser — a broader condition than "the ack was dropped". The
prior draft's localization ("defect is in the ack leg") does not follow, and is
retracted.

## Goals / Non-Goals

**Goals:**

- Fix the status-blind composer gate so an acked prompt re-enables the composer
  immediately (contract scenario 1).
- Determine empirically why the browser-driven bubble stays `sending` in the
  docker harness, accounting for the ack, `message_start` and `agent_start`
  legs and the subscription model.
- Give the existing 30s timeout a VISIBLE failed state that preserves the
  prompt text and re-enables the composer (contract scenario 2).
- Keep `sending` from being resurrected by reset/replay, WITHOUT regressing the
  deliberate `sent`-bubble carry from `preserve-pending-prompt-across-replay`.
- Turn `tests/e2e/faux-text.spec.ts` (#F1) and `tests/e2e/faux-ask.spec.ts` (#F2)
  green **via the ack path**, provably not via the timeout.

**Non-Goals:**

- Adding a NEW timeout, or retuning `TIMEOUT_MS` (30s stays; no evidence 10s is
  safe for docker cold-start round-trips, and the hook's `paused` mid-turn
  suppression is deliberate).
- Removing the `message_start`/`agent_start` clears — they stay exactly as-is.
- Changing mid-turn queueing (`pendingQueues`) semantics.
- Making the unsubscribed card quick-send path ackable (documented gap; only
  the timeout settles it — out of scope, file separately if it matters).
- Re-litigating bridge / faux-provider / registration (proven healthy by REST).
- The cosmetic `readiness timeout` notice — optional polish, gated last.

## Decisions

**D1 — Fix the composer gate first; it is a certain defect.** Pass a status,
not a boolean: `App.tsx:1848` derives from `status === "sending"` (or
`CommandInput` receives the status and derives `pendingIdle` itself). Contract
scenario 1 requires the composer to re-enable on ACK, and today it does not,
regardless of the harness symptom. This is independently testable at unit level.
Scope note: this is NOT a one-line edit — `CommandInput.tsx:79` types the prop
`pendingPrompt?: boolean` and `:704` compares `=== true`. Changing the source of
truth ripples to `Props`, that comparison, and the literal-`true` fixtures in
`CommandInput.test.tsx` (~:168, :939). Either widen the prop to the status union
or keep the prop boolean and change only what `App.tsx` derives — decide once,
and update the fixtures accordingly.

**D2 — Then root-cause the harness symptom (systematic-debugging).** Reproduce
against LOCAL code (`run-dashboard-e2e-local-changes`; a cached image tests
stale code) and determine, per leg, what reaches the browser: ack relayed?
`message_start` forwarded? browser subscribed at the instant of relay? Only
after the verdict is recorded does a second fix land. Rejected: assuming the ack
leg — retracted above.

**D3 — Ack settles the card; response arrival is a SEPARATE, retained exit.**
Per contract, `prompt_received{fresh:true}` promotes to `sent` and re-enables the
composer without waiting for the response. The existing `message_start` /
`agent_start` clears are a defence-in-depth exit and are KEPT — "response does
not settle" means the ack must not DEPEND on the response, not that the
response-adjacent clears are removed.

**D4 — The existing 30s timeout gains a visible failed status, replacing the
drop-plus-banner.** `PendingPrompt.status` gains `"failed"`; the timeout sets it
instead of `pendingPrompt: undefined`. Requires a THIRD render arm in
`ChatView.tsx:1378-1393` (today: `sending` vs else→green "sent" tick) — without
it a failed prompt would render as a green ✓. The composer gate (D1) treats
`failed` as enabled. Whether the existing `lastError` banner is also set is a
single choice made once: keep the banner OR rely on the bubble, not both, to
avoid a duplicated failure surface. Rejected: leaving today's silent drop —
it destroys the user's text.

Two consequences the timeout/reducer code forces, both mandatory:

- **The timer must not re-arm on `failed`.** `usePendingPromptTimeout` arms on
  `!!pendingPrompt` (`App.tsx:1097`) and its handler clears the prompt
  (`App.tsx:1102-1106`). Left alone, a `failed` bubble is wiped ~30s later —
  reinstating the drop-plus-banner D4 replaces and breaking contract scenario 2.
  The arming predicate must be `status === "sending"`.
- **`applyPromptReceived` must treat `failed` as terminal.** The idempotency
  guard at `event-reducer.ts:225` covers only `sent`; a late `fresh:true` ack
  would promote a `failed` prompt to `sent`. Extend the guard so any settled
  status is a no-op.

With the arming fix, the structurally-unackable card quick-send path
(`handleSendPromptToSession`) still satisfies contract scenario 2: its only
settlement is the timeout, which now lands on a visible, persistent `failed`
bubble instead of a silent drop.

**D5 — Reset/replay must not resurrect `sending`; `sent` carry is PRESERVED.**
The carry sites (`useMessageHandler.ts:398-400, 669-671`;
`useSessionState.ts:71-72, 103`) exist on purpose
(`preserve-pending-prompt-across-replay`). The narrow rule matching the
contract: a carried prompt SHALL NOT be restored in `sending`; `sent`/`failed`
carry as-is. Blanket "never carry" is rejected — it regresses the whole prior
change.

**Explicit, deliberate narrowing of the prior change.** The existing carry tests
assert a `sending` prompt survives the reset
(`use-message-handler-pending-prompt.test.ts:100,:122`,
`useSessionState.test.ts:55,:143`). Those exact assertions MUST flip — the new
spec forbids what they lock in. This is a scoped amendment, not an accident:
the `sent`-carry behaviour (the point of `preserve-pending-prompt-across-replay`)
is preserved and must keep its own coverage. Any claim that all prior carry
tests stay green is false; update the `sending` cases and add a `sent`-carry
case in the same commit.

**D6 — Acceptance must prove the ACK settled it, not the timeout.** The E2E
assertion is that the bubble reaches `sent` (and the composer re-enables) within
a window far below `TIMEOUT_MS` — a few seconds, not 30. A timeout-driven pass
is deterministic, so "run it 3×" cannot detect the band-aid; the fast-settle
assertion can. `failed` must never appear in a green faux run.

**D7 — Tests before fix.** Unit tests for D1/D4/D5 are written first and must go
red on today's code; the faux E2E specs are the acceptance gate.

## Risks / Trade-offs

- **Shipping the timeout as the de facto fix** → D6's fast-settle assertion is
  the structural guard; without it the acceptance gate cannot distinguish a real
  fix from a 30s band-aid.
- **D5 implemented as "never carry"** → regresses
  `preserve-pending-prompt-across-replay` and breaks 2 existing test files; the
  narrow `sending`-only rule and those tests staying green are the guard.
- **Adding `failed` without the ChatView arm** → failure renders as success;
  D4 makes the render arm a required part of the change.
- **Root cause turns out server-side** (subscriber-set timing in
  `sendToSubscribers`) → fix lands in `packages/server/`; proposal scope allows.
- **Harness tests stale code** → always rebuild per
  `run-dashboard-e2e-local-changes`.
- **E2E still red for a third independent fault** → time-box, document, split
  out (as `fix-bridge-stale-ctx-crash` did for this one).

## Migration Plan

Client-side (possibly server-side) behaviour change; no data migration.
Local: client → `npm run build` + `POST /api/restart`; server → `POST
/api/restart`. E2E: rebuild the docker harness image from LOCAL code
(`docker/test-up.sh` per `run-dashboard-e2e-local-changes`) — a cached image
invalidates the acceptance gate. Rollback = revert the commit.

## Open Questions

- Is the browser in `sendToSubscribers`' subscriber set for a freshly spawned
  session at the instant the ack is relayed?
- Which legs actually fail in the harness — ack only, or ack + `message_start`?

Resolved at planning time (user decision, folded into `test-plan.md`):

- Failed-state surface: failed bubble **and** the retained `lastError` banner —
  two surfaces, deliberately; M1 manually checks they read as one failure.
- D6 fast-settle window: **15s** (half of `TIMEOUT_MS` 30s).
