## ADDED Requirements

### Requirement: Repository origin sent to the hub is credential-free

The origin a bridge sends in a vault sync request, and the one the hub stores, SHALL contain no URL credentials: `http(s)` has all userinfo stripped, `ssh://` has the password stripped and the user kept, scp-style is unchanged. A remote with userinfo that cannot be parsed SHALL be sent as no origin. The bridge SHALL send the stripped raw origin, never a normalized one. The hub SHALL derive the repository key from the stored origin by normalization once, so stripping SHALL NOT change the key.

#### Scenario: Credentialed origin is stripped before sending

- **GIVEN** a session whose `origin` remote is `https://user:token@github.com/acme/app.git`
- **WHEN** the bridge sends its vault sync request
- **THEN** the origin on the wire SHALL be `https://github.com/acme/app.git`, containing neither `user` nor `token`
- **AND** the hub SHALL store only that credential-free origin

#### Scenario: Grants still match

- **GIVEN** a grant for `https://github.com/acme/app.git`
- **WHEN** a session's origin is `https://user:token@github.com/acme/app.git`
- **THEN** the hub SHALL derive the same repository key as the grant and the session SHALL match that grant

#### Scenario: SSH origin without a password is not altered

- **GIVEN** a session whose `origin` is `ssh://git@github.com/acme/app` or `git@github.com:acme/app.git`
- **WHEN** the bridge sends its vault sync request
- **THEN** the origin on the wire SHALL equal the raw remote
- **AND** the derived repository key SHALL equal that of the `https://github.com/acme/app.git` form

#### Scenario: SSH URL password is stripped, user kept

- **GIVEN** a session whose `origin` is `ssh://git:secret@github.com/acme/app`
- **WHEN** the bridge sends its vault sync request
- **THEN** the origin on the wire SHALL be `ssh://git@github.com/acme/app`, without `secret`
- **AND** the derived repository key SHALL be unchanged

#### Scenario: Unparseable origin with userinfo is not sent
- **WHEN** a session's remote contains userinfo but cannot be parsed as a URL
- **THEN** the bridge SHALL send no origin in its vault sync request

#### Scenario: Older bridge sending raw userinfo

- **WHEN** the hub receives a vault sync origin that still contains `http(s)` userinfo or an `ssh://` password
- **THEN** the hub SHALL discard the userinfo (for `ssh://`, the password only) before storing it and derive the repository key from the result exactly once
