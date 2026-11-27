# Spec Delta

## ADDED Requirements

### Requirement: Plugin-specific reduction SHALL come from the owning plugin's store policy

The store SHALL hold no built-in rule for any plugin's event types or tools. Every subagent rule this capability describes (elision, delta bounding and collapse, tail-subsumption guard, carrier detection, placeholder identity) SHALL apply only through the subagents plugin's store policy, with unchanged behavior. With the plugin absent, the generic rules alone SHALL apply.

#### Scenario: Plugin absent
- **GIVEN** the subagents plugin is not loaded
- **WHEN** an over-ceiling `subagent_completed` with `details.entries` is stored
- **THEN** it SHALL be bounded by the generic path only, with no entries elision

#### Scenario: Plugin present keeps today's elision
- **GIVEN** the subagents plugin is loaded
- **WHEN** an over-ceiling `subagent_completed` whose steps are all resident is stored
- **THEN** its `details.entries` SHALL be elided and `entryCount` kept, as before this change
