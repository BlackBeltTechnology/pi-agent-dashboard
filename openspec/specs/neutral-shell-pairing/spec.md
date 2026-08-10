# neutral-shell-pairing Specification

## Purpose

Pair the neutral shell with a dashboard server by decoding a QR or copy-string pairing payload, verifying the server's pinned Ed25519 identity through a signed challenge, redeeming a one-time pairing code, showing a confirm code for operator approval, polling until approved, and storing the returned bearer token in the keyring.

## Requirements

### Requirement: Pairing payload decoding

The shell SHALL decode a pairing payload from a QR scan or a pasted string into a payload with a pinned fingerprint `id`, a one-time `code`, and a list of `urls`, rejecting malformed input.

#### Scenario: Decode accepted payload forms

- **WHEN** a raw string is submitted
- **THEN** the shell accepts an `https://…/pair#<payload>` deep link by taking the URL fragment as the payload
- **AND** accepts a `pi:pair:v1.<base64url>` copy-string by stripping the prefix
- **AND** accepts a bare base64url payload or raw `{…}` JSON
- **AND** produces a payload with `id`, `code`, and `urls`

#### Scenario: Malformed payload rejected

- **WHEN** the decoded value is not an object, or is missing a string `id`, a string `code`, or an array `urls`
- **THEN** the shell throws "malformed pairing payload" and enters the error phase without contacting any server

#### Scenario: Scan a QR code with the camera

- **WHEN** the operator chooses "Scan QR" and `BarcodeDetector` is available
- **THEN** the shell opens the environment-facing camera, detects a `qr_code` for up to 30 seconds, and on detection decodes the raw value and begins pairing
- **AND** if `BarcodeDetector` is unsupported or no code is detected, the shell reports an error prompting the operator to paste the code instead
- **AND** the camera stream is always released when scanning ends

### Requirement: Pinned identity verification

The shell SHALL verify each candidate URL against a fresh signed nonce challenge and proceed only with a URL whose returned fingerprint matches the pinned payload `id`, refusing to pair otherwise.

#### Scenario: Verify a matching server identity

- **WHEN** the shell challenges a URL with a random 32-byte nonce
- **THEN** the server returns a `fingerprint`, `publicKey`, and `signature` over the nonce
- **AND** the shell verifies the Ed25519 signature against the returned public key
- **AND** proceeds using the first URL whose signature verifies and whose `fingerprint` equals the payload `id`

#### Scenario: Pin mismatch or unreachable

- **WHEN** no candidate URL yields a verified signature with a fingerprint matching the payload `id`
- **THEN** the shell enters the error phase reporting that the server identity could not be verified (pin mismatch or unreachable) and does not redeem the code

### Requirement: Code redemption and confirm code display

The shell SHALL redeem the pairing code against the verified server and display the returned confirm code for the operator to approve.

#### Scenario: Redeem succeeds

- **WHEN** the shell posts the payload `code` to `/api/pair/redeem` on the verified URL
- **THEN** the server returns a `pendingId` and a `confirmCode`
- **AND** the shell displays the `confirmCode` and instructs the operator to type it on the dashboard to approve

#### Scenario: Redeem fails

- **WHEN** the redeem request fails
- **THEN** the shell enters the error phase reporting the redeem failure and does not poll

### Requirement: Approval polling and bearer storage

The shell SHALL poll the verified server with the pending id until approval, then store the returned bearer token and pinned identity in the keyring; it SHALL surface rejection, expiry, poll failure, and storage failure as errors.

#### Scenario: Poll until approved and store

- **WHEN** the shell polls `/api/pair/poll` with the `pendingId` every 2 seconds
- **THEN** while the status is `pending` it continues polling
- **AND** when the status is `approved` with a `token`, the shell stores a keyring entry keyed by the payload `id` containing the label (operator input or the verified URL host), the payload `urls`, the pinned public key, the pinned fingerprint, and the bearer token, then reports success

#### Scenario: Pairing rejected or expired

- **WHEN** a poll returns status `unknown`
- **THEN** the shell enters the error phase reporting that pairing expired or was rejected and stops polling

#### Scenario: Poll or storage failure

- **WHEN** a poll request fails, or writing the keyring entry fails
- **THEN** the shell enters the error phase reporting the failure and stops

#### Scenario: Polling cancelled on unmount

- **WHEN** the pairing view unmounts while polling
- **THEN** the polling loop stops and no further poll requests are issued
