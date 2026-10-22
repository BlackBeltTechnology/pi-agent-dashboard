## MODIFIED Requirements

### Requirement: Bearer auth mode independent of origin-bound cookie
The client SHALL support authenticating to a cross-origin server with a bearer
token via `Authorization: Bearer` for REST — as an alternative to the
origin-bound auth cookie — so a neutral-origin shell can reach a server on a
different origin. For WebSocket the client SHALL mint a short-lived single-use
ticket from an authenticated REST call and present that ticket on the upgrade;
the durable bearer token SHALL NOT be placed on the socket. The client SHALL keep each server's bearer in a slot specific to that server's origin, SHALL rotate it when less than 25% of its lifetime remains (lifetime being issue to `expiresAt` of the current bearer, which already reflects the 30-day cap), and SHALL re-pair when the server answers 401 `bearer_expired`. The client SHALL discard the legacy single global bearer slot (`pi-dashboard:device-bearer`) without migrating it, on both the cross-origin and the same-origin path, including the early fallback taken when `VITE_API_URL` is set, and SHALL declare a browser holder when pairing or rotating a bearer it keeps in browser storage. A same-origin browser that keeps its bearer because the device cookie could not be proven SHALL store it in the slot for its own origin, never the legacy global slot.

#### Scenario: Cross-origin REST with bearer
- **WHEN** the shell issues a REST call to a paired server on a different origin
- **THEN** it attaches the server's bearer token in the `Authorization` header

#### Scenario: Cross-origin WebSocket with ticket
- **WHEN** the shell opens a WebSocket to a paired server on a different origin
- **THEN** it first mints a single-use ticket via an authenticated REST call and opens the socket with that ticket, never placing the durable bearer on the socket or relying on a cookie

#### Scenario: Client rotates before expiry
- **WHEN** a stored bearer for a cross-origin server has less than a quarter of its lifetime remaining
- **THEN** the client SHALL call the rotation route and replace the stored bearer with the returned one

#### Scenario: Expired bearer triggers re-pairing
- **WHEN** a request to a cross-origin server returns 401 with code `bearer_expired`
- **THEN** the client SHALL discard that server's bearer and start pairing again, without retrying the request with the expired bearer

#### Scenario: Threshold uses the current bearer's own lifetime
- **WHEN** a bearer was issued with a shortened expiry because of the 30-day cap
- **THEN** the 25% threshold SHALL be measured against that shortened issue-to-`expiresAt` span

#### Scenario: Pairing stores the bearer with its expiry
- **WHEN** the client completes pairing with a cross-origin server
- **THEN** it SHALL store the bearer together with the `expiresAt` the server returned

#### Scenario: Failed rotation is retried at most once a minute
- **WHEN** a rotation attempt fails while the stored bearer is still valid
- **THEN** the client SHALL retry on the next REST call, and no more often than once per minute

#### Scenario: Concurrent expired responses re-pair once
- **WHEN** several concurrent requests receive 401 `bearer_expired`
- **THEN** the client SHALL navigate once to the pairing landing page, not once per response

#### Scenario: Storage write failure keeps the bearer in memory
- **WHEN** writing the rotated bearer to `localStorage` throws
- **THEN** the client SHALL keep the new bearer in memory for the page session and show one warning notice

#### Scenario: Bearer slots are per server
- **WHEN** the shell is paired with two cross-origin servers and switches between them
- **THEN** each request SHALL carry only the bearer stored for its own server's origin

#### Scenario: Legacy global bearer slot is discarded
- **WHEN** the client starts, against a cross-origin server (via `ServerSelector` or `VITE_API_URL`) or a same-origin one, and finds a bearer in the legacy `pi-dashboard:device-bearer` slot
- **THEN** it SHALL delete that value, SHALL NOT send it to any server and SHALL NOT copy it into a per-origin slot
- **AND** the user SHALL pair again once with each cross-origin server

#### Scenario: Browser holder is declared when keeping a bearer
- **WHEN** the client pairs with, or rotates its bearer for, a cross-origin server and will keep the result in browser storage
- **THEN** the request SHALL carry the browser-holder declaration

#### Scenario: Same-origin keep-failed bearer uses the per-origin slot
- **WHEN** a same-origin browser's cookie-only check fails and it keeps its bearer
- **THEN** the client SHALL store the bearer in the slot for its own origin and SHALL NOT write the legacy global slot
