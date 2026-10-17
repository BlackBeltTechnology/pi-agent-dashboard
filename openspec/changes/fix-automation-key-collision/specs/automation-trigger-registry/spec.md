## MODIFIED Requirements

### Requirement: Central scheduler arms schedule triggers

A single server-owned scheduler SHALL arm every valid automation's trigger. The `schedule` trigger SHALL fire per its cron expression. On config change (create/edit/delete detected via fs.watch on `.pi/automation/`), the scheduler SHALL dispose the affected trigger and re-arm from the new definition.

Each automation definition SHALL be scheduled as its own independent unit, identified by its scope and the path at which its definition was discovered — not by its name alone. That path is the absolute, lexically normalized path; it is NOT canonicalized through symlinks or case folding, so one directory reached through two different spellings counts as two definitions. Two automations that share a name but are defined in different directories SHALL be armed, fired and disposed independently of each other.

A definition presented to the scheduler more than once at the same path SHALL be armed once. Re-arming a definition SHALL never leave an earlier trigger for that definition still able to fire.

#### Scenario: Cron fire triggers a run

- **WHEN** a `schedule` automation's cron time arrives
- **THEN** the scheduler SHALL invoke `fire(ctx)` for that automation exactly once for that occurrence.

#### Scenario: Edit re-arms cleanly

- **WHEN** an automation's `automation.yaml` cron changes on disk
- **THEN** the prior armed trigger SHALL be disposed and a new one armed from the updated file, with no duplicate firing.

#### Scenario: Same-named automations in different directories are both scheduled

- **WHEN** two different workspaces each define an automation with the same name
- **THEN** both automations SHALL be armed
- **AND** each SHALL fire on its own cron expression.

#### Scenario: Removing one same-named automation leaves the other running

- **WHEN** two different workspaces each define an automation with the same name
- **AND** one of the two definitions is deleted
- **THEN** the deleted automation SHALL stop firing
- **AND** the other SHALL remain armed and continue to fire.

#### Scenario: A definition presented twice at one location is armed once

- **WHEN** the scheduler is given the same automation definition twice at the same path in one arming pass
- **THEN** it SHALL be armed once
- **AND** a single cron occurrence SHALL produce a single fire.

#### Scenario: No trigger survives disposal

- **WHEN** an arming pass includes a definition presented more than once
- **AND** all armed automations are then disposed
- **THEN** no trigger SHALL fire afterwards.
