# qr-device-pairing — delta

## MODIFIED Requirements

### Requirement: Compare-code approval; code consumed on approval, not redemption
Redeeming a valid code SHALL create a PENDING device whose token is unusable until
approval. The pairing code SHALL be consumed only on **approval** or on an
operator **deny**, never on redemption, so a premature redemption cannot lock out
the legitimate device. The
trust decision SHALL rely on a **server-generated numeric confirmation code shown
on BOTH the dashboard and the pairing device** for compare-and-match — NOT on any
client-supplied device label. The approval action (`POST /api/pair/approve`, `POST /api/pair/approve-pending`)
SHALL require an operator proof — a dashboard login session, a valid local-proof
cookie (see `trust-and-credential-boundaries`), or a verified local credential
presented as `X-Pi-Local-Proof` (and, only while the legacy window named by
`local-ipc-allowlist-token` remains open, a valid `X-Pi-Local-Token`) —
and SHALL NOT honor a bare loopback/tunnel exemption in any mode, regardless of
`requireLocalProof`. A paired-device bearer SHALL never approve.
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

A refusal of an approval action for want of an operator credential SHALL answer
401 with a body whose `error` is `operator credential required` and which also
carries a `reason` and an ordered, duplicate-free `remedies` array. `reason` SHALL
be `device-credential` when the caller presented a paired-device credential and
`no-credential` otherwise. For `device-credential` the `remedies` array SHALL be
empty. For `no-credential` the array SHALL be drawn from the values
`authorize-browser`, `approve-on-host` and `sign-in`, in that relative order,
where:
- `authorize-browser` SHALL be present exactly when the refused request is
  genuinely local by the TRANSPORT test alone — loopback peer and no proxy
  forwarding header — and presented no local proof, AND the request's `Host`
  header satisfies the same origin rule the launcher applies to a named origin
  (host `localhost` or a loopback address, port — explicit or the scheme default —
  equal to the server's configured port), evaluated by one shared definition so
  the dashboard never offers a launcher command the launcher would refuse. This
  test SHALL NOT itself require local proof, in either `requireLocalProof` mode,
  so the caller who needs the remedy is the caller who is offered it;
- `approve-on-host` SHALL always be present;
- `sign-in` SHALL be present exactly when a usable login method is configured at
  the time of the refusal, by the same rule `operate-required-remedy` applies.

`reason` and `remedies` SHALL be attached only when the refused request's `Host`
is admitted by the same host-admission check, with the same options, that the
approval action applies to admitted callers. When the `Host` is not admitted, the
refusal SHALL keep its status and SHALL carry exactly the keys `success` and
`error` — whichever host-gate mode is in force — so that no caller whose Host is
not admitted learns its network position or whether a login method exists. Which
check runs first, and which callers are admitted, SHALL NOT change.

When attached, the body SHALL contain only the keys `success`, `error`, `reason` and `remedies`,
and SHALL disclose nothing beyond the caller's own network position and the
existence of a login method — in particular no pending-request identifier, device
label, host name, address, or pairing state. Clients SHALL ignore `remedies`
values they do not recognise, and a body without `reason`/`remedies` SHALL remain
valid for older servers. Which callers are admitted SHALL NOT change.

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

#### Scenario: Bare loopback cannot approve
- **WHEN** an approval request arrives from `127.0.0.1` with no forwarding header, no login session, no local-proof cookie, and no local token, with `requireLocalProof` disabled
- **THEN** the approval SHALL be rejected with 401 and the pending device SHALL stay pending

#### Scenario: Bare loopback refusal names the remedies
- **WHEN** that same bare-loopback approval is refused and no login method is configured
- **THEN** the body SHALL carry `reason` `no-credential` and `remedies` exactly `["authorize-browser", "approve-on-host"]`

#### Scenario: Local request on a non-configured origin is not offered authorize-browser
- **GIVEN** the server's configured port is `8000`
- **WHEN** a bare-loopback approval request with no proof arrives with `Host: localhost:9000` (e.g. through an SSH local port forward) and no login method is configured
- **THEN** the body SHALL carry `reason` `no-credential` and `remedies` exactly `["approve-on-host"]`

#### Scenario: Remedy position test is independent of strict mode
- **GIVEN** `requireLocalProof` is `true`
- **WHEN** a bare-loopback approval request with no proof is refused
- **THEN** `remedies` SHALL still contain `authorize-browser`, because the position test is the transport test alone
- **AND** the same request under `requireLocalProof` `false` SHALL receive the same `remedies` array

#### Scenario: Remedy computation never turns a refusal into an error
- **WHEN** the accessor that reports whether a login method is configured is absent or raises
- **THEN** the response SHALL still be the 401 refusal, with `sign-in` omitted from `remedies`
- **AND** no 5xx SHALL be returned

#### Scenario: Non-admitted Host in enforce mode gets the host refusal
- **GIVEN** the host gate is in `enforce` mode
- **WHEN** a request whose `Host` header is not admitted attempts an approval without a credential
- **THEN** the host-admission refusal SHALL be returned
- **AND** the response SHALL NOT carry `reason` or `remedies`

#### Scenario: Non-admitted Host in report mode gets the legacy refusal
- **GIVEN** the host gate has been switched to `report` mode and a login method is configured
- **WHEN** a request whose `Host` header is not admitted attempts an approval without a credential
- **THEN** the response SHALL be the 401 refusal with exactly the keys `success` and `error`, `error` being `operator credential required`
- **AND** it SHALL carry neither `reason` nor `remedies`, so the caller learns nothing about whether a login method is configured

#### Scenario: Off-host refusal omits authorize-browser
- **WHEN** an approval request arrives through a tunnel host with no credential and an OAuth provider with a non-empty client id is configured
- **THEN** the body SHALL carry `reason` `no-credential` and `remedies` exactly `["approve-on-host", "sign-in"]`

#### Scenario: Device credential refusal offers no remedy
- **WHEN** a browser authenticated only by a paired-device credential attempts an approval
- **THEN** the refusal SHALL be 401 with `reason` `device-credential` and an empty `remedies` array

#### Scenario: Refusal body discloses nothing about the request or the host
- **GIVEN** a pending device labelled `robson-phone` at `192.168.16.31` and a server host name `office-mac`
- **WHEN** a credential-less caller is refused an approval
- **THEN** the body SHALL have exactly the keys `success`, `error`, `reason`, `remedies`
- **AND** no string in it SHALL contain the pending identifier, `robson-phone`, `192.168.16.31` or `office-mac`

#### Scenario: Local-proof cookie approves on an auth-off install
- **WHEN** authentication is disabled and a browser bootstrapped via the launcher presents a valid local-proof cookie with the matching confirmation code
- **THEN** the approval SHALL succeed

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

### Requirement: App-wide pairing approval dialog
When a device redeems a pairing code or an admitted knock creates a pending
device, every connected operator browser SHALL
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

The dialog SHALL state the request's provenance. For a knock it SHALL title the
request with the source address ("A device on 192.168.16.31 asks to connect"),
SHALL show a requester name only inside a requester-attributed phrase ("says it is
…"), and SHALL prefill the device-name field from the requester name when present,
else from the User-Agent. For a knock received over an unencrypted connection it
SHALL show a warning, in text and not by colour alone, that the request and the
resulting access travel unencrypted on this network. For a knock it SHALL also
offer the tier choice specified by `lan-knock-pairing` ("Operator chooses the
tier of a knock-paired device"), and its consequence statement SHALL name the
selected tier. A QR redemption SHALL keep its existing presentation.

When an approval is refused for want of an operator credential and the refusal
carries a `remedies` list, the dialog SHALL render one instructional row per
remedy it recognises, in the order received, ignoring values it does not
recognise, instead of a single explanatory sentence. The `authorize-browser` and
`approve-on-host` rows SHALL each present the exact command to run as selectable
text with a copy control; the `approve-on-host` row's command SHALL name this
request, and SHALL NOT contain the confirmation code, so the code is never placed
on the clipboard or in a shell history. Because the credential the
`authorize-browser` command obtains is bound to one origin, that command SHALL
name the origin of the page showing the dialog, so running it credentials the tab
that was refused; the dialog SHALL NOT present a command that would credential a
different origin. The launcher SHALL accept a named origin only when its scheme is
`http` or `https`, its host is `localhost` or a loopback address, and its port is
the server's configured port, and SHALL refuse any other origin before any
credential or single-use code is minted. A development client build SHALL NOT
render the `authorize-browser` row, since its origin is not the server's port. The
`sign-in` row SHALL link to the dashboard login page. Throughout, the dialog SHALL
keep the typed confirmation code, the device name, the tier selection and the
countdown, and SHALL keep "Approve device" enabled, so the operator can retry in
place while the request is still pending. A refusal without a `remedies` list — an
older server — SHALL keep rendering the existing explanatory sentence. The dialog
SHALL NOT retry an approval on its own. When a Deny is refused for want of an
operator credential, the dialog SHALL render the remedy rows of that refusal by
the same rules, SHALL keep the request open, and SHALL keep Deny available for
retry.

#### Scenario: Redeem raises the dialog on any page
- **WHEN** a device redeems a valid pairing code while an operator browser shows any dashboard page
- **THEN** that browser SHALL show the approval dialog for the pending device
- **AND** the dialog SHALL NOT display the confirmation code

#### Scenario: Knock raises the dialog with its provenance
- **WHEN** a knock from `192.168.16.31` with name `Roberts-MacBook-Pro` is admitted while an operator browser shows any dashboard page
- **THEN** that browser SHALL show the approval dialog titled with `192.168.16.31`
- **AND** the name SHALL appear only as "says it is Roberts-MacBook-Pro" and SHALL prefill the device-name field
- **AND** a tier radio group SHALL be shown with Operate preselected
- **AND** the dialog SHALL NOT display the confirmation code

#### Scenario: Unencrypted knock is labelled
- **WHEN** the dialog shows a knock received over plain http
- **THEN** it SHALL show a text warning that the request and the resulting access are unencrypted on this network

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

#### Scenario: Credential refusal lists the remedies
- **WHEN** an approval is refused with `remedies` `["authorize-browser", "approve-on-host"]`
- **THEN** the dialog SHALL show two instructional rows in that order, each with a copyable command
- **AND** the `approve-on-host` command SHALL contain this request's identifier and SHALL NOT contain the confirmation code
- **AND** the single "needs an operator credential" sentence SHALL NOT be shown

#### Scenario: Authorize-browser command names the tab's own origin
- **GIVEN** the dialog is shown in a tab whose origin is `http://127.0.0.1:8000` while the launcher's default origin is `http://localhost:8000`
- **WHEN** an approval is refused with `authorize-browser` among the remedies
- **THEN** the command shown SHALL target `http://127.0.0.1:8000`, so the credential it obtains applies to this tab

#### Scenario: Launcher refuses an origin on another port

- **WHEN** the operator runs the launcher naming `http://localhost:9999` while the server's configured port is `8000`
- **THEN** the launcher SHALL exit non-zero naming the configured port
- **AND** no single-use code SHALL have been minted and no browser SHALL be opened

#### Scenario: Retry in place after obtaining the credential
- **GIVEN** an approval was refused for want of a credential and the remedy rows are shown
- **WHEN** the operator obtains the credential and activates "Approve device" again without reopening the dialog
- **THEN** the previously typed confirmation code, device name and tier SHALL still be submitted
- **AND** on success the dialog SHALL show the paired state

#### Scenario: Refusal does not auto-retry
- **WHEN** an approval is refused for want of a credential
- **THEN** the dialog SHALL issue no further approval request until the operator activates the approve action

#### Scenario: Refused deny shows the same remedies
- **WHEN** the operator activates Deny in a tab without an operator credential and the refusal carries `remedies` `["authorize-browser", "approve-on-host"]`
- **THEN** the dialog SHALL show the same two remedy rows, SHALL keep the request open, and the request SHALL stay pending

#### Scenario: Older server keeps the sentence
- **WHEN** an approval is refused 401 with `error` `operator credential required` and no `remedies` field
- **THEN** the dialog SHALL show the existing explanatory sentence and no remedy rows

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

A refusal of a deny for want of an operator credential SHALL carry the same status
and body, by the same rules, as a refusal of an approval for want of an operator
credential (`reason`, `remedies`, and their Host-admission condition), and SHALL
leave the pending device unchanged.

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

#### Scenario: Bare loopback cannot deny
- **WHEN** a deny arrives from `127.0.0.1` with no forwarding header, no login session, no local-proof cookie and no local credential, with `requireLocalProof` disabled
- **THEN** it SHALL be refused with 401, the pending device SHALL stay pending, and its pairing code SHALL NOT be consumed
- **AND** the body SHALL carry `reason` `no-credential` and the same `remedies` an approval refusal from that request would carry

#### Scenario: Host credential can deny
- **WHEN** a deny is submitted with a verified local credential presented as `X-Pi-Local-Proof` (as the host-side terminal sends)
- **THEN** the pending device SHALL be denied

## ADDED Requirements

### Requirement: Host-side pairing approval from a terminal

The dashboard CLI SHALL offer an approval path usable from any shell that runs on
the same operating-system user and host as the server process, so a pairing can be
answered where no browser can obtain an operator credential — a headless or SSH-only host, a container, WSL, a tunnel
origin, or a browser tab that was not opened by the dashboard launcher.

The CLI SHALL provide verbs to list the pending requests, approve one, and deny
one. Listing SHALL show, per pending request, its identifier, how the request
arrived, the requesting device's self-reported description, its address and when
it expires, and SHALL NOT show the confirmation code.

Every server-supplied string the CLI prints SHALL first be rendered inert for a
terminal by REMOVING at least: C0 controls and DEL (`U+0000` to `U+001F`,
`U+007F`), C1 controls (`U+0080` to `U+009F`), bidirectional overrides and
isolates (`U+202A` to `U+202E`, `U+2066` to `U+2069`), zero-width and format
characters (`U+200B` to `U+200F`, `U+FEFF`), and the line and paragraph separators
`U+2028` and `U+2029`; and then by truncating the result to a fixed per-field
maximum length. That length SHALL be measured in Unicode code points; a truncated
value SHALL end with `…`, which SHALL count within the maximum; and truncation
SHALL NOT split a surrogate pair. The removal set SHALL be the one the server already applies to a
knock requester name, applied through a single shared definition rather than a
second one.

Approval from the CLI SHALL require the operator to supply the confirmation code
displayed on the requesting device; the CLI SHALL read it interactively by
default, and SHALL accept it as an argument only through an explicit option
documented as visible to other processes on the host. When no code option is
given and standard input is not a terminal, the CLI SHALL read the first line of
standard input as the code; end of input or an empty line SHALL end the command
with a non-zero outcome and no request sent. Before sending, the CLI SHALL remove
spaces and dashes from the supplied code, and SHALL refuse locally — non-zero, no
request sent, no attempt spent — any result that is not exactly 8 decimal digits. The confirmation code SHALL
NOT appear in any string the dashboard offers for copying. The request identifier
MAY appear in such a string, as it is not a credential. The approve verb SHALL
accept no identifier and resolve to the only pending request when exactly one
exists; with none, or with more than one, it SHALL list them and exit non-zero
rather than choose. It SHALL accept an optional
device name and, for a request that arrived as a network knock, an optional access
tier, with the same defaults the dashboard applies.

These verbs SHALL authenticate with the host-only local credential and SHALL carry
no new authority: they SHALL be refused on a host where that credential cannot be
read, and SHALL be refused — before any request is sent — when no per-request
credential can be derived from it for the server's configured address (for
example when the server is configured to bind a host name rather than an address);
they SHALL NOT send a request without a credential. They SHALL NOT create, replace or repair that credential as a side effect, and
SHALL be subject to the same per-request attempt budget, lockout,
expiry and single-use semantics as every other approval entry point. They SHALL
produce the same server-side audit record as an approval made from the dashboard.
The CLI SHALL report a server that is not running, a request that no longer
exists, a mismatched code with the attempts left, and a locked-out or expired
request as distinct, non-zero outcomes, each with its own message. The exit status
SHALL identify the outcome class: `2` for a usage or input error (unknown verb or
option, malformed code, no code on input, no single pending request to resolve),
`1` when the local credential or configuration prevents sending a request, `3`
when the server refuses the request (mismatch, lockout, expiry, unknown request,
credential rejected), and `4` when the server cannot be reached or does not answer
in time.

#### Scenario: Approve from the host shell

- **GIVEN** a pending request on a server running on this host and the 8-digit code displayed on the requesting device
- **WHEN** the operator lists the pending requests and approves one with that code
- **THEN** the device SHALL be paired exactly as if approved from the dashboard
- **AND** the server SHALL record the approval in its pairing audit log

#### Scenario: Listing never reveals the confirmation code

- **WHEN** the operator lists pending requests
- **THEN** no output SHALL contain the confirmation code of any request

#### Scenario: Wrong code spends one shared attempt

- **GIVEN** a pending request with 5 attempts
- **WHEN** the operator supplies a non-matching code from the CLI and then opens the dashboard dialog
- **THEN** the CLI SHALL report the mismatch and the attempts left
- **AND** the dialog SHALL show the same remaining count, because both entry points share one budget

#### Scenario: Lockout from the CLI is terminal

- **WHEN** the attempt budget for a request is exhausted through CLI attempts
- **THEN** further CLI approvals of that request SHALL be refused as locked out and the device SHALL NOT be paired

#### Scenario: No local credential, no approval

- **GIVEN** a host where the local credential cannot be read
- **WHEN** the operator attempts a CLI approval
- **THEN** the CLI SHALL refuse with a non-zero outcome naming the missing credential
- **AND** no approval request SHALL be sent
- **AND** no local-credential file or directory SHALL have been created

#### Scenario: Server bound to a host name

- **GIVEN** the local credential is readable but the server's configured bind host is a host name, so no per-request credential can be derived
- **WHEN** the operator attempts any CLI pairing verb
- **THEN** the CLI SHALL exit non-zero with a message naming the configured host as the cause
- **AND** no request SHALL be sent to the server

#### Scenario: Shell on a different OS than the server

- **GIVEN** the CLI runs under a different operating system or user account than the server process, so it resolves a different local-credential path (for example a WSL shell against a server running on Windows)
- **WHEN** the operator attempts a CLI approval
- **THEN** the CLI SHALL refuse as it does for a missing credential, naming the path it looked in
- **AND** it SHALL NOT create a credential there

#### Scenario: Expired request reported, not silently dropped

- **WHEN** the operator approves a request whose pairing code has already expired
- **THEN** the CLI SHALL report the expiry as a non-zero outcome and pair no device

#### Scenario: Deny from the host shell

- **WHEN** the operator denies a pending request from the CLI
- **THEN** the request SHALL be consumed exactly as a dashboard deny, and an open dashboard dialog for it SHALL close as handled elsewhere

#### Scenario: Untrusted device text cannot drive the terminal

- **GIVEN** a pending request whose self-reported name and User-Agent contain terminal escape sequences, C1 controls, a bidirectional override and a zero-width character, and whose User-Agent exceeds the field maximum
- **WHEN** the operator lists pending requests
- **THEN** the printed fields SHALL contain none of those characters
- **AND** each printed field SHALL be no longer than its maximum, measured in code points

#### Scenario: Truncation never splits a character

- **GIVEN** a User-Agent of 119 ASCII characters followed by `😀` and further text, with a 120 code-point maximum
- **WHEN** the operator lists pending requests
- **THEN** the printed User-Agent SHALL be exactly 120 code points, ending with `…`
- **AND** it SHALL contain no unpaired surrogate

#### Scenario: Malformed code is refused locally

- **WHEN** the operator supplies `1234567`, `123456789` or `12a45678` as the confirmation code
- **THEN** the CLI SHALL exit `2` naming the expected 8 digits
- **AND** no request SHALL be sent and no attempt SHALL be spent
- **WHEN** the operator supplies `1234 5678` or `1234-5678`
- **THEN** the CLI SHALL send `12345678`

#### Scenario: Code piped on standard input

- **GIVEN** standard input is not a terminal and no code option is given
- **WHEN** standard input carries `12345678` followed by a newline
- **THEN** the CLI SHALL submit `12345678`
- **WHEN** standard input ends with no bytes or carries an empty first line
- **THEN** the CLI SHALL exit `2` and send no approval request

#### Scenario: Exit status identifies the outcome class

- **WHEN** a CLI pairing verb ends on a usage error, a missing credential, a server refusal, or an unreachable server
- **THEN** it SHALL exit `2`, `1`, `3` or `4` respectively
- **AND** a mismatch, a lockout, an expiry and an unknown request SHALL each print a distinct message under exit `3`
