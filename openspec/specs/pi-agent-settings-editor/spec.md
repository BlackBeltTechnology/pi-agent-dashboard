# pi-agent-settings-editor Specification

## Purpose
Let a dashboard operator view and edit pi's GLOBAL `~/.pi/agent/settings.json` — through a typed
form for common settings and a raw JSON editor for every key — with validated, concurrency-safe,
lock-coordinated writes that apply to running sessions.

## Requirements

### Requirement: Read the global pi settings
Throughout this capability, `~/.pi/agent/settings.json` means `settings.json` in pi's agent directory:
`$PI_CODING_AGENT_DIR` (a leading `~` expanded) when set, else `~/.pi/agent`.

The dashboard SHALL expose a read of `~/.pi/agent/settings.json` returning the parsed settings object,
the raw file text, and a concurrency token. A leading byte-order mark SHALL be ignored when parsing. An
absent file SHALL read as an empty object with raw text `""` and token `"absent"`. An unparseable file
SHALL return its raw text, an empty settings object, a `parseError` message, and a token derived from
the raw bytes. The read SHALL be guarded by the same network guard as the dashboard config endpoints.
The project-scoped `<cwd>/.pi/settings.json` SHALL NOT be read.

#### Scenario: Existing file is returned with a token
- **GIVEN** `~/.pi/agent/settings.json` contains `{ "steeringMode": "all" }`
- **WHEN** a client reads the pi settings
- **THEN** the response SHALL contain `settings.steeringMode = "all"`, the raw file text, and a non-empty token

#### Scenario: Absent file reads as empty
- **GIVEN** `~/.pi/agent/settings.json` does not exist
- **WHEN** a client reads the pi settings
- **THEN** the response SHALL contain `settings = {}`, `raw = ""`, and token `"absent"`

#### Scenario: Unparseable file is surfaced, not hidden
- **GIVEN** the file contains `{ "steeringMode": ` (truncated JSON)
- **WHEN** a client reads the pi settings
- **THEN** the response SHALL contain the raw text and a `parseError`
- **AND** `settings` SHALL be `{}`

#### Scenario: Agent directory override is honoured
- **GIVEN** `PI_CODING_AGENT_DIR` is set to `/tmp/pi-alt` for the dashboard process
- **WHEN** a client reads or writes the pi settings
- **THEN** the dashboard SHALL use `/tmp/pi-alt/settings.json` and SHALL NOT touch `~/.pi/agent/settings.json`

#### Scenario: Byte-order mark is tolerated
- **GIVEN** the file starts with a UTF-8 BOM followed by `{ "steeringMode": "all" }`
- **WHEN** a client reads the pi settings
- **THEN** the response SHALL contain `settings.steeringMode = "all"` and no `parseError`

#### Scenario: Guarded like the config endpoints
- **WHEN** a request that fails the network guard reads the pi settings
- **THEN** the dashboard SHALL reject it exactly as it rejects `/api/config`

### Requirement: Typed patch of curated pi settings
The dashboard SHALL accept a typed PATCH limited to these keys: `compaction.enabled` (boolean),
`compaction.reserveTokens`, `compaction.keepRecentTokens`, `branchSummary.reserveTokens` (non-negative
integers), `branchSummary.skipPrompt` (boolean), `steeringMode`, `followUpMode` (`"all"` |
`"one-at-a-time"`), `defaultProjectTrust` (`"ask"` | `"always"` | `"never"`), `hideThinkingBlock`
(boolean), `quietStartup` (`true` | `false` | `"header"`). The patch SHALL address leaf keys only: only
provided leaves SHALL change; a `null` leaf SHALL delete that key; a whole block (`compaction`,
`branchSummary`) SHALL NOT be set to `null`. Every other key in the file, including unknown keys inside `compaction` and
`branchSummary`, SHALL survive unchanged. Any other key in the patch, or a value of the wrong type, SHALL
reject the whole patch with `400` and per-field errors, writing nothing; for a key outside the set the
error SHALL point to the raw JSON editor. When the current file is unparseable the patch SHALL be
rejected with `400` and a `parseError`, writing nothing.

#### Scenario: Patch changes only the provided key
- **GIVEN** the file contains `packages`, `retry`, and `compaction: { enabled: true, futureKnob: 1 }`
- **WHEN** a client patches `compaction.reserveTokens = 20000`
- **THEN** the file SHALL contain `compaction: { enabled: true, futureKnob: 1, reserveTokens: 20000 }`
- **AND** `packages` and `retry` SHALL be deep-equal to their prior values

#### Scenario: Null deletes a key
- **GIVEN** the file contains `steeringMode: "all"`
- **WHEN** a client patches `steeringMode = null`
- **THEN** the file SHALL NOT contain `steeringMode`

#### Scenario: Wrong type rejects the whole patch
- **WHEN** a client patches `{ steeringMode: "all", compaction: { reserveTokens: -1 } }`
- **THEN** the response SHALL be `400` naming `compaction.reserveTokens`
- **AND** the file SHALL be byte-identical to before

#### Scenario: Non-typed pi key is rejected with a pointer to JSON mode
- **WHEN** a client patches `{ shellPath: "/bin/sh" }`
- **THEN** the response SHALL be `400` naming `shellPath` and referring to the raw JSON editor
- **AND** nothing SHALL be written

#### Scenario: Patch over an unparseable file is refused
- **GIVEN** the file contains truncated JSON
- **WHEN** a client patches `steeringMode = "all"` with the matching token
- **THEN** the response SHALL be `400` with a `parseError`
- **AND** the file SHALL be byte-identical to before

### Requirement: Raw replacement of the whole file
The dashboard SHALL accept the full file text as a raw replacement. A body larger than 256 KiB SHALL be
rejected with `413`. Before any write it SHALL verify: valid JSON (a leading BOM ignored); root is a
plain object; every typed-patch key present has its typed-patch type; `retry` and `retry.provider`, when
present, are plain objects (not arrays) whose present fields obey the retry editor's rules (`enabled` boolean; `maxRetries`,
`maxAgentDelayMs`, `provider.maxRetries`, `provider.maxRetryDelayMs` non-negative integers;
`baseDelayMs`, `provider.timeoutMs` positive integers), with absent and unknown `retry` fields accepted; `extensions`, `prompts`, `themes`, `enabledModels`, `defaultTools`,
`npmCommand` are arrays of strings; `skills` is an array of strings or the legacy object form pi still
accepts; `packages` is an array of strings or objects;
`shellPath` and `shellCommandPrefix` are strings; `modelThinkingLevels` is an object whose values are
valid thinking levels. Keys not listed here SHALL NOT be type-checked and SHALL pass. A failure SHALL
return `400` with per-field errors and write nothing. A success SHALL write the object as 2-space-indented JSON with a trailing newline. An
unparseable current file SHALL NOT block a raw replacement carrying the matching token.

#### Scenario: Unknown keys are accepted and persisted
- **WHEN** a client submits raw text `{ "someFutureKey": { "a": 1 } }` with a fresh token
- **THEN** the write SHALL succeed and the file SHALL contain `someFutureKey`

#### Scenario: Partial retry block is accepted
- **WHEN** a client submits raw text `{ "retry": { "enabled": true, "maxAgentDelayMs": 5000 } }` with a fresh token
- **THEN** the write SHALL succeed

#### Scenario: Raw retry values obey the retry editor's rules
- **WHEN** a client submits raw text `{ "retry": { "baseDelayMs": 0 } }`, `{ "retry": 5 }`, or `{ "retry": { "provider": [] } }`
- **THEN** the response SHALL be `400` naming the `retry` field
- **AND** nothing SHALL be written

#### Scenario: Legacy skills object is accepted
- **WHEN** a client submits raw text `{ "skills": { "customDirectories": ["~/s"] } }` with a fresh token
- **THEN** the write SHALL succeed

#### Scenario: Invalid JSON is rejected
- **WHEN** a client submits raw text `{ "a": 1,, }`
- **THEN** the response SHALL be `400`
- **AND** the file SHALL be byte-identical to before

#### Scenario: Non-object root is rejected
- **WHEN** a client submits raw text `[1, 2]`
- **THEN** the response SHALL be `400` and nothing SHALL be written

#### Scenario: Wrong-typed command key is rejected
- **WHEN** a client submits raw text `{ "npmCommand": "curl x | sh" }`
- **THEN** the response SHALL be `400` naming `npmCommand`
- **AND** nothing SHALL be written

#### Scenario: Wrong array element type is rejected
- **WHEN** a client submits raw text `{ "enabledModels": [123] }`
- **THEN** the response SHALL be `400` naming `enabledModels`

#### Scenario: Oversize body is rejected
- **WHEN** a client submits raw text larger than 256 KiB
- **THEN** the response SHALL be `413` in the same error envelope as the other rejections
- **AND** nothing SHALL be written and no session SHALL be reloaded

#### Scenario: Raw replacement repairs an unparseable file
- **GIVEN** the file contains truncated JSON and the client holds its token
- **WHEN** the client submits valid raw text with that token
- **THEN** the write SHALL succeed and the file SHALL parse

### Requirement: Default-model keys are not writable through this editor
`defaultProvider`, `defaultModel`, and `defaultThinkingLevel` SHALL be owned by the dashboard's Default
model controls. A typed patch containing any of them SHALL be rejected with `400`. A raw replacement
SHALL write these three keys with their on-disk values at write time (present or absent), regardless of
the submitted text, and its response SHALL list in `restoredKeys` each of the three whose submitted
value differed from the written value.

#### Scenario: Raw edit of defaultModel does not take effect
- **GIVEN** the file contains `defaultModel: "claude-opus-5-5"`
- **WHEN** a client submits raw text with `defaultModel: "other"` and an otherwise valid body
- **THEN** the written file SHALL contain `defaultModel: "claude-opus-5-5"`
- **AND** the response SHALL list `defaultModel` in `restoredKeys`

#### Scenario: Raw removal of a default key does not take effect
- **GIVEN** the file contains `defaultProvider: "anthropic"`
- **WHEN** a client submits raw text without `defaultProvider`
- **THEN** the written file SHALL still contain `defaultProvider: "anthropic"`

#### Scenario: Typed patch of defaultThinkingLevel is rejected
- **WHEN** a client patches `defaultThinkingLevel = "high"`
- **THEN** the response SHALL be `400` and nothing SHALL be written

### Requirement: Optimistic concurrency on every write
Every typed or raw write SHALL carry the token from a previous read. The dashboard SHALL compare it to
the token of the file as it is at write time; on mismatch it SHALL return `409` with the current
settings, raw text, and token, and SHALL write nothing. The token SHALL ignore whitespace, key order, and
the three default-model keys. Every successful write SHALL return the post-write settings, raw text, and
token. Two cases are outside this guarantee and SHALL be documented to the operator: a change a running
pi process made in memory and flushes after a dashboard write wins for the fields that process changed;
and when the file does not exist yet, a pi process that read it as absent before the dashboard created it
may replace the dashboard-created file.

#### Scenario: Concurrent external edit yields a conflict
- **GIVEN** a client read the settings and holds token T
- **AND** another process then changes `steeringMode` in the file
- **WHEN** the client writes with base token T
- **THEN** the response SHALL be `409` with the new token and current content
- **AND** the other process's change SHALL remain in the file

#### Scenario: Reformatting or reordering alone is not a conflict
- **GIVEN** a client holds token T
- **AND** the file is rewritten with different whitespace and a different key order but identical content
- **WHEN** the client writes with base token T
- **THEN** the write SHALL succeed

#### Scenario: Default model and a pi setting changed in one Save converge in either order
- **GIVEN** a client holds token T and has a dirty typed patch `steeringMode = "all"`
- **AND** the user also changed the dashboard Default model to `anthropic/claude-opus-5-5`
- **WHEN** the unified Save commits both, in either order
- **THEN** the file SHALL contain `steeringMode: "all"` and `defaultModel: "claude-opus-5-5"`
- **AND** neither commit SHALL fail with `409`

#### Scenario: A later pi flush wins only for the field pi changed
- **GIVEN** a running pi process has changed `steeringMode` in memory and not yet flushed
- **WHEN** a dashboard patch sets `compaction.reserveTokens = 20000` and pi's flush runs afterwards
- **THEN** the file SHALL contain pi's `steeringMode` and `compaction.reserveTokens: 20000`

#### Scenario: Successful write re-baselines the client
- **WHEN** a typed patch succeeds
- **THEN** the response SHALL contain the token of the file as written
- **AND** a following write with that token SHALL NOT conflict

### Requirement: Writes coordinate with pi's own settings lock
Dashboard writes to `~/.pi/agent/settings.json` (this editor, the default-model mirror, and the retry
editor) SHALL take the same advisory file lock pi takes when it writes the file — including when the file
does not yet exist — SHALL re-read and re-check the token while holding it, and SHALL replace the file
atomically without blocking other dashboard requests while waiting. When the lock cannot be acquired
within pi's own retry budget the write SHALL fail with `503` and nothing SHALL be written; the retry
editor's save SHALL map this to `503` as well. The lock SHALL always be taken on the
settings path itself, exactly as pi does, even when that path is a symbolic link; in
that case the link SHALL be preserved and its target updated. The lock SHALL be held only for the
re-read, token check, and replacement — validation and serialisation of the submitted content SHALL
happen before it is taken.

#### Scenario: Lock held by another process blocks the dashboard write
- **GIVEN** the pi settings lock is held by another process for longer than the retry budget
- **WHEN** a client writes the pi settings
- **THEN** the response SHALL be `503`
- **AND** the file SHALL be byte-identical to before

#### Scenario: Waiting for the lock does not block other requests
- **GIVEN** the pi settings lock is held by another process for the whole retry budget
- **WHEN** a client writes the pi settings and, while that write waits, issues another dashboard request
- **THEN** the other request SHALL be answered in under 50 ms
- **AND** the waiting write SHALL then return `503`

#### Scenario: Retry editor reports a held lock
- **GIVEN** the pi settings lock is held for longer than the retry budget
- **WHEN** a client saves a retry policy
- **THEN** the response SHALL be `503` and nothing SHALL be written

#### Scenario: First write creates the file under the lock
- **GIVEN** `~/.pi/agent/settings.json` does not exist and the client holds token `"absent"`
- **WHEN** the client patches `steeringMode = "all"`
- **THEN** the file SHALL be created containing `steeringMode: "all"`

#### Scenario: Absent token against a now-existing file conflicts
- **GIVEN** the client holds token `"absent"` and another process then creates the file
- **WHEN** the client writes
- **THEN** the response SHALL be `409`

#### Scenario: Symlinked settings file stays a symlink
- **GIVEN** `~/.pi/agent/settings.json` is a symbolic link to another file
- **WHEN** a client patches `steeringMode = "all"`
- **THEN** `~/.pi/agent/settings.json` SHALL still be a symbolic link
- **AND** the link target SHALL contain `steeringMode: "all"`

#### Scenario: Symlinked settings file is locked on the link path
- **GIVEN** `~/.pi/agent/settings.json` is a symbolic link
- **AND** another process holds the lock on the `~/.pi/agent/settings.json` path for longer than the retry budget
- **WHEN** a client writes the pi settings
- **THEN** the response SHALL be `503` and the link target SHALL be byte-identical to before

#### Scenario: A failed replacement leaves the old file intact
- **WHEN** writing the replacement content fails before it is moved into place
- **THEN** `~/.pi/agent/settings.json` SHALL be byte-identical to before
- **AND** the response SHALL report the failure

### Requirement: Successful writes apply to running sessions
After a successful typed or raw write the dashboard SHALL dispatch a reload to every connected pi
session and SHALL return the number of sessions targeted. A rejected write SHALL reload nothing.

#### Scenario: Save reloads connected sessions
- **GIVEN** two connected pi sessions
- **WHEN** a typed patch succeeds
- **THEN** both sessions SHALL receive a reload and the response SHALL report `reloadedSessions = 2`

#### Scenario: Rejected write reloads nothing
- **WHEN** a write is rejected with `400`, `409`, `413`, or `503`
- **THEN** no session SHALL receive a reload

### Requirement: Explicit drift repair for the default model
The dashboard SHALL expose an action that writes pi's `defaultProvider`/`defaultModel` and
`defaultThinkingLevel` from the CURRENT dashboard `defaultModel`/`defaultThinkingLevel`, applying the same
rules as the save-time mirror (empty value leaves pi untouched; a model with no `/` is skipped; an
unparseable pi file is never overwritten). It SHALL NOT reload sessions. A dashboard value derives a pi
value only when it is non-empty and, for the model, contains `/`. The pi settings section SHALL offer
this action only when at least one derived value exists and differs from pi's value.

#### Scenario: Pre-existing drift is repaired
- **GIVEN** the dashboard `defaultModel` is `anthropic/claude-opus-5-5` and pi's `defaultModel` is `claude-opus-5`
- **WHEN** the user triggers "Apply dashboard default to pi"
- **THEN** pi's `defaultProvider` SHALL be `"anthropic"` and `defaultModel` SHALL be `"claude-opus-5-5"`

#### Scenario: Empty or separator-less dashboard value is never drift
- **GIVEN** the dashboard `defaultModel` is empty or has no `/`, and its thinking level is empty
- **WHEN** the pi settings section renders
- **THEN** the drift-repair action SHALL NOT be shown, whatever pi's values are

#### Scenario: No action offered without drift
- **GIVEN** pi's default keys equal the values derived from the dashboard config
- **WHEN** the pi settings section renders
- **THEN** the drift-repair action SHALL NOT be shown

### Requirement: pi settings section on Settings → Sessions
The Sessions settings page SHALL render a "pi settings (global)" section after the Retry section, with a
Form mode (typed fields plus read-only default-model keys labelled as mirrored from the Default model
control) and a JSON mode (full-file editor). Edits SHALL commit through the panel's unified Save, mark
the page dirty, and participate in the unsaved-changes guard; the section SHALL NOT render its own Save
button. The section SHALL hold a draft for one mode at a time: switching mode with a dirty draft SHALL
ask the user to discard or stay, and SHALL never convert a dirty draft between modes. A `409` SHALL show
a conflict notice offering to reload from disk, which discards the draft, and SHALL NOT retry
automatically. A `400` SHALL show the per-field errors and keep the draft dirty. In JSON mode, a draft
that changed a default-model key SHALL show a notice before saving that those keys are managed by the
Default model control. The section SHALL state that saving reloads running sessions, and that it edits
the global file only while a project `<cwd>/.pi/settings.json` may override these values at runtime. A
`413` or `503` SHALL be shown like any failed commit, keeping the draft dirty.

#### Scenario: Form edit commits through unified Save
- **WHEN** the user changes Steering mode in Form mode and presses the panel Save
- **THEN** the typed patch SHALL be sent and, on success, the page SHALL no longer be dirty

#### Scenario: Conflict offers reload, never silent overwrite
- **GIVEN** a save returns `409`
- **THEN** the section SHALL show a conflict notice with a "Reload from disk" action
- **AND** SHALL NOT retry the write automatically

#### Scenario: Default-model keys are read-only in Form mode
- **WHEN** the Form mode renders
- **THEN** `defaultProvider`, `defaultModel`, and `defaultThinkingLevel` SHALL be displayed as non-editable values with a note pointing to the Default model control

#### Scenario: Validation errors keep the draft
- **GIVEN** the user enters invalid JSON in JSON mode
- **WHEN** the user presses Save
- **THEN** the section SHALL show the error and remain dirty

#### Scenario: Switching mode with a dirty draft asks first
- **GIVEN** the Form mode draft is dirty
- **WHEN** the user selects JSON mode
- **THEN** the section SHALL ask to discard or stay
- **AND** choosing stay SHALL keep Form mode with the draft intact
- **AND** choosing discard SHALL show JSON mode with the last-loaded content

#### Scenario: Editing a managed key in JSON mode is flagged before save
- **GIVEN** the user changes `defaultModel` in the JSON draft
- **THEN** the section SHALL show a notice that the key is managed by the Default model control and will not be written
