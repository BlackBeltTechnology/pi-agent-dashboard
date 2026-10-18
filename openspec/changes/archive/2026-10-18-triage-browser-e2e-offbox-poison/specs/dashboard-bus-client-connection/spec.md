## MODIFIED Requirements

### Requirement: Off-box / untrusted mint rejection
The client SHALL surface an explicit `OffBoxError` (code `off-box`) whenever the ticket cannot be minted, rather than hanging.

A denied mint SHALL be self-describing. The error SHALL carry, as typed fields rather than only as message text, the HTTP status the endpoint returned and the machine-readable error literal the response body supplies, so that a caller can branch on the refusal kind without parsing a message. The message SHALL additionally render the server's human-readable reason when the body supplies one; that reason is prose and SHALL NOT be treated as a branchable value. A denial by network policy, a denial by authentication, and an unreachable endpoint SHALL be distinguishable from the error's typed fields and from its text without consulting server logs. The error SHALL NOT include any further body fields, so that remedy hints naming hosts or tokens are not copied into test output.

Reading the denial body SHALL NOT be able to replace the denial with a parse failure: a response body that is not valid JSON SHALL yield the status-carrying error with no error literal and no reason, never a thrown parse exception.

#### Scenario: Network guard denies the caller

- **WHEN** the mint request is denied with HTTP 403 and a body naming a machine-readable error literal and a reason
- **THEN** the client throws `OffBoxError` carrying that status and that error literal as typed fields
- **AND** the message names the status, the error literal and the server-reported reason

#### Scenario: Denied by the authentication plane

- **WHEN** the mint request is denied with HTTP 401
- **THEN** the client throws `OffBoxError` carrying that status
- **AND** a caller can tell from the status alone that this is not a network-policy denial

#### Scenario: Denied without a machine-readable body

- **WHEN** the mint request is denied with a status but no parseable error/reason body
- **THEN** the client throws `OffBoxError` carrying the status and no error literal
- **AND** the message SHALL NOT claim a reason the server did not give

#### Scenario: Denied with a non-JSON body

- **WHEN** the mint request is denied with a status and a body that is not valid JSON
- **THEN** the client throws `OffBoxError` carrying the status
- **AND** no parse error SHALL surface in place of the denial

#### Scenario: Mint endpoint unreachable
- **WHEN** the mint request fails to reach the base URL (fetch throws)
- **THEN** the client throws `OffBoxError` naming the unreachable base URL
- **AND** the message SHALL be distinguishable from a policy denial

#### Scenario: Mint response rejects the request
- **WHEN** the endpoint responds without a success flag or without a ticket value
- **THEN** the client throws `OffBoxError` carrying the server-reported reason
