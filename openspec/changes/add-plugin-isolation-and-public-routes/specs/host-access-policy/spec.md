## ADDED Requirements

### Requirement: Plugins can detect whether a host access policy is in force

The plugin identity seam SHALL expose `hasHostPolicy(): boolean`, returning `true` only when identity is enforced AND exactly one host access policy is registered from the plugin named in `identity.trustedPolicyPlugin`. In every other state it SHALL return `false`. It SHALL be evaluated on every call (identity arming latches after plugins load, so a value read at plugin load time is not authoritative). It SHALL disclose no other information (no plugin id, no policy contents). A `true` result covers non-session host roads and plugin `authorize` actions only: session roads remain owner-gated and the break-glass local operator still bypasses the policy, so `hasHostPolicy()` SHALL NOT be documented or relied on as protection for either. The member SHALL be optional on the seam type so a plugin can feature-detect it; a plugin SHALL treat an absent member as "no policy".

#### Scenario: No policy configured
- **WHEN** no `identity.trustedPolicyPlugin` is configured
- **THEN** `hasHostPolicy()` returns `false` even though `authorize` returns `true`

#### Scenario: Policy registered and identity enforced
- **WHEN** identity is enforced and the named plugin has registered its policy
- **THEN** `hasHostPolicy()` returns `true`

#### Scenario: Policy registered but identity inert
- **WHEN** the named plugin registered a policy but identity is not enforced
- **THEN** `hasHostPolicy()` returns `false`

#### Scenario: Value tracks arming after plugin load
- **WHEN** a plugin calls `hasHostPolicy()` during its load (before identity arms) and again after identity is enforced with the policy registered
- **THEN** the first call returns `false` and the second returns `true`

#### Scenario: Named-but-absent policy
- **WHEN** `identity.trustedPolicyPlugin` names a plugin that registered no policy
- **THEN** `hasHostPolicy()` returns `false`
