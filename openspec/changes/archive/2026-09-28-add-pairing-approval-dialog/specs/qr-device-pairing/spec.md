## MODIFIED Requirements

### Requirement: Compare-code approval; code consumed on approval, not redemption
Redeeming a valid code SHALL create a PENDING device whose token is unusable until
approval. The pairing code SHALL be consumed only on **approval** or on an
operator **deny**, never on redemption, so a premature redemption cannot lock out
the legitimate device. The
trust decision SHALL rely on a **server-generated numeric confirmation code shown
on BOTH the dashboard and the pairing device** for compare-and-match — NOT on any
client-supplied device label. The approval action SHALL require a genuine
authenticated browser session and SHALL NOT honor any loopback/tunnel exemption.
A pairing payload SHALL permit at most ONE active pending device at a time
(further redemptions overwrite the slot or are hard rate-limited), bounding memory
and approval-prompt flooding. The confirmation code SHALL have enough entropy to
resist brute-force within its short validity window. Approval SHALL be ACTIVE: the
user TYPES the code shown on the physical device into the dashboard. The dashboard
MAY push a prompt announcing the pending device, but that prompt SHALL NOT display
the confirmation code and SHALL NOT offer a one-click approve. Repeated invalid
approvals SHALL be rate-limited and locked out. The budget SHALL belong to one
pending device (a re-redemption creates a new pending device with a new
confirmation code and its own budget) and SHALL be shared by every approval entry
point for that pending device. Approval SHALL be rejected
if the pairing code has expired, and this check SHALL hold independently of any
lazy sweep, so the server remains the sole authority on code validity even when no
`poll`/mint has run.

#### Scenario: Premature redemption does not lock out the user
- **WHEN** an attacker redeems a shoulder-surfed code before the intended device AND the operator has not denied that request
- **THEN** the code is NOT consumed and the legitimate device can still redeem and be approved

#### Scenario: Deny ends the code for every device
- **WHEN** the operator denies a pending device
- **THEN** the code SHALL be consumed and no device, including a later legitimate one, SHALL be able to redeem it

#### Scenario: Spoofed label cannot be mistaken for the real device
- **WHEN** the user approves a pending device
- **THEN** approval requires matching the numeric confirmation code shown on the real device, so an attacker's chosen label cannot impersonate it

#### Scenario: Approval cannot be self-satisfied via a bypass
- **WHEN** an approval is attempted without a genuine authenticated browser session (e.g. via a loopback/tunnel path)
- **THEN** the approval SHALL be rejected

#### Scenario: Redemption flood cannot exhaust the server
- **WHEN** an attacker replays a QR payload to redeem many times
- **THEN** at most one pending device exists per payload and further attempts are rate-limited, so memory and approval prompts stay bounded

#### Scenario: Active typed approval defeats blind-approve
- **WHEN** the user approves a device, including from a pushed approval prompt
- **THEN** they must type the code displayed on the physical pairing device, so a passively-pushed attacker request cannot be approved by habituated clicking
- **AND** the pushed prompt SHALL NOT contain the confirmation code

#### Scenario: Approval of an expired code rejected
- **WHEN** the operator submits the correct confirmation code after the pairing code has expired
- **THEN** the server SHALL reject the approval with an expired error and pair no device
- **AND** the rejection SHALL hold even if no intervening sweep has removed the entry

#### Scenario: Lockout budget shared across entry points
- **WHEN** the operator submits wrong confirmation codes for one pending device through both the Gateway view and the approval dialog
- **THEN** the attempts SHALL count against one budget and the device SHALL be locked out once that budget is exhausted

### Requirement: Operator approval via typed compare-code in the web client
The web client SHALL implement the D12 active-typed approval: when a device
redeems a code and becomes PENDING, the client SHALL present the pending device
and a field for the operator to TYPE the numeric confirmation code displayed on
the physical device. Approval SHALL NOT be a one-click accept of a pushed prompt.
The approval control SHALL exist in two places only: the Gateway pairing view
(approving by pairing code) and the app-wide pairing approval dialog (approving by
pending-request identifier). Both SHALL be shown only to operator browsers.

#### Scenario: Correct confirm code approves the device
- **WHEN** the operator types the confirmation code shown on the pairing device AND submits
- **THEN** the client SHALL submit the approval with that confirm code
- **AND** on success the device SHALL move into the paired-devices list

#### Scenario: Wrong confirm code rejected
- **WHEN** the operator types a non-matching confirmation code
- **THEN** the approval SHALL fail and the view SHALL show an error without pairing the device

#### Scenario: Advisory countdown does not gate approval
- **WHEN** the operator-view TTL countdown reaches zero
- **THEN** the Approve control SHALL remain usable
- **AND** submitting SHALL defer the validity decision to the server, which pairs the device when the code is still valid or returns an expired error when it has lapsed

## ADDED Requirements

### Requirement: App-wide pairing approval dialog
When a device redeems a pairing code, every connected operator browser SHALL
raise a modal approval dialog regardless of the page it shows, within one
WebSocket round-trip — except while another operator decision dialog (an
access-grant prompt) is open, in which case the approval dialog SHALL open as soon
as that dialog closes. The dialog SHALL show the requesting device's browser and
operating system (derived from its User-Agent), the host it arrived through, its
remote address, and how long ago it asked. It SHALL offer a field for the typed
confirmation code, an optional device-name field prefilled from the User-Agent,
a statement of the access that approval grants, an "Approve device" action and a
"Deny" action. Initial focus SHALL be on the confirmation-code field. Closing the
dialog SHALL leave the request pending. At most one approval dialog SHALL be shown
at a time; further pending requests SHALL be indicated as a count. When a request
is resolved elsewhere (another tab or operator, expiry), an open dialog for it
SHALL close and tell the operator it was handled elsewhere.

#### Scenario: Redeem raises the dialog on any page
- **WHEN** a device redeems a valid pairing code while an operator browser shows any dashboard page
- **THEN** that browser SHALL show the approval dialog for the pending device
- **AND** the dialog SHALL NOT display the confirmation code

#### Scenario: Paired-device browser never sees the dialog
- **WHEN** a device redeems a pairing code while a browser authenticated only by a paired-device token is connected
- **THEN** that browser SHALL NOT show the dialog and SHALL NOT receive the pending device's User-Agent, host or address

#### Scenario: Short code rejected on submit, not while typing
- **WHEN** the operator submits fewer than 8 digits
- **THEN** the dialog SHALL show "Enter all 8 digits" at the field and send no approval
- **AND** the Approve action SHALL NOT have been disabled while typing

#### Scenario: Wrong code shows remaining attempts
- **WHEN** the operator submits a non-matching code with attempts remaining
- **THEN** the dialog SHALL keep the typed value, mark the field invalid with text (not colour alone), and state how many attempts are left after this failure (4 after the first of 5)

#### Scenario: Lockout ends the request in the dialog
- **WHEN** the attempt budget is exhausted
- **THEN** the dialog SHALL replace the form with a "request blocked" message and offer only Close

#### Scenario: Closing keeps the request reviewable
- **WHEN** the operator closes the dialog without answering
- **THEN** the request SHALL stay pending until it expires
- **AND** the Gateway pairing view SHALL list it with a Review action that reopens the dialog

#### Scenario: Handled elsewhere closes the dialog
- **WHEN** a request whose dialog is open is approved, denied or expires through another browser or tab
- **THEN** the open dialog SHALL close and a notice SHALL say it was handled in another window

#### Scenario: Queue shows one dialog at a time
- **WHEN** two devices are pending
- **THEN** one dialog SHALL be shown with a "+1 more waiting" indicator and the next SHALL open after the first is resolved or closed

### Requirement: Operator can deny a pending device
An operator SHALL be able to deny a pending device. Denial SHALL require the same
operator authentication as approval and SHALL refuse a paired-device credential.
A denied device SHALL receive no token, its pairing code SHALL become unusable,
and the device's next status check SHALL report `rejected`. The browser pairing
landing and the native shell SHALL show that the dashboard declined the device and
that a new pairing link is needed.

#### Scenario: Deny rejects the device
- **WHEN** the operator denies a pending device
- **THEN** the device's status check SHALL return `rejected` and no token SHALL ever be issued for it

#### Scenario: Denied code cannot be redeemed again
- **WHEN** a pairing link whose pending device was denied is opened again
- **THEN** redemption SHALL be refused

#### Scenario: Device shows the decline
- **WHEN** the device landing receives `rejected`
- **THEN** it SHALL show "The dashboard declined this device" and SHALL NOT offer to retry the same link

#### Scenario: Paired device cannot deny
- **WHEN** a deny is submitted with only a paired-device credential
- **THEN** it SHALL be refused and the pending device SHALL be unchanged

### Requirement: Pending-request feed for operators
The server SHALL record, for each pending device, the redeemer's User-Agent, the
host it arrived through, its remote address, any proxy-reported client address
and the redemption time, each bounded in length. It SHALL expose the list of
pending devices (identifier, that metadata, expiry, attempts remaining) only to
operator callers, and SHALL notify connected browsers that the pending set changed
using a message that carries no request detail. Approval by pending-request
identifier SHALL be available to operator callers only. Redeemer metadata SHALL be
treated as untrusted display text: it SHALL NOT affect any authorization decision
and SHALL NOT be written to logs. Pairing codes and confirmation codes SHALL NOT be
included in the list, the notification, or logs.

#### Scenario: Change notification carries no detail
- **WHEN** a pending device is added, approved, denied, locked out or expires
- **THEN** connected browsers SHALL receive a change notification containing no identifier, address, User-Agent or code

#### Scenario: Pending list is operator-only
- **WHEN** the pending list is requested with only a paired-device credential or from an unauthenticated remote caller
- **THEN** the request SHALL be refused

#### Scenario: Expiry is announced without other traffic
- **WHEN** a pending device reaches its expiry while no other pairing request arrives
- **THEN** connected browsers SHALL receive the change notification and an open dialog for it SHALL close

#### Scenario: Approval label is bounded
- **WHEN** the operator approves from the dialog with a device name that is not a string or is outside 1..64 bytes of UTF-8 after trimming
- **THEN** the approval SHALL be rejected with a validation error and no device SHALL be paired

#### Scenario: Oversized metadata is bounded
- **WHEN** a device redeems with a User-Agent longer than 256 characters
- **THEN** the stored and listed value SHALL be truncated to at most 256 characters

#### Scenario: Reconnecting operator catches up
- **WHEN** an operator browser reconnects while a device is pending
- **THEN** it SHALL fetch the pending list and show the dialog without waiting for a new notification
