# Pairing approval dialog — UI plan

Surface: app-wide operator dialog raised when a device opens a valid pairing
link (`/pair#pi:pair:v1.…`) and redeems it. Device-side: `/pair` landing gains a
"Rejected" state. Mockup: `mockups/pairing-approval/index.html`.

## Why a dialog (and why it stays typed)

Today the operator only learns a device is waiting if the Gateway ▸ Connect a
device panel happens to be open. The device sits on "Type this code on the
dashboard…" with no signal on the operator side. The dialog closes that gap.

The D12 invariant stays: approval = TYPE the 8-digit code shown on the device.
The dialog never shows the code and has no one-click accept. The pushed prompt
only says "someone is waiting"; the proof still has to come from the physical
device screen. This is the delta against `qr-device-pairing` ("approval control
SHALL exist on that surface only" → now also the app-wide dialog).

## Grounding

| Element | Source in code | Reused |
|---|---|---|
| Dialog shell | `packages/client-utils/src/Dialog.tsx` | `size="md"` (`max-w-md`), `p-5 space-y-4`, `bg-[var(--bg-primary)] border-[var(--border-primary)] rounded-lg shadow-xl`, overlay `bg-black/60`, close `w-7 h-7` top-right, icon tile `w-9 h-9 bg-[var(--accent-primary)]/15` |
| Host pattern | `access-grant/GrantPromptHost.tsx` | app-wide mount, one dialog at a time + "N more waiting", WS frames, reconcile via GET on (re)connect, dismiss frame when answered elsewhere |
| Buttons | `Dialog.Action` intents | `primary` (`--accent-primary` fill, white) for Approve; `neutral` for Deny |
| Messages | `--severity-{error,warning,success,info}-{bg,fg,border}` | inline field error, lockout, expired, success |

## States (operator dialog)

| ID | State | Trigger | Content |
|---|---|---|---|
| D1 | Incoming | `pair_pending` frame | device (browser + OS from UA), via host, IP, "just now"; code field; name field (prefilled); consequence line; Deny / Approve device |
| D2 | Wrong code | approve → `mismatch` | inline error at field + attempts left; input kept |
| D3 | Locked out | approve → `locked_out` | error block replaces the form; only Close |
| D4 | Expired | countdown 0 → server `expired` on submit | warning block; Close; "open a new link on the device" |
| D5 | Approved | approve ok | success block, device name, link to Paired devices; auto-close after 4 s |
| D6 | Handled elsewhere | `pair_dismiss` frame (other tab/operator answered) | dialog closes; toast "Handled in another window" |
| D7 | Queue | 2+ pending | header chip "+1 more waiting"; next opens after this one resolves |

Device side (`/pair`): P1 waiting (existing), P2 approved (existing), **P3 rejected (new)** → "The dashboard declined this device." + no retry button (a new link is required).

## UX decisions (each cites a public rule)

1. **Modal, not toast** — the operator must decide before the device can continue. NN/g modal-nonmodal: modal only when the user must focus/decide. Pairing is exactly that; a toast would auto-dismiss a security decision (Material snackbar rule: never auto-dismiss critical).
2. **Typed code, never shown** — Nielsen H5 error prevention + D12. The dialog cannot approve without evidence from the other screen, so an attacker who opens a stolen link cannot be approved by a reflexive click.
3. **One primary action** — "Approve device" is the only filled button; Deny is neutral (rubric #6, Von Restorff). Deny is not red: denying is safe and reversible (device can open a new link), so it gets no danger styling and no confirm (NN/g: prefer undo over confirm; confirm only destructive/irreversible).
4. **Verb labels** — "Approve device" / "Deny" not "OK/Cancel" (rubric #15; NN/g ui-copy).
5. **Label above field, hint up front** — "Code shown on the device" + "8 digits" stated before input (rubric #13, GOV.UK). `inputmode="numeric"`, `autocomplete="off"`, monospace, grouped `1234 5678` display (chunking — Miller's law).
6. **Validate on submit, not per keystroke** — Approve stays enabled; submitting < 8 digits shows "Enter all 8 digits" at the field (rubric #16; NN/g: disabled buttons hide the reason).
7. **Error says what + how** — "That code doesn't match the device. Check the device screen and retype it. 3 attempts left." Icon + text + border, not colour only (rubric #4, #18; WCAG 1.4.1).
8. **Consequence before buttons** — "Approving gives this browser full control of the dashboard (operate)." Same slot as `grant-dialog-consequence` (H4 consistency; H1 visibility).
9. **Context to judge the request** — browser/OS, via host, IP, time. H1 visibility of system status; lets the operator reject a request that is not theirs ("I'm not on Windows right now").
10. **Name field optional, prefilled** — "(optional)" marks the minority class (rubric: mark optional); prefill = recognition over recall (H6).
11. **Close = decide later** — footer note tells where it went ("Pending in Settings ▸ Gateway"). H3 user control; the request is not lost by an accidental Esc.
12. **Countdown advisory only** — "Expires in 4:32" never disables Approve (existing spec scenario "Advisory countdown does not gate approval").
13. **Initial focus = code field** — the one thing to do next (APG dialog: focus the first interactive element needed for the task). Not the Approve button, so Enter can't approve an empty form.
14. **Success auto-closes after 4 s** with the result visible first — H1 feedback; toast-length timing (~4–6 s) for non-critical confirmation.

## Tokens used (no raw hex)

`--bg-primary`, `--bg-secondary`, `--bg-tertiary`, `--bg-surface`, `--border-primary`, `--border-secondary`, `--text-primary`, `--text-secondary`, `--text-tertiary`, `--accent-primary`, `--accent`, `--focus-ring`, `--severity-{error,warning,success,info}-{bg,fg,border}`. No new tokens needed.

## Server/protocol deltas the UI depends on (for design.md)

- `redeem()` captures `userAgent`, `remoteIp`, `viaHost` on the pending entry.
- WS → operator browsers only (session / local; never paired-device bearers): `pair_pending {pendingId, device:{ua,browser,os}, viaHost, ip, createdAt, expiresAt}`, `pair_dismiss {pendingId, reason: approved|denied|expired}`.
- `GET /api/pair/pending` (reconcile on reconnect), `POST /api/pair/approve-pending {pendingId, confirmCode, label?}` (the dialog does not hold the one-time code), `POST /api/pair/deny {pendingId}`.
- `poll()` → `{status:"rejected"}` after deny; `/pair` renders P3.

## Review (score_mockup, 375 / 768 / 1440, dark + light)

Round 1 defects → fixed:
- Footer wrapped at 1440 (Approve dropped to 2nd row) → note moved to its own full-width row above buttons. (rubric #6 hierarchy, severity 2)
- Buttons 36px on mobile → `min-height:44px` + full-width buttons under 640px. (rubric #2 target size, severity 3)
- `0000 0000` placeholder read as an entered value → removed; format lives in the hint above the field. (rubric #13, GOV.UK: no placeholder hints; severity 2)

Round 2: every rubric line passes in both themes at all widths. Console not captured by the scorer.
