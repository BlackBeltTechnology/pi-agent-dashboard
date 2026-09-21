## Purpose

Extends the frozen slot taxonomy with one slot, `login-provider`, so a resolver plugin can supply the browser login mechanics (OIDC discovery, PKCE, callback code exchange) as a detachable client contribution — keeping the dashboard core free of any provider-specific login code.

## ADDED Requirements

### Requirement: `login-provider` slot

The slot taxonomy SHALL include a slot id `login-provider`. A plugin claiming `login-provider` SHALL supply the browser login mechanics: a `startLogin` entry that begins the provider's authorization flow, and a callback component the core mounts on its pre-auth `/callback` route to complete the flow. The manifest validator SHALL accept a `login-provider` claim and SHALL require its `component` to be a non-empty string.

The core SHALL honor a `login-provider` claim ONLY from a plugin listed in `identity.trustedResolverPlugins` and currently active; manifest priority SHALL NOT select the login provider (the redirect-to-IdP and code-exchange path is a trust boundary, not an ordering concern). When no trusted, active plugin claims `login-provider`, the slot SHALL contribute nothing and the core SHALL render no login gate. The mount that renders the callback component before the authed shell SHALL apply the enabled-plugin filter itself, so a disabled or untrusted plugin contributes nothing even pre-shell.

#### Scenario: Validator accepts a well-formed login-provider claim
- **WHEN** a manifest declares a `login-provider` claim with a non-empty `component`
- **THEN** the validator accepts it as a known slot

#### Scenario: Validator rejects a login-provider claim without a component
- **WHEN** a manifest declares a `login-provider` claim with no `component`
- **THEN** the validator throws a manifest validation error naming the plugin and slot

#### Scenario: Disabled plugin contributes no login provider
- **WHEN** the only plugin claiming `login-provider` is disabled in config
- **THEN** the slot contributes nothing and the core renders no login gate

#### Scenario: Only a trusted resolver's login-provider is honored
- **WHEN** an enabled plugin NOT listed in `identity.trustedResolverPlugins` claims `login-provider`, even at higher manifest priority than the trusted resolver
- **THEN** the core ignores the untrusted claim and mounts only the trusted resolver's login provider
