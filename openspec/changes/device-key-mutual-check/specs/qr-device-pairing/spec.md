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
selected tier. A QR redemption SHALL keep its existing presentation, except for the device key rows below.

When the pending request carries a verified device key, the dialog SHALL show a "Device key" row with its short id (`dk:` followed by 12 characters), and "none" (or no row) when it carries none. When it carries a verified companion key, the dialog SHALL also show the companion statement and the "Allow this status check" checkbox specified by `device-key-mutual-check`, unticked by default and presented with the origin as claimed by the requester and rendered as plain text; approving SHALL send the checkbox state, and an unticked box SHALL pair the device without the companion.

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

#### Scenario: Dialog shows the device key
- **WHEN** a pending request carries a verified device key
- **THEN** the dialog SHALL show a Device key row with its short id

#### Scenario: Companion choice defaults to off
- **WHEN** a pending request carries a verified companion for `http://192.168.16.31:8000`
- **THEN** the dialog SHALL show "Allow this status check" unticked and the sentence that the other dashboard can only see the pairing and cannot sign in or act with it

#### Scenario: Request without a companion shows no companion choice
- **WHEN** a pending request carries no companion
- **THEN** the dialog SHALL NOT show the companion statement or checkbox
