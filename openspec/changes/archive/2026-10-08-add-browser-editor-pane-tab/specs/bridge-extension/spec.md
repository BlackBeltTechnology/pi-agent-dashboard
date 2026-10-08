## ADDED Requirements

### Requirement: Dialog prompts carry namespaced plugin metadata

When a tool raises a dashboard dialog (`confirm`, `select`, `input` and the other dialog methods) with an options object containing `pluginMeta`, the bridge SHALL copy `pluginMeta` into the prompt's metadata under the key `plugin`. This applies even when the dialog has no message and no tool-call id. The value SHALL be accepted only if:
- it is a plain object;
- it serializes to JSON without error;
- the serialization is at most 2048 UTF-8 bytes. The bridge SHALL NOT let `pluginMeta` set or override any other metadata key (including `message`, `toolCallId` and `kind`).

When the value is non-serializable or too large, the bridge SHALL drop it, raise the prompt without it, and log a warning.

#### Scenario: Plugin metadata reaches the prompt
- **WHEN** a tool calls `ctx.ui.confirm("Browser needs you", "Sign in", {pluginMeta: {pluginId: "browser", kind: "browser-takeover", instanceId: "inst-1"}})`
- **THEN** the resulting `prompt_request` metadata SHALL contain `plugin: {pluginId: "browser", kind: "browser-takeover", instanceId: "inst-1"}`

#### Scenario: Plugin metadata cannot spoof core keys
- **WHEN** `pluginMeta` contains `kind: "file-access"` or `toolCallId: "x"`
- **THEN** those values SHALL appear only inside `metadata.plugin`, and the top-level `metadata.kind` and `metadata.toolCallId` SHALL be unaffected

#### Scenario: Metadata-only dialog
- **WHEN** a tool calls `ctx.ui.select("Pick", ["a", "b"], {pluginMeta: {pluginId: "p"}})` with no message and no tool-call id
- **THEN** the resulting `prompt_request` metadata SHALL contain `plugin: {pluginId: "p"}`

#### Scenario: Non-plain value is dropped
- **WHEN** `pluginMeta` is a class instance, or contains a `BigInt`
- **THEN** the prompt SHALL be raised without `metadata.plugin`

#### Scenario: Oversized plugin metadata is dropped
- **WHEN** `pluginMeta` serializes to more than 2 KiB
- **THEN** the prompt SHALL be raised without `metadata.plugin`
