## ADDED Requirements

### Requirement: Provider-shaped endpoints are exposed
The service SHALL expose endpoints matching the request and response shapes of the supported provider APIs, so that a pi client configured with a `baseUrl` pointing at keysync requires no client-side protocol adaptation.

#### Scenario: Client configured by baseUrl alone
- **WHEN** a pi client is configured with a provider entry whose `baseUrl` is the keysync endpoint, an `api` type, and a member key
- **THEN** requests succeed without any additional client-side plugin mediating the protocol

#### Scenario: Unsupported api type is rejected clearly
- **WHEN** a request arrives for an api shape the service does not implement
- **THEN** the service returns an error naming the unsupported shape

### Requirement: Requests are authenticated before an account is selected
The service SHALL reject an unauthenticated or unauthorized request before decrypting or selecting any account.

#### Scenario: Invalid key does not touch the vault
- **WHEN** a request presents an invalid member key
- **THEN** it is rejected and no account is decrypted

### Requirement: Responses stream through without buffering
The service SHALL relay streaming responses to the client incrementally rather than accumulating the complete response before replying.

#### Scenario: Streamed tokens arrive incrementally
- **WHEN** an upstream provider streams a response
- **THEN** the client receives response chunks progressively rather than only at completion

### Requirement: Credentials are never returned to the client
The service SHALL NOT include any provider access token, refresh token, or account credential in a proxy response or error body.

#### Scenario: Upstream auth error is sanitised
- **WHEN** the upstream provider returns an authentication error whose body echoes credential material
- **THEN** the response relayed to the client contains no credential material

### Requirement: Concurrency is bounded per key and per account
The service SHALL enforce configurable limits on concurrent in-flight requests per member key and per account, rejecting excess requests with a retry indication.

#### Scenario: Per-key limit reached
- **WHEN** a single member key exceeds its configured concurrent request limit
- **THEN** further requests are rejected with an error carrying a retry-after indication, without affecting other members
