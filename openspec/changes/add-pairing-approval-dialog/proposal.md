## Why

When a device opens a pairing link and redeems it, the operator is not told.
The device shows "Type this code on the dashboard…", but the dashboard only
offers the approval field inside Settings ▸ Gateway ▸ Connect a device — and
only for the code minted in that same open panel. An operator on any other page
(or in another tab) never learns a device is waiting, and the request silently
expires. There is also no way to refuse a request: a pending device can only
time out.

## What Changes

- **Operator approval dialog, app-wide.** When a device redeems a pairing code,
  every operator browser (login session or genuine-local) raises a modal
  "A device wants to connect" dialog on whatever page it shows. The dialog shows
  device context (browser + OS from User-Agent, host it arrived via, remote IP,
  age) and asks the operator to **type** the 8-digit code shown on the device.
  The dialog never displays the code — D12 typed compare-and-match is unchanged.
- **Deny.** New operator action rejects a pending device immediately. The device
  landing (`/pair`) and the Electron shell `PairView` show "The dashboard
  declined this device" instead of waiting for expiry.
- **Optional device name on approval**, prefilled from the User-Agent
  (e.g. "Chrome on Windows"); the new approve route enforces the 1..64-byte
  UTF-8 label bound used by direct token issuance (the existing by-code approve
  route does not bound it today; that belongs to `harden-server-request-surfaces`).
- **Pushed expiry.** A per-request timer expires pending devices on time (today
  expiry is lazy, so an idle server never notices), so dialogs close and the
  device stops waiting.
- **Pending-request feed.** Server keeps redeemer metadata on the pending entry,
  broadcasts a content-free `pair_pending_changed` hint on every pending
  add/resolve, and exposes operator-only `GET /api/pair/pending`,
  `POST /api/pair/approve-pending`, `POST /api/pair/deny`. Paired-device
  browsers receive the hint but are refused the details, so they never see the
  dialog.
- **Decide later.** Closing the dialog keeps the request pending; the Gateway
  Connect-a-device panel lists waiting requests with a "Review" action that
  reopens the dialog.
- `poll()` gains a `rejected` status. Existing `POST /api/pair/approve` (by
  code) is unchanged; no **BREAKING** change for existing clients — an old
  device client that does not know `rejected` treats it like `unknown`.

UX plan and live mockup: `mockups/ui-plan.md`, `mockups/pairing-approval/`.

## Capabilities

### New Capabilities
<!-- none: the behaviour extends the existing pairing capability -->

### Modified Capabilities
- `qr-device-pairing`: typed approval may be requested through an app-wide
  pushed dialog (approval still typed, still operator-only); adds deny with a
  device-visible `rejected` outcome, redeemer metadata, an operator-only
  pending-request list, and approve-by-pendingId.

## Discipline Skills

- `security-hardening` — new operator-only routes over an auth boundary
  (paired-device bearer must be refused), untrusted User-Agent / forwarded-IP
  rendered to the operator, deny as a state-changing action.
- `observability-instrumentation` — new endpoints + WS frame: log pending
  add/approve/deny/expire outcomes without the confirm code or pairing code.
- `doubt-driven-review` — relaxes the "approval control on the Gateway surface
  only" requirement; review before it stands.
- `review-code` — before commit.

## Impact

- **Server:** `packages/server/src/pairing/pairing.ts` (metadata on
  `PendingDevice`, `listPending`, `approvePending`, `deny`, `rejected` poll
  status, change listener), `packages/server/src/routes/pairing-routes.ts`
  (3 routes behind the existing `operatorGuard`; redeem captures headers),
  `packages/server/src/pairing/browser-gateway.ts` (frame class for the hint),
  `packages/shared/src/protocol.ts` (`pair_pending_changed` frame).
- **Client:** new `components/pairing-approval/` (dialog + app-wide host
  mounted beside `GrantPromptHost`), `lib/pairing/pairing-api.ts`,
  `Gateway/GatewayPairQR.tsx` (waiting-requests list), `PairLanding.tsx`
  (rejected state). **Shell:** `packages/shell/src/components/PairView.tsx`.
- **Compatibility:** additive routes and frame; old clients ignore the frame.
  Rollback = revert; pending entries are in-memory only, no migration.
