## ADDED Requirements

### Requirement: An upstream rate limit marks the account cooling
When the provider returns a rate-limit response, the service SHALL transition the account used for that request to `cooling`, deriving the cooldown from the provider's retry indication when present and a bounded default otherwise.

#### Scenario: Cooldown derived from retry-after
- **WHEN** an upstream 429 carries a retry-after value
- **THEN** the account cools for that duration

#### Scenario: Cooldown defaults when no retry indication
- **WHEN** an upstream 429 carries no retry indication
- **THEN** the account cools for a bounded configured default

### Requirement: Rotation re-forwards the same request
With rotation in effect, the service SHALL select the next eligible account and forward the original request to the provider again, so the client's request is not failed by a rotation.

#### Scenario: Request succeeds on the next account
- **WHEN** the first selected account returns a rate limit and another eligible account exists
- **THEN** the same request is forwarded on the next account and its successful response is returned to the client

#### Scenario: Attempts are bounded
- **WHEN** successive accounts each return a rate limit
- **THEN** the service stops after a bounded number of attempts and returns a rate-limit response rather than trying indefinitely

### Requirement: Rotation cannot occur after response bytes are sent
The service SHALL NOT rotate once any part of a response has been relayed to the client.

#### Scenario: Mid-stream upstream failure surfaces as an error
- **WHEN** an upstream stream fails after chunks have already been relayed
- **THEN** the error is surfaced to the client rather than silently retried on another account

### Requirement: Rotation requires a replayable request
The service SHALL buffer the request body to permit re-forwarding, and SHALL disable rotation for requests whose body exceeds the configured buffering bound.

#### Scenario: Oversized request forgoes rotation
- **WHEN** a request body exceeds the configured bound
- **THEN** the request is forwarded on the selected account without buffering, and a rate limit is returned to the client rather than rotated
