## MODIFIED Requirements

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

### Requirement: Pending-request feed for operators
The server SHALL record, for each pending device, the redeemer's User-Agent, the
host it arrived through, its remote address, any proxy-reported client address
and the redemption time, each bounded in length. It SHALL additionally record the
pending device's provenance (`qr` or `knock`), and for a knock the bounded
requester name when supplied and whether the knock arrived unencrypted. It SHALL
expose the list of pending devices (identifier, that metadata, provenance,
requester name, unencrypted flag, expiry, attempts remaining) only to
operator callers, and SHALL notify connected browsers that the pending set changed
using a message that carries no request detail. Approval by pending-request
identifier SHALL be available to operator callers only. Redeemer metadata and the
requester name SHALL be
treated as untrusted display text: they SHALL NOT affect any authorization decision
and SHALL NOT be written to logs. Pairing codes and confirmation codes SHALL NOT be
included in the list, the notification, or logs. Clients SHALL treat an absent
provenance as `qr`.

#### Scenario: Change notification carries no detail
- **WHEN** a pending device is added, approved, denied, locked out or expires
- **THEN** connected browsers SHALL receive a change notification containing no identifier, address, User-Agent or code

#### Scenario: Pending list is operator-only
- **WHEN** the pending list is requested with only a paired-device credential or from an unauthenticated remote caller
- **THEN** the request SHALL be refused

#### Scenario: Provenance is listed
- **GIVEN** one pending device from a QR redemption and one from an unencrypted knock named `Roberts-MacBook-Pro`
- **WHEN** an operator lists pending devices
- **THEN** the first entry SHALL carry provenance `qr` and the second provenance `knock`, requester name `Roberts-MacBook-Pro` and the unencrypted flag set
- **AND** neither entry SHALL carry a pairing code or confirmation code

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
