## Purpose

Extends the frozen slot taxonomy with one slot, `login-provider`. It is the **optional bundled
dashboard-client adapter** for browser login: a deployment whose frontend IS the dashboard's bundled
React client can have a trusted plugin claim the slot to supply a login component the core mounts
pre-token. The slot keeps the dashboard core free of any provider-specific login code. It is **not**
part of the current deployment (design.md D20), where the browser frontend is the user's own
application and login is owned by a custom independent server plugin that claims no slot and ships
nothing into the client bundle.

## ADDED Requirements

### Requirement: `login-provider` slot

The slot taxonomy SHALL include a slot id `login-provider`. A plugin claiming `login-provider` SHALL
supply exactly one client **component** (a `component` name); no `startLogin` or other function is
carried through the manifest. The core SHALL mount that component in a start phase and on its
pre-auth `/callback` route to complete the flow. The manifest validator SHALL accept a
`login-provider` claim and SHALL require its `component` to be a non-empty string.

The core SHALL honor a `login-provider` claim ONLY from the bundled resolver id or a plugin listed in
the **current** `identity.trustedResolverPlugins` allowlist, and only while that resolver is active.
Manifest priority SHALL NOT select the login provider (the redirect-to-IdP and code-exchange path is
a trust boundary, not an ordering concern). When no trusted, active plugin claims `login-provider`,
the slot SHALL contribute nothing and the core SHALL render no login gate. The mount that renders the
callback component before the authed shell SHALL apply the enabled-plugin filter itself, so a
disabled or untrusted plugin contributes nothing even pre-shell.

The slot SHALL be optional. It SHALL NOT be a requirement for a deployment whose browser frontend is
the user's own application (design.md D20): such a frontend signs in through its own independent
server plugin, and the dashboard's `auth_required` banner is not its entry point.

#### Scenario: Validator accepts a well-formed login-provider claim
- **WHEN** a manifest declares a `login-provider` claim with a non-empty `component`
- **THEN** the validator accepts it as a known slot

#### Scenario: Validator rejects a login-provider claim without a component
- **WHEN** a manifest declares a `login-provider` claim with no `component`
- **THEN** the validator throws a manifest validation error naming the plugin and slot

#### Scenario: The claim transports only a component
- **WHEN** a manifest declares a `login-provider` claim
- **THEN** only a `component` name is transported, and no `startLogin` or other function is carried through the manifest

#### Scenario: Disabled plugin contributes no login provider
- **WHEN** the only plugin claiming `login-provider` is disabled in config
- **THEN** the slot contributes nothing and the core renders no login gate

#### Scenario: Only a trusted resolver's login-provider is honored
- **WHEN** an enabled plugin NOT in the current `identity.trustedResolverPlugins` allowlist claims `login-provider`, even at higher manifest priority than the trusted resolver
- **THEN** the core ignores the untrusted claim and mounts only the trusted resolver's login provider

#### Scenario: An independent frontend needs no login-provider
- **WHEN** the deployment's browser frontend is an independent application and no plugin claims `login-provider`
- **THEN** the slot contributes nothing, the core renders no login gate, and the independent frontend's own login is unaffected
