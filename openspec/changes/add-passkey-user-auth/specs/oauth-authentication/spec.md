## ADDED Requirements

### Requirement: Session tier claim
The session JWT SHALL carry an optional `tier` claim (`observe`, `control`, or
`operate`). When validating a session, the auth module SHALL set the request's
principal tier from the claim, so the existing route-tier gate applies to
cookie sessions exactly as it does to paired-device bearers. A valid JWT
without a `tier` claim SHALL be treated as `operate`, preserving the access of
sessions issued before this change. Loopback, genuine-local, and trusted
bypass paths SHALL be unaffected.

#### Scenario: Observe session refused on an operate route
- **GIVEN** a session JWT with `tier: "observe"`
- **WHEN** it calls a route whose tier is `operate`
- **THEN** the route-tier gate SHALL refuse the request

#### Scenario: Legacy JWT keeps full access
- **GIVEN** a valid session JWT issued without a `tier` claim
- **WHEN** it calls a route whose tier is `operate`
- **THEN** the request SHALL be allowed

### Requirement: OIDC groups map to a tier
The auth module SHALL accept an optional `auth.groupTiers` map from group name
to tier. When it is configured, on OIDC callback the module SHALL read the
`groups` claim from the ID token or userinfo response and issue the session
with the highest tier among the matching groups. When `auth.groupTiers` is
configured and no group matches, login SHALL be refused. When it is not
configured, login SHALL behave as before (`allowedUsers` check, `operate`
tier). A tier derived from groups SHALL hold until the JWT expires.

#### Scenario: Highest matching group wins
- **GIVEN** `auth.groupTiers` = `{ "dash-view": "observe", "dash-ops": "operate" }`
- **WHEN** a user whose `groups` claim is `["dash-view", "dash-ops"]` completes OIDC login
- **THEN** the session JWT SHALL carry `tier: "operate"`

#### Scenario: No matching group is refused
- **GIVEN** `auth.groupTiers` is configured
- **WHEN** a user whose `groups` claim matches none of its keys completes OIDC login
- **THEN** no session SHALL be issued and the user SHALL see an access-denied page

#### Scenario: Unconfigured map keeps legacy behaviour
- **GIVEN** `auth.groupTiers` is not configured
- **WHEN** an allowed user completes OIDC login
- **THEN** the session SHALL be issued with tier `operate`
