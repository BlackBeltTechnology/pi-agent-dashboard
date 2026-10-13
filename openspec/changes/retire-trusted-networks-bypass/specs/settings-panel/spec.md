## MODIFIED Requirements

### Requirement: Trusted Networks section on Security tab
The Security tab SHALL include a "Network access" section (the Trusted Networks section) that edits `network.trustMode` and `config.auth.bypassHosts`.

**Trust mode control.** The section SHALL open with a two-option radio group (`role="radiogroup"`, arrow-key navigation) bound to `network.trustMode`: "Pair each device" (marked Recommended; value `"pair"`) and "Trust whole networks" (marked Legacy; value `"legacy"`). Each option SHALL state its consequence in one line. The selection SHALL reflect the **saved** mode (never re-derived from the draft list) and SHALL be written through the panel Save like every other Security field, never on click; a saved change SHALL write `network.trustMode` with `network.trustModeOrigin: "operator"`, and `network` SHALL map to the Security page in the panel's field-to-page map. When the draft selects `"pair"` while the saved mode is `"legacy"`, the section SHALL show, before Save, a warning callout that states the number of device addresses (`/api/health` `trustPosture.networkOnly.distinctPeers`, when greater than zero and disclosed to the viewer; otherwise generic copy without a number) that will be refused until each pairs, and that a paired browser opens its live UI only with the `operate` tier. The callout SHALL also state that another dashboard switching to this server in-page loses images and previews until this dashboard is opened directly. When `pairing.acceptLanRequests` is off, the same callout SHALL state that devices cannot request access until it is on and SHALL offer a checkbox, unchecked by default, that turns it on in the same Save. When the saved mode is `"legacy"` and that number is greater than zero, the section SHALL show a migration warning callout stating the count and recommending pairing.

In `"pair"` mode with `pairing.acceptLanRequests` off, the section SHALL show an information callout stating that devices cannot request access until LAN requests are accepted, with a control that turns it on through the panel Save. A stored unrecognised `network.trustMode` SHALL render with "Pair each device" checked and a warning callout naming the unrecognised value and offering to save an explicit choice.

**Mode-dependent copy.** The list SHALL be headed "Trusted networks — admitted without sign-in" in `"legacy"` mode and "Networks that may request access" in `"pair"` mode. In `"pair"` mode the description SHALL state that private ranges may always request access, that added ranges extend who may request access, and that listing a network never grants access. Wide-range explanations (here and on the block-event rows) SHALL say "grants unauthenticated access to the whole range" only in `"legacy"` mode; in `"pair"` mode they SHALL say every device in the range may request access.

**Refused peers (block events).** In `"legacy"` mode the block-event rows SHALL keep their Trust actions. In `"pair"` mode a refused peer SHALL be shown as an information callout with no Trust action: for a peer that is already eligible to request access (private range or listed) it SHALL tell the operator to have the device choose Request access and approve it with a code; for a peer that is not eligible it SHALL offer one action that adds that exact address to the list, labelled as allowing requests from it (not access).

**Order.** Within the section: mode radio group → consequence or migration callout → list heading and description → bind reachability advisory → refused-peer rows → entry list → add controls → legacy-only full-access warning. The section SHALL display existing entries as individual rows with per-entry remove (✕) buttons. The section SHALL provide a "+ Add Local Network" button that opens a dropdown listing the current host's non-loopback IPv4 network interfaces (fetched from `GET /api/network-interfaces`). The dropdown SHALL render each interface's `label` rather than its raw device name, and SHALL offer that interface's `suggestions` rather than its raw `cidr`. A suggestion marked `wide` SHALL be visually distinguished from a narrow one and SHALL carry the mode-appropriate wide-range explanation defined below.

`wide` means **broader than the reference network of the path that produced it**, not an absolute property of the range. The block-event path's reference is the exact peer address, so any derived range is wide. The interface path's reference is the interface's own netmask-derived network, so that network is narrow while any range broader than it — including the containing range offered for a `/32` point-to-point device — is wide. The same `192.168.10.0/24` is therefore narrow from an interface and wide from a block event, and neither is wrong. Because the tier alone is ambiguous across contexts, every offer SHALL state the range it grants in its label, so the user is never relying on colour to judge breadth.

When two interfaces collapse to one row, the surviving row SHALL use the `label` of the first interface in the endpoint's response order, so the collapse is deterministic. An interface with `pointToPoint: true` and no suggestion SHALL be shown as unofferable with an explanation, not as a selectable entry. The dropdown SHALL deduplicate on the suggestion **`value`**, so that two interfaces resolving to the same offer — whether two NICs on one subnet or two point-to-point devices sharing a containing range — produce a single row. Deduplication is performed by this dropdown, never by the endpoint, whose entries the listen-interface picker also consumes. The section SHALL provide a manual entry input that accepts exact IP, wildcard (e.g. `10.0.0.*`), or CIDR (e.g. `192.168.1.0/24`) formats. In `"legacy"` trust mode the section SHALL display an explicit security warning ("Anyone on a trusted network has full access to the dashboard without authentication. Only use on private networks you control.") as a warning callout, omitted while the network-trust migration callout is shown; in `"pair"` mode the warning SHALL NOT be shown, because a list entry grants no access. Adding an entry SHALL write to `config.auth.bypassHosts` — never to top-level `config.trustedNetworks`. Removing an entry SHALL remove from `config.auth.bypassHosts` only.

#### Scenario: Section writes to auth.bypassHosts, not trustedNetworks
- **WHEN** the user adds `192.168.1.0/24` via the Trusted Networks section and clicks Save
- **THEN** the saved config SHALL have `auth.bypassHosts` containing `192.168.1.0/24`
- **AND** the saved config SHALL NOT have `192.168.1.0/24` added to top-level `trustedNetworks`

#### Scenario: Add Local Network dropdown populates from network interfaces
- **WHEN** the user clicks "+ Add Local Network"
- **THEN** the UI SHALL call `GET /api/network-interfaces`
- **AND** display each interface's `label` and its `suggestions` in a dropdown
- **AND** selecting a suggestion SHALL add its `value` to the list and `auth.bypassHosts`

#### Scenario: Tailscale interface offers the tailnet range, not the host
- **GIVEN** `GET /api/network-interfaces` returns a `pointToPoint` tailnet interface whose sole suggestion is the wide range `100.64.0.0/10`
- **WHEN** the user opens the Add Local Network dropdown
- **THEN** `100.97.246.31/32` SHALL NOT be offered
- **AND** `100.64.0.0/10` SHALL be offered, marked as wide
- **AND** the entry SHALL be labelled as the tailnet interface, not `utun4`

#### Scenario: Unofferable point-to-point interface is explained, not silently dropped
- **GIVEN** an interface has `pointToPoint: true` and no suggestion
- **WHEN** the user opens the Add Local Network dropdown
- **THEN** the interface SHALL be shown as unofferable with an explanation
- **AND** it SHALL NOT be selectable

#### Scenario: Same range tiered differently in the two paths
- **GIVEN** an interface at `192.168.10.123/255.255.255.0` and a block event from `192.168.10.57`
- **WHEN** both offer `192.168.10.0/24`
- **THEN** the interface path MAY mark it narrow and the block-event path MAY mark it wide
- **AND** both offers SHALL state `192.168.10.0/24` in their label

#### Scenario: One offer per suggestion value
- **GIVEN** two interfaces resolve to the same suggestion `value`
- **WHEN** the user opens the Add Local Network dropdown
- **THEN** that value SHALL appear exactly once

#### Scenario: Two point-to-point devices sharing a range collapse to one offer
- **GIVEN** two `pointToPoint` interfaces with different addresses both suggest `100.64.0.0/10`
- **WHEN** the user opens the Add Local Network dropdown
- **THEN** `100.64.0.0/10` SHALL appear exactly once

#### Scenario: Deduplication does not reach the listen-interface picker
- **GIVEN** two interfaces on one subnet with distinct addresses
- **WHEN** the user opens the Server page's listen-interface picker
- **THEN** both addresses SHALL remain selectable

#### Scenario: Manual entry accepts flexible formats
- **WHEN** the user types `10.0.0.5` (exact), `10.0.0.*` (wildcard), or `192.168.1.0/24` (CIDR) in the manual entry field and confirms
- **THEN** the UI SHALL add each entry to the list and `auth.bypassHosts`

#### Scenario: Remove entry removes only from auth.bypassHosts
- **WHEN** the user clicks the ✕ button on an entry originating from `auth.bypassHosts`
- **THEN** the UI SHALL remove the entry from `auth.bypassHosts` on save
- **AND** entries in top-level `config.trustedNetworks` SHALL remain untouched

#### Scenario: Info hint shown when top-level trustedNetworks is non-empty
- **WHEN** the loaded config has non-empty top-level `trustedNetworks` entries
- **THEN** the Trusted Networks section SHALL display an informational hint indicating additional entries exist in `config.json` under `trustedNetworks` that are also active but edited via that file

#### Scenario: No hint when top-level trustedNetworks is empty
- **WHEN** the loaded config has empty or missing top-level `trustedNetworks`
- **THEN** the informational hint SHALL NOT be displayed

#### Scenario: Mode radio reflects the saved mode
- **GIVEN** config holds `network.trustMode: "legacy"`
- **WHEN** the Security tab opens and the user adds or removes a list entry
- **THEN** "Trust whole networks" SHALL stay checked

#### Scenario: Selecting Pair is a draft until Save
- **WHEN** the user selects "Pair each device"
- **THEN** no config write SHALL occur until Save
- **AND** on Save the written config SHALL contain `network.trustMode: "pair"` and `network.trustModeOrigin: "operator"`

#### Scenario: Consequence shown before switching to Pair
- **GIVEN** the saved mode is `"legacy"` and `trustPosture.networkOnly.distinctPeers` is `3`
- **WHEN** the user selects "Pair each device" without saving
- **THEN** a warning callout SHALL state that 3 devices will be refused until each pairs

#### Scenario: Pair-mode copy
- **WHEN** the effective mode is `"pair"`
- **THEN** the list SHALL be headed "Networks that may request access"
- **AND** the full-access warning SHALL NOT be shown

#### Scenario: Refused LAN peer in pair mode offers no Trust action
- **GIVEN** the effective mode is `"pair"` and a block event exists for `192.168.16.31`
- **WHEN** the Security tab opens
- **THEN** the row SHALL tell the operator to have the device choose Request access
- **AND** no "+ Trust" action SHALL be rendered for it

#### Scenario: Refused ineligible peer in pair mode can be allowed to request
- **GIVEN** the effective mode is `"pair"` and a trustable block event exists for `198.51.100.23`, which no private range or list entry covers
- **WHEN** the operator activates the row's action
- **THEN** `198.51.100.23` (the exact address, not a range) SHALL be added to the draft `auth.bypassHosts`
- **AND** the action label SHALL describe allowing requests, not granting access

#### Scenario: Switching to Pair while LAN requests are off
- **GIVEN** the saved mode is `"legacy"` and `pairing.acceptLanRequests` is off
- **WHEN** the user selects "Pair each device"
- **THEN** the consequence callout SHALL state that devices cannot request access until LAN requests are accepted
- **AND** an unchecked checkbox SHALL offer to turn `pairing.acceptLanRequests` on in the same Save

#### Scenario: Pair mode with LAN requests off
- **GIVEN** the saved mode is `"pair"` and `pairing.acceptLanRequests` is off
- **WHEN** the Security tab opens
- **THEN** an information callout SHALL state that devices cannot request access, with a control that turns LAN requests on via Save
