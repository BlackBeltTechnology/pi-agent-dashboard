## Purpose

Decides which Discord identities may drive the dashboard and at what privilege level, reusing the dashboard's existing observe/control/operate tier vocabulary so a chat surface can never exceed what an operator deliberately granted.

## ADDED Requirements

### Requirement: Tier resolution from Discord identity
The plugin SHALL resolve every inbound Discord message or interaction to exactly one tier drawn from the dashboard's existing tier vocabulary (`observe`, `control`, `operate`), or to no tier at all. Resolution SHALL consider the author's snowflake first and mapped Discord roles second; when both apply, the highest resulting tier wins.

#### Scenario: Unlisted user
- **WHEN** a guild member with no matching snowflake entry and no mapped role sends a message in a bound channel
- **THEN** the plugin resolves no tier and takes no action

#### Scenario: Snowflake and role both grant
- **WHEN** a user is listed at `observe` by snowflake and holds a role mapped to `control`
- **THEN** the effective tier is `control`

### Requirement: Fail-closed default
Authorization SHALL default closed. A newly bound channel, a newly created binding, and an unconfigured plugin SHALL grant no tier to anyone.

#### Scenario: Freshly bound channel
- **WHEN** a channel is bound to a workspace and no principals have been configured for it
- **THEN** every message in that channel resolves to no tier

### Requirement: Operator-configurable ceiling
The plugin SHALL enforce a configured maximum tier. A resolved tier above the ceiling SHALL be clamped to the ceiling. The ceiling SHALL default to `observe`.

#### Scenario: Ceiling clamps a grant
- **WHEN** the ceiling is `control` and a principal is configured at `operate`
- **THEN** that principal's effective tier is `control`

### Requirement: Non-delegable operate verbs
Regardless of configured tier or ceiling, the plugin SHALL refuse to invoke verbs that mint credentials or alter provider, package, or tunnel state — specifically device-token minting, provider configuration writes, package installation, and tunnel connection. This deny-list SHALL NOT be configurable.

#### Scenario: Operate principal requests a device token
- **WHEN** a principal with effective tier `operate` invokes a command that would mint a paired-device token
- **THEN** the plugin refuses and reports that the verb is not available over Discord

### Requirement: Role mapping bounded and transparent
Discord roles MAY be mapped to tiers up to `control`. A role SHALL NOT be mappable to `operate`; `operate` SHALL require an explicit snowflake. The settings surface SHALL display, for each mapped role, which guild members are able to assign that role.

#### Scenario: Attempt to map a role to operate
- **WHEN** an operator tries to map a Discord role to `operate`
- **THEN** the setting is rejected with an explanation that `operate` requires a snowflake

#### Scenario: Delegation is surfaced
- **WHEN** a role mapped to `control` is assignable by guild members other than the guild owner
- **THEN** the settings surface names those members alongside the mapping

### Requirement: Per-message tier re-resolution
Tier SHALL be re-resolved for every message and every interaction. The plugin SHALL NOT cache a resolved tier across messages.

#### Scenario: Role removed mid-conversation
- **WHEN** a user's `control`-granting role is removed while a thread conversation is in progress
- **THEN** their next message resolves to no tier (or to a lower tier from another source) without requiring a plugin restart

### Requirement: Non-principal message sources rejected
The plugin SHALL ignore, for the purpose of driving any action, messages authored by bots and messages delivered via webhooks. Content the agent retrieves from links or attachments SHALL be treated as data, never as instruction to the plugin.

#### Scenario: Webhook posts in a bound thread
- **WHEN** a guild webhook posts a message in a bound thread
- **THEN** the plugin performs no action on it

#### Scenario: Another bot posts in a bound thread
- **WHEN** a message whose author is flagged as a bot appears in a bound thread
- **THEN** the plugin performs no action on it

### Requirement: Disarm switch
Any principal holding at least `observe` SHALL be able to disarm the plugin. While disarmed, the plugin SHALL continue mirroring but SHALL refuse every action-bearing command from every principal until an operator re-arms it from the dashboard.

#### Scenario: Observer disarms during a bad run
- **WHEN** an `observe` principal issues the disarm command
- **THEN** subsequent prompts, aborts, and commands from all principals are refused
- **AND** the disarmed state is visible in the dashboard settings surface

#### Scenario: Re-arming requires the dashboard
- **WHEN** a `control` principal attempts to re-arm from Discord
- **THEN** the plugin refuses and the disarmed state persists
