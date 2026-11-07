## ADDED Requirements

### Requirement: pi 1.4.0–1.5.0 changes SHALL be recorded as adopted, not consumed, or no-ops

The adoption record SHALL classify every pi 1.4.0–1.5.0 change that reaches a dashboard surface as adopted, audited but not consumed, or a documented no-op, and SHALL give the reason for each. The scenarios below list the items.

#### Scenario: Adopted items are recorded
- **WHEN** the change is archived
- **THEN** the record SHALL name as adopted the floor raise to 1.5.0, with the extension `typebox` devDependency restated as the loader-alias pin (`pi-core-version-check`)
- **AND** project-trust precedence, where a recorded entry decides before implicit trust (`pi-trust-mirror`)
- **AND** `"disabled"` for `httpIdleTimeoutMs` / `websocketConnectTimeoutMs`, added to the `docs/settings.md` type column in 1.5.0 (pi's runtime parser has accepted it and pi's settings JSON schema has described it since 1.3.0; the typed PATCH accepts exactly that spelling), and the new `compaction.reserveTokens` description (`pi-agent-settings-editor`)
- **AND** the `SystemRoot`-aware WSL-launcher check and the `access(F_OK)` existence check, both shipped in 1.4.0 (`windows-git-bash-runtime`)
- **AND** BOM-tolerant `mcp.json` reads (`mcp-client-config`), also in the blender and craft-apps `mcp-register` readers
- **AND** the `!`/`!!`/slash-exec exit status read from `pi.exec`'s `ExecResult.code`; pi has no `exitCode` field, so a pre-existing defect forwarded every exit as `0`, and with 1.5 an over-cap (`truncated`) run as a success (`bash-execution`)
- **AND** trust-path comparison by pi's `pathsEqual` (both paths resolved; case-insensitive on Windows) in three places: the bridge's recorded-entry check, so a refusal saved with different casing or under a non-normalised key withholds the bridge's yes (`pi-trust-mirror`); the remote-trust digest's exclusion of the user's own `.agents/skills` (`pi-trust-mirror`); and the resource-toggle gate's own-folder check, because pi's `getEntry` now returns the stored key spelling (`cross-scope-resource-disable`). The host predicate reads through pi's `ProjectTrustStore` and inherits the match
- **AND** the pi-written `extensionChangelogVersions` key in the read-only managed list, and the new `collapseChangelog` description as its hint (`pi-agent-settings-editor`)
- **AND** `minimatch` `^11.0.3` for the shared `enabledModels` matcher, in lockstep with pi's `resolveModelScope`
- **AND** tool-argument validation on `@earendil-works/pi-schema`: tests asserting pi's argument-validation semantics drive pi-ai's `validateToolArguments`, and validator-wording fixtures use pi-schema's `- <path>: <message>` lines; the `Validation failed for tool "<name>":` prefix the ctx renderer keys on is unchanged

#### Scenario: Audited items are recorded with reasons
- **WHEN** the change is archived
- **THEN** the record SHALL name as audited but not consumed `Usage.cost.totalFromProvider` and `AssistantMessage.responseModel` (no consumer)
- **AND** `pi.changelogPath` and condensed extension changelogs (the dashboard has its own changelog UI)
- **AND** `pi.exec({ maxBuffer })`: the bridge's only caller (the `!`/`!!`/slash-exec path) keeps pi's default cap; `truncated` / `killed` are not surfaced separately, because an over-cap run already carries a nonzero `code`
- **AND** `ctx.ui.custom({ blocked })` (no caller), `keyText` / `keyHint` (no pi keybinding rendering), and `MarkdownTransformContext` `messageId` / `timestamp` (not rendered through pi)
- **AND** `selfUpdateCommand` / `PI_SELF_UPDATE_COMMAND`, deliberately left out of the typed form and reachable only through the raw JSON editor: its value is an argv array with `{packageName}` / `{version}` / `{installSpec}` placeholders, for which the typed editor has no control (like `npmCommand`); it is read from agent-directory settings only and `PI_SELF_UPDATE_COMMAND` takes precedence; and the dashboard's pi-core updater runs `npm`, not `pi update`
- **AND** MCP OAuth `clientRegistration: "auto"` and the CIMD default (the dashboard's mirror of pi's entry rules does not validate the field, and the writer writes no `oauth`)
- **AND** the OAuth `device_code` login-event options `openBrowserOnConfirm` / `copyCodeOnConfirm` (pi: clients may ignore them; the dashboard copies only `userCode`, `verificationUri`, `intervalSeconds` and `expiresInSeconds`)
- **AND** pi-ai no longer re-exporting TypeBox (no dashboard file imports `Type`, `Static` or `TSchema` from `@earendil-works/pi-ai` or `@earendil-works/pi-coding-agent`; extensions import `typebox`, which pi's loader aliases)

#### Scenario: Documented no-ops are recorded with reasons
- **WHEN** the change is archived
- **THEN** the record SHALL list as no-ops: OpenRouter cost totals now billed (usage totals sum `cost.total`, so values shift with no code change)
- **AND** changes or fixes inside pi: compaction triggering; extension tools default-active on resume and `setActiveTools` ordering (the `context-budget` filter is order-preserving); the session-write-failure in-memory state; the `/tree` summary and terminal-title escape fixes; `pi install`/`remove` symlink and nested-lock handling and npm audit output; provider attribution headers (no `before_provider_headers` handler); default-model and provider catalogue changes (no hard-coded model ids)
- **AND** TUI-only changes: keybinding hints, Apple Terminal Shift+Enter, Rex OSC sequences, and `terminal.clearOnShrink`'s `PI_CLEAR_ON_SHRINK` fallback
- **AND** the pi-ai OAuth provider modules (`github-copilot`, `kimi-coding`, `meta`, `radius`): verification and authorization URLs now pass the shared `trustedHttpUrl` check inside pi, with no change to the login-event shape the dashboard consumes
- **AND** the removed `examples/extensions/sandbox/` (referenced only by research prose) and the `@earendil-works/pi-ai/models` subpath for extensions (the dashboard imports the pi-ai root only)

#### Scenario: selfUpdateCommand is not a typed form row
- **WHEN** the pi settings page renders in Form mode
- **THEN** no editable control for `selfUpdateCommand` SHALL be offered
- **AND** a typed PATCH naming `selfUpdateCommand` SHALL be rejected with `400` pointing to the raw JSON editor
