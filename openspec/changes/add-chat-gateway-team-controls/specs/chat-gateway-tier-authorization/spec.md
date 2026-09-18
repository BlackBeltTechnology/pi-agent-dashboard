## Purpose

Decides how much of the dashboard a given chat principal may drive, using the dashboard's existing observe/control/operate vocabulary, so a shared team channel is not an all-or-nothing grant. Layers under the gateway's own allowlist: it can only narrow what an already-admitted user may do.

## ADDED Requirements

### Requirement: Tier resolution from chat identity
Every action-bearing message or interaction SHALL resolve to exactly one tier (`observe`, `control`, `operate`) or to a refusal. Resolution SHALL consider the author's platform identifier first and mapped platform roles second; when both apply, the highest resulting tier wins. Principal entries and role mappings SHALL be scoped to a single binding — a principal mapped for one binding SHALL NOT thereby gain any tier in another.

#### Scenario: Unlisted user
- **WHEN** an allowlisted user with no matching identifier entry and no mapped role sends an action-bearing message in a bound channel
- **THEN** the request resolves to a refusal and no action is taken

#### Scenario: Identifier and role both grant
- **WHEN** a user is listed at `observe` by identifier and holds a role mapped to `control` on the same binding
- **THEN** the effective tier is `control`

#### Scenario: Principal mapped for a different binding
- **WHEN** a principal mapped at `control` for one binding acts in a different bound channel where they are not mapped
- **THEN** the request resolves to a refusal

### Requirement: Authorization is a single chokepoint
Every action-bearing request SHALL be authorized at one place that returns either a grant carrying the resolved tier, binding, and verb, or a refusal. No action path SHALL reach a session without a grant. Scope containment SHALL be evaluated inside that authorization, not as a separate check.

#### Scenario: Action attempted without a grant
- **WHEN** any code path attempts to drive a session without a grant from the chokepoint
- **THEN** no session is affected

#### Scenario: Target outside the binding's scope
- **WHEN** a request in a bound channel targets a session whose working directory lies outside that binding's workspace
- **THEN** the chokepoint refuses with a scope-violation reason and the session is unaffected

### Requirement: Refusals carry a specific reason
Every refusal SHALL identify which condition caused it, distinguishing at least: non-human author, unbound channel, no principal mapping, scope violation, disarmed plugin, non-delegable verb, and insufficient tier for the requested verb. A refusal SHALL NOT be reported or recorded as an undifferentiated absence of permission.

#### Scenario: Two refusals with different causes
- **WHEN** one request is refused because its author has no mapping and another because the layer is disarmed
- **THEN** each refusal reports and records its own distinct reason

#### Scenario: Refusal reason reaches the audit log
- **WHEN** any request is refused
- **THEN** the recorded log entry carries that specific reason

### Requirement: Verb tiers come from the dashboard's shared effective-tier table
The tier required by a verb SHALL be read from the dashboard's existing table of effective per-verb tiers rather than declared independently. The layer SHALL NOT recompute that derivation locally. A verb absent from the table, or absent from the layer's curated command allowlist, SHALL be refused.

#### Scenario: Verb tier changes in the shared table
- **WHEN** the dashboard's effective tier for a verb changes
- **THEN** the tier enforced for that verb changes with it, with no separate edit in this layer

#### Scenario: Verb outside the curated allowlist
- **WHEN** a request names a verb that is not in the layer's command allowlist
- **THEN** the request is refused even if the principal's tier would otherwise permit that verb's tier

### Requirement: Fail-closed default
Authorization SHALL default closed. A newly provisioned binding and an unconfigured layer SHALL grant no tier to anyone.

#### Scenario: Freshly provisioned binding
- **WHEN** a binding is created and no principals have been configured for it
- **THEN** every action-bearing request in that channel resolves to a refusal
- **AND** principals configured for other bindings gain no access to it

### Requirement: Operator-configurable ceiling
The layer SHALL enforce a configured maximum tier. A resolved tier above the ceiling SHALL be clamped to it. The ceiling SHALL default to `observe`.

#### Scenario: Ceiling clamps a grant
- **WHEN** the ceiling is `control` and a principal is configured at `operate`
- **THEN** that principal's effective tier is `control`

#### Scenario: Default ceiling on a fresh install
- **WHEN** the layer is enabled with no ceiling configured
- **THEN** the effective ceiling is `observe`

### Requirement: Non-delegable operate verbs
Regardless of configured tier or ceiling, the layer SHALL refuse verbs that mint credentials or alter provider, package, or tunnel state — specifically device-token minting, provider configuration writes, package installation, and tunnel connection. This deny-list SHALL NOT be configurable.

#### Scenario: Operate principal requests a device token
- **WHEN** a principal with effective tier `operate` invokes a command that would mint a paired-device token
- **THEN** the layer refuses and reports that the verb is not available over chat

### Requirement: Role mapping bounded and transparent
Platform roles MAY be mapped to tiers up to `control`. A role SHALL NOT be mappable to `operate`; `operate` SHALL require an explicit platform identifier. The configuration surface SHALL display, for each mapped role, which platform members are able to assign that role, and SHALL report when that information is unavailable rather than implying none exist.

#### Scenario: Attempt to map a role to operate
- **WHEN** an operator tries to map a role to `operate`
- **THEN** the setting is rejected with an explanation that `operate` requires an explicit identifier

#### Scenario: Delegation is surfaced
- **WHEN** a role mapped to `control` is assignable by members other than the guild owner
- **THEN** the configuration surface names those members alongside the mapping

#### Scenario: Delegation information unavailable
- **WHEN** the platform permission needed to enumerate members is absent
- **THEN** the surface states that the delegation list is unavailable and names the missing permission

### Requirement: Per-message tier re-resolution
Tier SHALL be re-resolved for every message and every interaction. The layer SHALL NOT cache a resolved tier across requests.

#### Scenario: Role removed mid-conversation
- **WHEN** a user's `control`-granting role is removed while a conversation is in progress
- **THEN** their next request resolves to a lower tier or a refusal without requiring a restart

### Requirement: Non-human message sources rejected
The layer SHALL refuse, for the purpose of driving any action, messages authored by bots and messages delivered via webhooks, ahead of every other authorization check. Content retrieved from links or attachments SHALL be treated as data, never as instruction to the layer.

#### Scenario: Webhook posts in a bound thread
- **WHEN** a webhook posts in a bound thread
- **THEN** the layer performs no action on it

#### Scenario: Bot author matches a configured principal
- **WHEN** a bot-authored message's identifier matches a configured principal entry
- **THEN** the request is still refused as a non-human author

### Requirement: Disarm switch
Any principal holding at least `observe` SHALL be able to disarm the layer. While disarmed, output SHALL continue to be mirrored but every action-bearing request from every principal SHALL be refused until an operator re-arms it from the dashboard.

#### Scenario: Observer disarms during a bad run
- **WHEN** an `observe` principal issues the disarm command
- **THEN** subsequent prompts, aborts, and commands from all principals are refused
- **AND** the disarmed state is visible on the dashboard configuration surface

#### Scenario: Re-arming requires the dashboard
- **WHEN** a `control` principal attempts to re-arm from chat
- **THEN** the layer refuses and the disarmed state persists

#### Scenario: Mirroring survives disarm
- **WHEN** the layer is disarmed and a bound session produces output
- **THEN** that output continues to appear in its thread

### Requirement: Configuration is editable only from the dashboard
Principals, role mappings, ceiling, mirror levels, and bindings SHALL be editable only through the dashboard configuration surface, never through a chat message at any tier.

#### Scenario: Attempt to change authorization from chat
- **WHEN** any principal, at any tier, sends a command intended to alter principals, tiers, ceiling, or filter settings
- **THEN** the layer refuses and takes no configuration action
