# goal-plugin-command-surface-tiering Specification

## Purpose

The goal-plugin server probes the detected command surface of the running `pi-goal-hermes` extension and classifies it into one of three coupling tiers. The tier decides how much of a goal's config the dashboard pushes into the live loop versus enforces itself, what `/goal …` command grammar is emitted for browser control actions, and whether control actions are suppressed entirely.

## Requirements

### Requirement: Command surface tier classification

The plugin SHALL map a detected command surface descriptor to exactly one of the tiers `full`, `criteria-dashboard-budget`, or `intent-only`, defaulting to `intent-only` when no surface is known.

#### Scenario: Surface accepts structured config

- **WHEN** the detected surface reports `acceptsConfig` truthy
- **THEN** the tier is `full`

#### Scenario: Surface accepts only subgoal

- **WHEN** the detected surface reports `acceptsConfig` falsy but `acceptsSubgoal` truthy
- **THEN** the tier is `criteria-dashboard-budget`

#### Scenario: Surface known but accepts neither

- **WHEN** the detected surface reports neither `acceptsConfig` nor `acceptsSubgoal`
- **THEN** the tier is `intent-only`

#### Scenario: Surface absent or unknown

- **WHEN** no surface descriptor is provided (extension absent or unknown)
- **THEN** the tier falls back to `intent-only`

### Requirement: Sanitized config command grammar

The plugin SHALL emit a `/goal config` command with sanitized arguments only for the `full` tier, and SHALL return no command for any other tier or when no valid argument remains.

#### Scenario: Full tier with judge and budget

- **WHEN** the tier is `full` and config supplies a judge with provider and modelId, a positive finite `maxTurns`, and a positive finite `maxSpendUsd`
- **THEN** the emitted command is `/goal config` followed by `--judge <provider>/<modelId>`, `--max-turns <maxTurns>`, and `--max-spend <maxSpendUsd>`

#### Scenario: Argument sanitization

- **WHEN** a judge provider or modelId contains whitespace, slashes, quotes, backticks, backslashes, or control characters
- **THEN** those characters are stripped before the argument is placed in the command
- **AND** if nothing usable remains for provider or modelId, the `--judge` clause is omitted

#### Scenario: Non-positive or non-finite budget values

- **WHEN** `maxTurns` or `maxSpendUsd` is undefined, non-finite, zero, or negative
- **THEN** the corresponding `--max-turns` or `--max-spend` clause is omitted

#### Scenario: No usable config

- **WHEN** the tier is `full` but no valid judge or budget clause can be produced
- **THEN** no command is emitted (null)

#### Scenario: Non-full tier config request

- **WHEN** the tier is not `full`
- **THEN** `goalConfigCommand` returns null and no config command is emitted

### Requirement: Dashboard-side budget enforcement decision

The plugin SHALL enforce budget on the dashboard side only for the `criteria-dashboard-budget` tier; the `full` tier delegates budget into the loop and `intent-only` records without coupling.

#### Scenario: Dashboard budget tier

- **WHEN** the tier is `criteria-dashboard-budget`
- **THEN** budget enforcement is dashboard-side

#### Scenario: Non-dashboard budget tiers

- **WHEN** the tier is `full` or `intent-only`
- **THEN** budget enforcement is not dashboard-side

### Requirement: Control action dispatch and intent-only suppression

The plugin SHALL translate browser control actions into `/goal …` command text and dispatch it to the session, except under the `intent-only` tier where all control actions are suppressed with no loop coupling.

#### Scenario: Intent-only suppresses control

- **WHEN** a `plugin_action` control arrives and the tier is `intent-only`
- **THEN** the action is logged as suppressed and no command is dispatched into the session

#### Scenario: Set, subgoal, and lifecycle actions

- **WHEN** a control action `set` or `subgoal` carries a non-empty goal text, or an action `pause`/`resume`/`done`/`clear` is received, under a non-`intent-only` tier
- **THEN** the plugin emits `/goal <text>`, `/subgoal <text>`, or `/goal <action>` respectively and dispatches it to the session

#### Scenario: Command builder defaults tier to intent-only

- **WHEN** `goalCommandFor` is called without an explicit tier argument
- **THEN** the tier parameter defaults to `intent-only`

#### Scenario: Config action under non-full tier

- **WHEN** a `config` control action is received under the `criteria-dashboard-budget` tier
- **THEN** `goalCommandFor` calls `goalConfigCommand`, which yields null, so no command is produced

#### Scenario: Valid config action shares the malformed no-dispatch path

- **WHEN** a well-formed `config` control action arrives under the `criteria-dashboard-budget` tier
- **THEN** the produced command is null and control falls through to the same `logger.warn("unknown or malformed goal action")` branch as a malformed action, dispatching nothing — the two are not distinct outcomes

#### Scenario: Unknown or malformed action

- **WHEN** a control action is unrecognized or its required text is empty under a non-`intent-only` tier
- **THEN** no command is produced and the action is logged as unknown or malformed
