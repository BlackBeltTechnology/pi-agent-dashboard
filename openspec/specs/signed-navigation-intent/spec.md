# signed-navigation-intent Specification

## Purpose
Route-backed overlay URLs can carry a server-signed proof that the dashboard's own UI, acting for the requesting principal, produced the navigation through an operator action. Only such URLs may confer operator provenance. A pasted, shared, or crafted link, or an agent-driven open, stays at the restricted agent provenance.

## Requirements

### Requirement: Intent minting
The server SHALL mint a navigation intent only for a request admitted by the identity plane, or, when the plane is inert, by the network guard. A cross-site request SHALL NOT mint or read one. The intent binds that principal, the overlay route kind (`url-view` or `file-view`), the exact target (URL, or folder plus path), and an expiry exactly 600 seconds after minting.

#### Scenario: Operator mints an intent
- **WHEN** the dashboard client of an admitted operator requests an intent for a `file-view` of `README.md` in a folder
- **THEN** the server returns a URL-safe intent value bound to that principal, route kind, folder, path, and expiry

#### Scenario: Unadmitted mint refused
- **WHEN** a request that the identity plane or network guard does not admit asks for an intent
- **THEN** the server refuses and mints nothing

#### Scenario: Cross-site mint refused
- **WHEN** a page on another origin, running in the operator's browser, posts a mint request to the dashboard
- **THEN** the request is refused and no intent value is readable by that page

#### Scenario: Blocked target refused
- **WHEN** the requested `url-view` target classifies as `blocked` under the client URL policy
- **THEN** the server refuses to mint

### Requirement: Intent value reveals nothing in clear
The intent value placed in a URL SHALL contain no principal identifier, folder, path, or target URL in clear. Only the expiry and the integrity tag appear.

#### Scenario: Intent inspected
- **WHEN** an intent value for `file-view` of `/home/op/secret-project/notes.md` is base64-decoded
- **THEN** neither the principal identifier nor any part of the folder or path appears in it

### Requirement: Intent verification
An intent SHALL verify only when its integrity check passes and it has not expired. The verifying principal, route kind, and target must all equal the ones it was minted for. Verification SHALL require the same admission as minting and use a constant-time comparison. Intents SHALL NOT survive a server restart.

#### Scenario: Tampered intent
- **WHEN** any byte of the intent value is altered
- **THEN** verification fails

#### Scenario: Intent replayed for another target
- **WHEN** an intent minted for `README.md` is attached to a `file-view` URL for `secrets.env`
- **THEN** verification fails

#### Scenario: Intent used by another principal
- **WHEN** an intent minted for principal A is presented by principal B
- **THEN** verification fails

#### Scenario: Expired intent
- **WHEN** an intent is presented 601 seconds after minting
- **THEN** verification fails

#### Scenario: Intent at the end of its lifetime
- **WHEN** an intent is presented 599 seconds after minting
- **THEN** verification succeeds

#### Scenario: Server restarted
- **WHEN** an intent minted before a server restart is presented after it
- **THEN** verification fails

### Requirement: Intents are requested only for operator actions
The client SHALL request an intent only while handling an operator action that the preview egress policy already classes as an operator open. It SHALL NOT request one for an agent-driven open, the confirm-chip tap of an agent-declared server or URL, an agent preview card, or an open that bypasses the click handler.

#### Scenario: Agent-declared dev server
- **WHEN** the user taps the confirm chip of an agent-declared `http://localhost:54321/`
- **THEN** no intent is requested and the overlay has agent provenance

#### Scenario: Expand on an agent preview card
- **WHEN** the user expands a preview card that an agent opened
- **THEN** no intent is requested and the overlay has agent provenance

#### Scenario: Modifier-click opens a new tab
- **WHEN** the user middle-clicks or modifier-clicks an in-app overlay link
- **THEN** the new tab opens without an intent and the overlay has agent provenance

### Requirement: Intent confers operator provenance on route-backed overlays
A route-backed overlay SHALL declare operator provenance only when its URL carries an intent that verifies for that route and target. Every other load of the same route SHALL declare agent provenance, including a missing, failing, or unverifiable intent or an unreachable server.

#### Scenario: In-app deep link survives reload
- **WHEN** the operator opens a file overlay from the file tree and reloads the page within the intent lifetime
- **THEN** the overlay still has operator provenance

#### Scenario: Pasted link stays restricted
- **WHEN** a `/pi-view?url=http://127.0.0.1:5555/` link without an intent is opened from outside the dashboard
- **THEN** the overlay has agent provenance and the restricted egress policy

#### Scenario: Intent verification unavailable
- **WHEN** the intent cannot be verified because the server is unreachable or the request fails
- **THEN** the overlay renders with agent provenance

#### Scenario: Intent removed from the address bar
- **WHEN** the operator strips the intent parameter and reloads in the same tab
- **THEN** the overlay has agent provenance

### Requirement: Return-to values are not intent-gated
Post-login return-to and return-URL values SHALL keep their existing protections: same-origin restriction plus integrity binding inside the OAuth `state`. They SHALL NOT require a navigation intent.

#### Scenario: Login return unchanged
- **WHEN** a login completes with a same-origin return-to and no navigation intent
- **THEN** the browser returns to that path exactly as before this capability
