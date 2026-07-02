## MODIFIED Requirements

### Requirement: automation.yaml schema

`automation.yaml` SHALL declare `on` (trigger block with `kind`), `action`, `model` (bare provider/model id or `@role`), `mode` (`worktree` | `local`), `sandbox` (`read-only` | `workspace-write` | `full-access`), `concurrency` (`skip` | `queue` | `parallel`, default `skip`), and an OPTIONAL `visibility` (`hidden` | `shown`) overriding the settings-level default.

The `action` block SHALL declare `kind` set to a registered action id. Built-in ids are `core.prompt` (with a `prompt` path) and `core.skill` (with a `skill` token); a bare `kind: prompt` or `kind: skill` SHALL be accepted and normalized to the corresponding `core.*` id for backward compatibility. Plugin-registered ids SHALL use the namespaced form `<source>.<verb>`. The `action` block MAY declare an OPTIONAL `payload` map whose keys correspond to the action's `payloadSchema` fields.

`action.kind` SHALL be validated against the live action registry: an id with no registered handler SHALL fail validation, mark the automation invalid in the view with an error naming the id, and SHALL NOT prevent other automations from loading. Unknown trigger `kind` values SHALL likewise fail validation, mark the automation invalid, and SHALL NOT prevent other automations from loading.

#### Scenario: Minimal valid automation (built-in action)

- **WHEN** `automation.yaml` declares `on.kind: schedule`, `on.cron: "0 9 * * 1"`, `action.kind: prompt`, `model: "@fast"`, `mode: worktree`, `concurrency: skip`
- **THEN** it SHALL parse as valid, with `action.kind` normalized to `core.prompt`.

#### Scenario: Plugin action with payload

- **WHEN** `automation.yaml` declares `action.kind: flows.run` and `action.payload: { flow: "nightly-build-and-tag", task: "build and tag" }`, and `flows.run` is registered
- **THEN** it SHALL parse as valid and the payload SHALL be carried to dispatch.

#### Scenario: Unknown action id isolates failure

- **WHEN** an automation declares `action.kind: slack.post` and no registered action handles `slack.post`
- **THEN** that automation SHALL be marked invalid with an error naming the id, and sibling automations SHALL still load and arm.

#### Scenario: Unknown trigger kind isolates failure

- **WHEN** an automation declares `on.kind: slack.message` and no registered trigger handles `slack.message`
- **THEN** that automation SHALL be marked invalid with an error naming the kind, and sibling automations SHALL still load and arm.
