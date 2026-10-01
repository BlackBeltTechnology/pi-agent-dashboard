## Context

See proposal.md — Why. Current state that shapes the approach:

- `PairingManager` (`packages/server/src/pairing/pairing.ts`) holds codes in
  memory; each code has at most one `PendingDevice {pendingId, confirmCode,
  label, approveAttempts, issuedToken}`. `approve(code, confirm, label?)` is the
  only approval path; callers must know the one-time **code**.
- `/api/pair/approve` is behind `operatorGuard` (login session /
  `X-Pi-Local-Token` / genuine-local + host admission; paired-device bearer
  refused). `/redeem` and `/poll` are public.
- Browser WS sockets do not record how they authenticated (tickets are
  scope-bound, not principal-bound). The access-grant dialog broadcasts
  `grant_request` with `browserGateway.broadcastToAll`.
- UX contract: `mockups/ui-plan.md` (states D1–D7, P3; cited rules).

## Goals / Non-Goals

**Goals:** operator notified within one WS round-trip of a redeem; approve or
deny from any page; device learns a deny immediately; zero pending-request
detail (UA, IP, host) ever reaches a non-operator socket.

**Non-Goals:** OS/desktop notifications, sounds, a tier picker in the dialog
(approval keeps today's default tier), persisting pending requests across
server restart, changing the Electron shell beyond the rejected state.

## Decisions

### D1 — Content-free hint + operator-guarded fetch (not operator-only sockets)
Server broadcasts `{type:"pair_pending_changed"}` (no fields) to all browser
sockets on every pending add / approve / deny / expire / lockout. Each client
host then calls `GET /api/pair/pending` behind the existing `operatorGuard`.
A paired-device browser gets 401/403 and renders nothing.

*Alternative:* tag each WS connection with its principal at ticket mint and
send full `pair_pending` frames to operator sockets only. Rejected: new
security-relevant plumbing through ticket store + gateway; one mistake leaks
redeemer IP/UA to every paired device. D1 reuses the one guard already
reviewed for approval, and the hint itself leaks only "something changed".

Frame class: `state`, key `pair_pending` — coalescing, never shed (a shed hint
is a dialog that never appears; same rule as `grant_request`).

### D2 — Approve by `pendingId`, same attempt budget
`POST /api/pair/approve-pending {pendingId, confirmCode, label?}` resolves the
entry by pendingId and delegates to the existing `approve()` logic, so the
typed compare, `MAX_APPROVE_ATTEMPTS` lockout, expiry check, label bound and
default tier are shared, not reimplemented. The dialog never holds the code.
`/api/pair/approve` (by code) stays for the Gateway panel.

`approve()` does NOT bound the label today (only the direct token-mint route
validates; bounding `/api/pair/approve` belongs to
`harden-server-request-surfaces`). The new route therefore validates `label`
itself before delegating: absent → keep pending label; non-string or outside
1..64 UTF-8 bytes after trim → `400`, nothing approved (reuses
`MAX_DEVICE_LABEL_BYTES`).

On `mismatch`, `approve()` additionally returns `attemptsLeft`, computed AFTER
this failure is counted (`MAX_APPROVE_ATTEMPTS − approveAttempts` post-increment:
4 after the first of 5). Additive field: the existing
`/api/pair/approve` response gains it too, no caller breaks.

### D3 — Deny consumes the code
All three new routes — `GET /api/pair/pending`, `POST /api/pair/approve-pending`,
`POST /api/pair/deny` — use `preHandler: operatorGuard` (never `networkGuard`,
which admits a paired-device bearer).

`POST /api/pair/deny {pendingId}` marks the pending entry `rejected` and makes
the one-time code unusable. `poll(pendingId)` returns `{status:"rejected"}`
until the entry's normal expiry sweep. A denied link cannot be re-redeemed —
the device needs a new link (matches P3 copy).

*Trade-off:* without a deny, today's guarantee holds — a legitimate device
that redeems after an attacker overwrites the single pending slot and can still
be approved. Once the operator DENIES, the code is dead and the legitimate device
needs a new link. Acceptable: the operator is present and just rejected an
unexpected device; keeping a denied code live would let the attacker redeem
again. The spec's premature-redemption scenario states this boundary.

Deny is idempotent; denying an unknown/resolved pendingId → `404 no_pending`.

### D4 — Redeemer metadata is untrusted display text
`redeem` stores on the pending entry: `userAgent` (header, trimmed to 256
chars), `viaHost` (Host header, trimmed to 253), `remoteAddress`
(`request.ip`), `forwardedFor` (first `X-Forwarded-For` hop, trimmed to 64,
only when present), `createdAt`. All are attacker-controlled: rendered as React
text only (no HTML, no links), never used for any decision, never logged (not
even partially — see D7). Client derives "Chrome 140 on Windows" with a small local UA parser
(no dependency) and falls back to "Unknown browser". The dialog labels a
forwarded address as "reported by proxy". The same parse prefills the name
field.

### D4b — Expiry is pushed, not lazy
`sweep()` only runs inside `createPayload`/`redeem`/`poll`, so an idle server
never notices a pending request expire. On every pending add (and on the
redeem-time TTL restart) `PairingManager` arms one `setTimeout(…).unref()`
at `expiresAt + 50ms` that sweeps and emits the change notification. The timer
is cleared on approve/deny/overwrite and on manager dispose, so tests and
shutdown do not leak handles. This makes the "expires elsewhere" dialog close
(D6 state) and the `expired` log line real.

### D5 — Client host mirrors `GrantPromptHost`
`PairingApprovalHost` mounts in both `App` returns next to `GrantPromptHost`.
It refetches `GET /api/pair/pending` on mount, on every (re)connect, and on each
`pair_pending_changed`. It shows one dialog at a time (oldest first) with a
"+N more waiting" chip. Closing adds the pendingId to a per-tab "dismissed"
set; the Gateway "Waiting devices" list's **Review** removes it again. When
the open pendingId disappears from the list without this tab answering, the
dialog closes with a "handled in another window" toast. Only one modal shows
at a time: when a grant dialog is open, the pairing dialog waits until it
closes (a grant prompt holds a live request). Waiting is NOT dismissal: a
held-back request never enters the dismissed set and opens as soon as the grant
dialog closes.

A browser holding a paired-device bearer (`getDeviceBearer()` set) skips the
fetch entirely — it would only get a 403. It still receives the content-free
hint; the residual leak is "some pairing state changed", accepted in D1.

### D6 — Outcome mapping
Server `approve` results → dialog states: `ok`→D5, `mismatch`→D2 (attempts
left = `MAX_APPROVE_ATTEMPTS − approveAttempts`, returned in the error body),
`locked_out`→D3, `expired`→D4, `no_pending`→D6. Validation < 8 digits is
client-side on submit only (never disables Approve).

### D7 — Observability
One log line per transition, prefix `[pairing]`:
`pending id=<pendingId first 8>`, `approved id=… device=<id>`,
`denied id=…`, `mismatch id=… left=N`, `locked_out id=…`, `expired id=…`.
Never the pairing code, confirm code, token, or ANY redeemer metadata (UA, IP,
forwarded address, host) — all attacker-controlled, and a CR/LF in a header
would forge log lines.

### D8 — Lockout budget stays per pending device
Re-redemption replaces the pending device with a NEW confirmation code and a
fresh `approveAttempts`. This is kept deliberately: approval is operator-only
(`operatorGuard`), so no remote party can submit guesses, and a per-CODE budget
would let an attacker's pending request burn the legitimate device's attempts
(operator types wrong codes against the attacker's screen → legit device locked
out). Redemption itself stays capped by `MAX_REDEEM_ATTEMPTS`. The redeem-time
TTL restart (existing behaviour) is likewise harmless to brute force for the same
reason — a longer window only gives the operator more time.

## Risks / Trade-offs

- [Dialog fatigue → reflexive approval] → approval still needs the typed code
  from the physical device; Deny is one click, Approve is not.
- [Redemption flood raises many dialogs] → one pending per code; codes are only
  minted by an operator; `/redeem` is already rate-limited. The queue shows one
  dialog at a time.
- [Late re-redeem kills an in-flight device] (existing behaviour, unchanged) →
  a second redeem of the same link overwrites the single pending slot; the first
  device's poll returns `unknown` and it must reopen the link. The dialog makes
  this visible: the old request closes as handled elsewhere and a new one opens
  showing the second device's browser/IP.
- [Two operators answer at once] → server first-wins; the loser sees
  `no_pending` → D6 toast.
- [Old device client sees `rejected`] → shell and `/pair` treat unknown statuses
  as terminal "expired or rejected" today; updated clients show P3.
- [Hint arrives before the redeem finished committing] → the hint is emitted
  after the pending entry is stored; the fetch re-reads state.

## Migration Plan

Additive routes, frame and poll status; pending state is in memory. Deploy =
server restart + client build. Rollback = revert the commit; nothing persisted.
