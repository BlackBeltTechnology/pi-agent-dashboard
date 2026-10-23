## MODIFIED Requirements

### Requirement: Resolution is inert until identity is enforced

The plane has no mode flag. Identity SHALL be **enforced** only while a trusted resolver is both registered and configured ("active") AND a trusted plugin has registered a browser login descriptor ("login provider registered"). While not enforced ("inert") — including a resolver that is active with NO login provider — the dispatch hook SHALL make no claim: `request.principal` and `request.principalExpiresAt` remain `null`, `request.isAuthenticated` is unaffected by resolution, and every authentication and routing outcome is identical to before this change. Wherever these specs say "the resolver is active", they SHALL be read as "identity is enforced" (design D21). A resolver that is active while no login provider is registered SHALL cause the server to log a warning before it starts listening, stating that identity is not enforced.

#### Scenario: No resolver active
- **WHEN** the server runs with no configured trusted resolver
- **THEN** every request has `request.principal === null`
- **AND** no authentication or routing behavior differs from before the seam existed

#### Scenario: Registered-but-unconfigured resolver stays inert
- **WHEN** the bundled resolver plugin is enabled but missing its `issuer`/`audience` configuration
- **THEN** the dispatch hook makes no claim
- **AND** `request.principal` is `null` and `request.isAuthenticated` is exactly what the pre-existing auth chain set

#### Scenario: Active resolver without a login provider stays inert (self-lockout guard)
- **WHEN** a trusted resolver is registered and configured but no trusted plugin has registered a browser login descriptor
- **THEN** identity is not enforced: the dispatch hook makes no claim, a genuinely-local browser loads the dashboard and opens its WebSocket as before this change, subject to the local-trust rule of `trust-and-credential-boundaries` "Opt-in local proof for loopback trust" (under the default, with local proof), and remote access follows the pre-change network guard
- **AND** the server logs, before listening, that a resolver is configured but no login provider is registered so identity is NOT enforced

#### Scenario: Resolver plus login provider arms enforcement
- **WHEN** a trusted resolver is active AND a trusted plugin has registered a browser login descriptor
- **THEN** identity is enforced: bearer tokens resolve, session roads are owner-gated, and browser upgrades require an identity-bearing ticket

#### Scenario: A plugin that fails to load cannot arm enforcement
- **WHEN** a trusted plugin registers a resolver and/or a browser login descriptor during activation and its activation then fails
- **THEN** the host releases every identity registration that plugin made before the server starts listening, so the failed plugin neither arms enforcement nor advertises a login
- **AND** the server logs that the plugin's resolver/login registrations were released

#### Scenario: Login provider without an active resolver stays inert
- **WHEN** a trusted plugin registered a browser login descriptor but no trusted resolver is active
- **THEN** identity is not enforced, `GET /api/identity/login-config` returns `{ active: false }`, and the server logs that identity is NOT enforced because no principal resolver is active

#### Scenario: Genuinely-local caller is not reported authenticated while enforced
- **WHEN** identity is enforced and a genuinely-local browser without a resolved bearer queries the auth status the client uses to tell `auth_required` from `offline`
- **THEN** it is reported unauthenticated with authentication enabled, so the client shows its authentication-required state rather than "Server offline"; loopback is never treated as authentication on the enforced path

#### Scenario: Enforcement is decided once at startup and latched
- **WHEN** a plugin unregisters its resolver, login descriptor, or policy after the server has started listening, or a plugin is enabled or disabled at runtime
- **THEN** the enforced/not-enforced decision made before listening is unchanged for the life of the process — no road observes a mixed state and owner gating is never silently switched off for connected sockets — and the change takes effect on the next restart
- **AND** a plugin's unregister handle called after startup is a no-op and a registration attempted after startup is ignored, each logged, so the advertised login descriptor, the resolvers, and the policy stay exactly those the decision was made on
