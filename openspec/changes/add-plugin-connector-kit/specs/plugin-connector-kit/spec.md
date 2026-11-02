## ADDED Requirements

### Requirement: Connector kit subpath

`@blackbelt-technology/dashboard-plugin-runtime` SHALL export a `./connector` subpath. It SHALL export `registerConnectorTools`, `registerConnectorServer`, `ConnectorError`, `toFailure` and `redact`, and re-export the connector contract types from `packages/shared/src/dashboard-plugin/connector.ts`. The subpath SHALL NOT import React, pi or the runtime's `./server` barrel, and SHALL compile under `erasableSyntaxOnly`.

#### Scenario: Subpath stays light
- **WHEN** the module graph of `./connector` is listed
- **THEN** it SHALL contain no `react`, no `@earendil-works/*` module and no file under `dashboard-plugin-runtime/src/server/`

#### Scenario: Runtime plugin imports source directly
- **WHEN** a runtime-installed plugin's server entry imports `@blackbelt-technology/dashboard-plugin-runtime/connector` under Node type stripping
- **THEN** the import SHALL load without a transpile step

### Requirement: Stable connector error codes

The connector contract SHALL define a closed `ConnectorErrorCode` union and a frozen `CONNECTOR_ERROR_CODES` array that lists exactly the same codes. An operation result SHALL be `{ok: true, data}` or `{ok: false, code, message, details?}`. A failure SHALL never carry a stack trace. The code `lane_timeout` SHALL mean "outcome unknown": the request may have reached the provider, and the agent must check before retrying.

#### Scenario: The code set
- **WHEN** `CONNECTOR_ERROR_CODES` is read
- **THEN** it SHALL equal, in any order: `missing_credential`, `credential_unreadable`, `keychain_unavailable`, `host_unsupported`, `auth_failed`, `writes_disabled`, `confirmation_unavailable`, `confirmation_timeout`, `declined`, `invalid_input`, `not_found`, `duplicate`, `rate_limited`, `provider_unavailable`, `provider_error`, `lane_unavailable`, `lane_timeout`, `internal`

#### Scenario: Unknown error becomes internal
- **WHEN** `toFailure(new TypeError("boom"))` is called
- **THEN** it SHALL return `{ok: false, code: "internal", message: "boom"}` with no `stack` property

### Requirement: Connector field contract

`ConnectorField` SHALL be `{name, label, kind, required?, options?, help?, default?}`, where `kind` is one of `text`, `secret`, `select` or `boolean`. `options` SHALL be required for, and only allowed on, `select`. `required` SHALL apply to `text`, `secret` and `select`; `required` on a `boolean` field SHALL be invalid. `default` SHALL be a string for `text`/`select` (a select default SHALL be one of its options), a boolean for `boolean`, and SHALL NOT be allowed on `secret`.

#### Scenario: Secret default refused
- **WHEN** a spec declares a `secret` field with a `default`
- **THEN** `registerConnectorServer` SHALL throw and SHALL register no route

#### Scenario: Required boolean refused
- **WHEN** a spec declares a `boolean` field with `required: true`
- **THEN** `registerConnectorServer` SHALL throw and SHALL register no route, and `validateConnectorFields` SHALL report that field as invalid

### Requirement: Connector field values are capped

A stored `text`, `secret` or `select` value SHALL be a string of at most 4 KiB in UTF-8. A `boolean` value SHALL be a boolean.

#### Scenario: Value over the cap
- **WHEN** PUT sends a `text` value of 5 KiB
- **THEN** the response SHALL be 400 with `error: "invalid_input"` naming the field label, and nothing SHALL be stored

### Requirement: Connector tools are namespaced codemode tools

`registerConnectorTools(pi, {pluginId, connectorId, title, tools})` SHALL register one pi tool per tool spec. Each tool SHALL be named `<connectorId>_<tool>`, use `exposure: "codemode"`, and set `namespace.name` to `connectorId`. Its annotations SHALL be `readOnlyHint = !write`, `destructiveHint = (destructive === true)`, `idempotentHint = !write` and `openWorldHint = true`. A write tool's description SHALL start with `[WRITE] `.

#### Scenario: Read tool shape
- **WHEN** connector `nav` registers tool `lookup` with `write: false`
- **THEN** pi SHALL receive a tool named `nav_lookup` with `exposure: "codemode"`, `namespace.name: "nav"` and `annotations.readOnlyHint: true`

#### Scenario: Destructive write shape
- **WHEN** connector `nav` registers tool `cancel` with `write: true, destructive: true`
- **THEN** the tool's description SHALL start with `[WRITE] ` and its annotations SHALL have `readOnlyHint: false` and `destructiveHint: true`

### Requirement: Invalid connector tool names refuse registration

`registerConnectorTools` SHALL throw before registering any tool when a resulting tool name does not match `^[a-z][a-z0-9_]*$` or is longer than 64 characters.

#### Scenario: Invalid name refuses the whole set
- **WHEN** a tool spec list contains `lookup` and `Bad-Name`
- **THEN** `registerConnectorTools` SHALL throw, and pi SHALL have received no tool

### Requirement: Every connector write asks for confirmation

Before calling the server, a write tool SHALL call `ctx.ui.confirm(title, body, opts)`. `opts` SHALL carry a positive `timeout`, an AbortSignal `signal`, the tool call id as `toolCallId`, and `pluginMeta {pluginId, kind: "connector-write", connector, tool, destructive}`. The body SHALL show the complete serialized call parameters, and SHALL state that a destructive action cannot be undone. A read tool SHALL NOT ask. A write tool SHALL send no lane request unless the answer is `true`.

#### Scenario: Confirmation options
- **WHEN** write tool `nav_cancel` runs with tool call id `tc1`
- **THEN** `ctx.ui.confirm` SHALL receive `opts.toolCallId: "tc1"`, a positive `opts.timeout`, an `opts.signal`, and `opts.pluginMeta.kind: "connector-write"`

#### Scenario: Read tools never ask
- **WHEN** a read tool runs
- **THEN** `ctx.ui.confirm` SHALL NOT be called

### Requirement: The confirmation body shows parameters literally

The kit SHALL put the pretty-printed JSON parameters in the confirmation body as one fenced code block with language tag `json`, whose backtick fence is longer than the longest backtick run in that JSON, so markdown rendering of the body cannot hide, link or reformat any parameter text. On the dashboard confirmation card the parameters SHALL appear verbatim inside that block. The kit makes no rendering guarantee for other confirmation surfaces (pi TUI, chat gateways).

#### Scenario: Markdown in parameters stays visible
- **WHEN** a write tool runs with parameters whose string values contain `<!-- x -->`, `[a](http://b)` and a run of three backticks
- **THEN** the body SHALL contain a fenced `json` block whose fence is at least four backticks long, and the dashboard card SHALL show all three values verbatim inside the code block

### Requirement: Oversized write parameters are refused, not truncated

The confirmation body SHALL NOT be truncated. The size is the UTF-8 byte length of the pretty-printed JSON that the confirmation body shows. When it exceeds 4 KiB (4096 bytes), the tool SHALL fail with `invalid_input` without asking and without sending a lane request.

#### Scenario: Oversized parameters are refused, not truncated
- **WHEN** a write tool runs with parameters whose pretty-printed JSON is 5 KiB
- **THEN** the tool SHALL fail with a message starting `[invalid_input]`, `ctx.ui.confirm` SHALL NOT be called, and no lane request SHALL be sent

### Requirement: Confirmation outcomes map to stable codes

A write tool SHALL fail with `confirmation_unavailable` when `ctx.hasUI` is not true or `ctx.ui.confirm` is missing. It SHALL fail with `declined` when the answer is anything but `true` before the effective confirmation timeout elapsed.

#### Scenario: Headless session cannot write
- **WHEN** a write tool runs with `ctx.hasUI` false
- **THEN** it SHALL fail with a message starting `[confirmation_unavailable]` and SHALL send no lane request

#### Scenario: Decline sends nothing
- **WHEN** the user answers No
- **THEN** the tool SHALL fail with `[declined]` and SHALL send no lane request

### Requirement: Confirmation timeouts are attributed as timeouts

The effective confirmation timeout SHALL be the smaller of the kit timeout and `ctx.ui.promptTimeoutMs` (missing or non-positive counts as infinite). A write tool SHALL fail with `confirmation_timeout` when its own timer fires first, even on a host that ignores `opts`, and when `confirm` returns a non-`true` answer after the effective timeout has elapsed.

#### Scenario: Host ignores the options
- **WHEN** `ctx.ui.confirm` never resolves and ignores `timeout` and `signal`
- **THEN** the tool SHALL fail with `[confirmation_timeout]` when its own timer elapses

#### Scenario: Shorter session prompt timeout is a timeout, not a decline
- **WHEN** the kit timeout is 5 min, `ctx.ui.promptTimeoutMs` is 60000, and nobody answers, so `confirm` resolves `false` after 60 s
- **THEN** the tool SHALL fail with `[confirmation_timeout]`, not `[declined]`

### Requirement: The kit confirmation timeout is a positive integer

`registerConnectorTools` SHALL accept an optional confirmation timeout in milliseconds, default 300000 (5 min). It SHALL be a positive finite integer; any other value (zero, negative, non-integer, `NaN`, `Infinity`, a non-number) SHALL make `registerConnectorTools` throw before registering any tool.

#### Scenario: Invalid kit timeout
- **WHEN** `registerConnectorTools` is called with a timeout of `0`, `-1`, `NaN`, `Infinity` or `1.5`
- **THEN** it SHALL throw and pi SHALL have received no tool

#### Scenario: Smallest valid kit timeout
- **WHEN** `registerConnectorTools` is called with a timeout of `1`
- **THEN** it SHALL register the tools

### Requirement: The confirmation dialog is withdrawn when the tool stops waiting

The kit SHALL abort the `signal` it passed to `ctx.ui.confirm` when the confirmation settles for any reason, and when the tool call's own abort signal fires. When the tool call's own signal aborts while the confirmation is pending, the tool SHALL fail with `declined` and the message `aborted`. After `confirm` resolves `true`, the kit SHALL re-check the tool call's signal before sending, and when it is aborted SHALL fail with `declined` (message `aborted`) and send no lane request.

#### Scenario: Timeout withdraws the card
- **WHEN** a write tool's confirmation timer elapses with no answer, on a host that honours `opts.signal`
- **THEN** the tool SHALL fail with `[confirmation_timeout]` and the dashboard card SHALL be dismissed

#### Scenario: Tool call aborted
- **WHEN** the agent run is aborted while a write confirmation is pending
- **THEN** the confirmation signal SHALL be aborted, the tool SHALL fail with a message starting `[declined]` that says `aborted`, and no lane request SHALL be sent

#### Scenario: Aborted just after approval
- **WHEN** `ctx.ui.confirm` resolves `true` and the tool call's signal is aborted before the lane request is sent
- **THEN** the tool SHALL fail with a message starting `[declined]` that says `aborted`, and no lane request SHALL be sent

### Requirement: Connector tools call the plugin server over the private lane

A connector tool SHALL call `requestPluginServer(pluginId, "<connectorId>/<tool>", {params})`. On success it SHALL return one text content item holding the JSON data, plus `details {connector, tool}`. Every failure SHALL be thrown as `Error("[<code>] <message>")`.

#### Scenario: Success result
- **WHEN** the server operation returns `{ok: true, data: {id: 7}}`
- **THEN** the tool result SHALL have one text item whose JSON parses to `{id: 7}` and `details: {connector, tool}`

#### Scenario: Server failure code passes through
- **WHEN** the server operation returns `{ok: false, code: "writes_disabled", message: "…"}`
- **THEN** the tool SHALL fail with a message starting `[writes_disabled]`

#### Scenario: Unknown server failure code becomes internal
- **WHEN** the server operation returns `{ok: false, code: "bogus", message: "m"}` and `bogus` is not in `CONNECTOR_ERROR_CODES`
- **THEN** the tool SHALL fail with a message starting `[internal]` that still contains `m`

### Requirement: Lane failures distinguish unknown outcomes

The tool SHALL map lane error `timeout` or `disconnected` (sent, outcome unknown) to `lane_timeout`; for a write the message SHALL say the write may have been applied and must be checked before retrying. Every other lane error (except `reply_too_large` and `reply_not_serializable`, below), including `unavailable` for a frame never sent, SHALL map to `lane_unavailable` with a message naming the plugin id.

#### Scenario: Plugin not loaded
- **WHEN** the lane replies `{ok: false, error: "no_handler"}`
- **THEN** the tool SHALL fail with a message starting `[lane_unavailable]` that names the plugin id

#### Scenario: Frame never sent
- **WHEN** the bridge socket is not open when a confirmed write calls the lane, so the lane replies `{ok: false, error: "unavailable"}`
- **THEN** the tool SHALL fail with `[lane_unavailable]`, and the message SHALL NOT say the write may have been applied

#### Scenario: Write outcome unknown after timeout
- **WHEN** a confirmed write's lane call replies `{ok: false, error: "timeout"}`
- **THEN** the tool SHALL fail with `[lane_timeout]`, and the message SHALL say the write may have been applied

#### Scenario: Connection drops while the write is in flight
- **WHEN** a confirmed write's frame was sent and the dashboard connection then closes, so the lane replies `{ok: false, error: "disconnected"}`
- **THEN** the tool SHALL fail with `[lane_timeout]`, and the message SHALL say the write may have been applied

### Requirement: Replies that arrive after the handler ran, and malformed replies

Lane error `reply_too_large` or `reply_not_serializable` means the handler ran. For a write it SHALL map to `lane_timeout` (outcome unknown, same message as above), and for a read to `lane_unavailable`. A reply without a boolean `ok` SHALL map to `internal`. A server failure whose `code` is not in `CONNECTOR_ERROR_CODES` SHALL map to `internal`, keeping its message.

#### Scenario: Reply could not be delivered after a write ran
- **WHEN** a confirmed write's lane call replies `{ok: false, error: "reply_too_large"}` or `{ok: false, error: "reply_not_serializable"}`
- **THEN** the tool SHALL fail with `[lane_timeout]`, and the message SHALL say the write may have been applied; for a read tool the same replies SHALL fail with `[lane_unavailable]`

#### Scenario: Reply without a boolean ok
- **WHEN** the lane replies `{ok: true, result: {}}`
- **THEN** the tool SHALL fail with a message starting `[internal]`

### Requirement: Connector server binds to the host-supplied plugin id

The plugin server context SHALL expose `pluginId`, set by the host to the plugin's manifest id. `registerConnectorServer` SHALL use `ctx.pluginId` for its routes, lane handlers and settings intent. When the spec also names a `pluginId` that differs from `ctx.pluginId`, it SHALL throw before registering anything. When `ctx.pluginId` or `ctx.registerPiRequestHandler` is absent, it SHALL throw an error whose message starts `[host_unsupported]` before registering anything.

#### Scenario: Spec cannot claim another plugin's id
- **WHEN** plugin `nav` calls `registerConnectorServer` with `spec.pluginId: "gmail"`
- **THEN** it SHALL throw, and no route, lane handler or intent SHALL be registered

#### Scenario: Host without the request lane
- **WHEN** the server context has no `registerPiRequestHandler`
- **THEN** `registerConnectorServer` SHALL throw a `[host_unsupported]` error at activation and SHALL register no route

### Requirement: Connector config GET never returns secrets

`registerConnectorServer(ctx, spec)` SHALL register `GET`, `PUT` and `DELETE /api/plugins/<pluginId>/config`. GET SHALL return `{title, configured, writesEnabled, savedAt, fields, values, secretsSet}`. `values` SHALL hold only non-secret fields, and `secretsSet` SHALL map each secret field to whether a value is stored. No response body, error body or log line SHALL contain a stored secret value. DELETE SHALL remove the stored record.

#### Scenario: GET hides the key
- **WHEN** a connector with secret field `apiKey` holds `sk-live-123456` and GET is called
- **THEN** the body SHALL contain `secretsSet.apiKey: true` and SHALL NOT contain `sk-live-123456`

#### Scenario: DELETE clears configuration
- **WHEN** DELETE is called on a configured connector
- **THEN** a following GET SHALL report `configured: false` and every `secretsSet` entry `false`

### Requirement: Connector config PUT merges safely

PUT SHALL drop keys that are not in the field list. It SHALL keep the stored secret when a secret field is empty or absent. It SHALL keep a stored non-secret value when the field is absent, and clear it when the field is an explicit empty string. It SHALL persist the record atomically. A record the store returns that fails the kit record schema, without a numeric `v` above the kit's version, SHALL be treated as empty so the user can overwrite it.

#### Scenario: Empty secret keeps the stored value
- **WHEN** PUT sends `{values: {apiKey: "", region: "eu"}, writesEnabled: false}` while `apiKey` is stored
- **THEN** the stored `apiKey` SHALL be unchanged and `region` SHALL be `eu`

#### Scenario: Unreadable previous record is overwritable
- **WHEN** the stored record is returned by the store but cannot be parsed as a kit record, and the user PUTs a complete config
- **THEN** the new config SHALL be stored and GET SHALL report `configured: true`

### Requirement: Connector config PUT requires an object body

A PUT body whose `values` is present but not a plain object (an array, string, number or `null`), or a body that is not an object, SHALL be rejected with 400 `invalid_input`, and nothing SHALL be stored.

#### Scenario: Non-object values
- **WHEN** PUT sends `values` as an array, a string or `null`, or sends a body that is a string
- **THEN** the response SHALL be 400 with `error: "invalid_input"` and nothing SHALL be stored

### Requirement: Connector config PUT keeps the writes switch unless set

PUT SHALL keep the stored `writesEnabled` when `writesEnabled` is absent, and SHALL reject a non-boolean `writesEnabled` with 400 `invalid_input`. When no record is stored and `writesEnabled` is absent, PUT SHALL persist `writesEnabled: false`. GET SHALL always return a boolean `writesEnabled`, `false` when no record is stored.

#### Scenario: Absent writesEnabled keeps the switch
- **WHEN** PUT sends `{values: {region: "eu"}}` while `writesEnabled` is stored `true`
- **THEN** the stored `writesEnabled` SHALL stay `true`

#### Scenario: First save defaults writes off
- **WHEN** no record is stored and PUT sends `{values: {region: "eu"}}`
- **THEN** the stored record SHALL hold `writesEnabled: false` and GET SHALL return `writesEnabled: false`

#### Scenario: Non-boolean writesEnabled
- **WHEN** PUT sends `{writesEnabled: "yes"}`
- **THEN** the response SHALL be 400 with `error: "invalid_input"` and nothing SHALL be stored

### Requirement: Connector config route errors are coded

PUT SHALL reject a `select` value outside its options, any missing required field, a value over the field cap, and a record the credential store refuses as too large or invalid (`record_too_large`, `invalid_record`), with HTTP 400 `invalid_input`. The error SHALL name field labels only. A route error body SHALL be `{error: <code>, message}`, with status 400 for `invalid_input`, 501 for `host_unsupported`, 503 for `keychain_unavailable` and 500 otherwise.

#### Scenario: Missing required field
- **WHEN** PUT omits a required field that has no stored value
- **THEN** the response SHALL be 400 with `error: "invalid_input"` and a message naming the field label

#### Scenario: Select value outside its options
- **WHEN** PUT sends `region: "mars"` for a select field whose options are `eu` and `us`
- **THEN** the response SHALL be 400 with `error: "invalid_input"` naming the field label, the message SHALL NOT contain `mars`, and nothing SHALL be stored

### Requirement: Connector secrets are stored only in the plugin credential store

The kit SHALL store connector config, secret and non-secret alike, as one record `{v: 1, values, writesEnabled, savedAt}` under key `connector-config` in `ctx.credentials`. It SHALL NOT write connector values to the dashboard config file or to any other file. When `ctx.credentials` is absent, every route and operation SHALL fail with `host_unsupported`.

#### Scenario: Config file stays clean
- **WHEN** a connector config with a secret is saved
- **THEN** `~/.pi/dashboard/config.json` SHALL contain no value from that config

#### Scenario: Older host
- **WHEN** the server context has no `credentials`
- **THEN** GET SHALL respond 501 with `error: "host_unsupported"`

### Requirement: Credential store failures map to stable codes

A credential-store rejection with code `store_locked` SHALL map to `keychain_unavailable` when its `reason` is `keychain_unavailable` or `keychain_timeout`, and to `credential_unreadable` otherwise, with the `reason` in `details`. Any other read failure, and a stored record whose `v` is a number above the kit's record version, SHALL map to `credential_unreadable`.

#### Scenario: Keychain not ready
- **WHEN** `ctx.credentials.get` rejects with code `store_locked` and reason `keychain_timeout`, and a read operation runs
- **THEN** the handler SHALL return `{ok: false, code: "keychain_unavailable"}` and the operation SHALL NOT run

### Requirement: Locked or unknown credential records are never overwritten

When a store call fails or the stored record has a newer `v`, PUT and DELETE SHALL fail with the mapped code and SHALL NOT write, operations SHALL fail with the mapped code, and the record SHALL never be treated as empty.

#### Scenario: Locked store is not overwritten
- **WHEN** `ctx.credentials.update` rejects with code `store_locked` and reason `key_mismatch`, and the user PUTs a complete config
- **THEN** the response SHALL be 500 with `error: "credential_unreadable"` and `key_mismatch` in the details, and the store SHALL receive no successful write

#### Scenario: Record from a newer kit
- **WHEN** the stored record is `{v: 2, …}` and the user PUTs a complete config
- **THEN** the response SHALL carry `error: "credential_unreadable"` and the stored record SHALL be unchanged

### Requirement: Invalid connector operation lists refuse activation

`registerConnectorServer` SHALL validate the operation list before registering any route, lane handler or intent. An operation name SHALL match `^[a-z][a-z0-9_]*$` and operation names SHALL be unique. It SHALL throw on a violation and register nothing.

#### Scenario: Duplicate operation name
- **WHEN** a spec declares two operations named `lookup`
- **THEN** `registerConnectorServer` SHALL throw, and no route, lane handler or intent SHALL be registered

#### Scenario: Valid operations get one handler each
- **WHEN** a spec declares operations `lookup` (read) and `cancel` (write) for connector `nav`
- **THEN** exactly the lane handlers `nav/lookup` and `nav/cancel` SHALL be registered

### Requirement: Connector operations re-check configuration and writes on the server

For each operation, the kit SHALL register exactly one lane handler of type `<connectorId>/<op>`. The handler SHALL return `missing_credential` when no record exists or a required field is missing. For a write operation it SHALL return `writes_disabled` unless the stored `writesEnabled` is `true`. Otherwise it SHALL run the operation with the stored values. The handler SHALL resolve with an operation result and SHALL never throw.

#### Scenario: Writes disabled on the server
- **WHEN** a confirmed write reaches the handler while `writesEnabled` is false
- **THEN** the handler SHALL return `{ok: false, code: "writes_disabled"}` and the operation SHALL NOT run

#### Scenario: Not configured
- **WHEN** a read operation runs before any config is saved
- **THEN** the handler SHALL return `missing_credential` with a message pointing at the plugin's settings page

### Requirement: Connector operations finish inside the lane budget

The kit SHALL pass each operation an AbortSignal and a deadline that defaults to 12 s. When the deadline passes, the kit SHALL abort the signal and return `lane_timeout` for a write operation, with a message saying the outcome is unknown and must be checked before retrying, and `provider_unavailable` for a read operation.

#### Scenario: Slow provider on a read
- **WHEN** a read operation has not settled 12 s after it started
- **THEN** its signal SHALL be aborted and the handler SHALL return `provider_unavailable` before the 15 s lane timeout

#### Scenario: Slow provider on a write
- **WHEN** a write operation has not settled 12 s after it started
- **THEN** its signal SHALL be aborted and the handler SHALL return `lane_timeout` with a message saying the write may have been applied

### Requirement: The operation deadline is bounded and covers the credential read

A configured deadline SHALL be a finite integer number of milliseconds with `0 < ms < 15000`; any other value SHALL make `registerConnectorServer` throw. The deadline SHALL cover the whole handler, including the `ctx.credentials.get` read. When it passes while the credential read is still pending, the handler SHALL return `keychain_unavailable` and the operation SHALL NOT run.

#### Scenario: Credential read stalls
- **WHEN** `ctx.credentials.get` has not settled 12 s after the handler started
- **THEN** the handler SHALL return `{ok: false, code: "keychain_unavailable"}` before the 15 s lane timeout, for a read and a write alike, and the operation SHALL NOT run

#### Scenario: Deadline out of range
- **WHEN** a spec sets the deadline to 15000 ms, 20000 ms, `0`, `-1` or `NaN`
- **THEN** `registerConnectorServer` SHALL throw; a deadline of 14999 ms SHALL be accepted

### Requirement: Connector results are redacted

Every operation result, failure and success alike, SHALL pass through redaction. In a failure's message and details and in a success's `data`, each stored secret value of length ≥ 4 SHALL be replaced by `[REDACTED]`, longest value first. A failure that is not a `ConnectorError` SHALL keep only its message, under code `internal`.

#### Scenario: Key echoed by a provider error
- **WHEN** an operation throws `Error("bad key sk-live-123456")` while `apiKey` is `sk-live-123456`
- **THEN** the result SHALL be `{ok: false, code: "internal", message: "bad key [REDACTED]"}`

#### Scenario: Key echoed in success data
- **WHEN** an operation returns `{echo: "token=sk-live-123456"}` while `apiKey` is `sk-live-123456`
- **THEN** the result SHALL be `{ok: true, data: {echo: "token=[REDACTED]"}}`

### Requirement: Redaction walks values structurally

Redaction SHALL walk the value structurally without serializing and re-parsing it, and SHALL NOT throw. It SHALL replace secrets inside every string leaf and every object key. A number or boolean leaf SHALL stay unchanged unless `String(value)` equals a stored secret, in which case it SHALL become the string `[REDACTED]`.

#### Scenario: Secret containing JSON metacharacters
- **WHEN** `apiKey` is the 6-character string `ab"c\d` (one double quote, one backslash) and an operation returns `data.echo` equal to `k=` followed by that string
- **THEN** the result SHALL be `{ok: true, data: {echo: "k=[REDACTED]"}}` and redaction SHALL NOT throw

#### Scenario: Numeric secret in data
- **WHEN** `pin` is `123456` and an operation returns `{pin: 123456, count: 7}`
- **THEN** the result SHALL be `{ok: true, data: {pin: "[REDACTED]", count: 7}}`

### Requirement: Redaction survives cyclic and deeply nested data

Redaction SHALL walk iteratively, with no recursion limit, so deeply nested data cannot make it throw. An object that contains itself, directly or through descendants, SHALL have the repeated reference replaced by the string `[Circular]`. Redaction has no performance budget.

#### Scenario: Cyclic data
- **WHEN** an operation returns an object `a` with `a.self = a`
- **THEN** the result SHALL be `{ok: true, data: {self: "[Circular]"}}` plus `a`'s other fields, and redaction SHALL NOT throw

#### Scenario: Very deep data
- **WHEN** an operation returns arrays nested 10000 levels deep
- **THEN** redaction SHALL NOT throw

### Requirement: Connector operations are observable without values

The kit SHALL log one line per operation through the plugin logger, with the connector id, operation, outcome (`ok` or the code) and duration in milliseconds. It SHALL NOT log parameters, config values or provider response bodies.

#### Scenario: Log line content
- **WHEN** an operation fails with `auth_failed`
- **THEN** exactly one log line SHALL name the operation and `auth_failed`, and SHALL contain no config value

### Requirement: Connector settings are contributed as a host-rendered intent

On activation, `registerConnectorServer` SHALL broadcast a `plugin_intents` message for `ctx.pluginId` with `sessionId: null`, `slot: "settings-section"` and intent `{primitive: "ui:connector-settings", props: {title, fields, writesToggle}}`. `writesToggle` SHALL be derived as "at least one operation is a write"; the spec SHALL have no separate flag for it.

#### Scenario: Settings page appears without a client bundle
- **WHEN** a connector plugin with no `client` or `clientBundle` activates
- **THEN** the plugin SHALL be listed as contributing settings, and `/settings/plugins/<id>` SHALL render the connector settings form

#### Scenario: Disabled plugin's settings page is hidden
- **WHEN** a connector plugin is disabled in the Plugins tab
- **THEN** the host SHALL stop listing it as a settings page; the kit adds no intent-clearing mechanism

#### Scenario: Read-only connector has no writes switch
- **WHEN** a connector whose operations are all reads activates
- **THEN** the broadcast intent SHALL carry `writesToggle: false`

### Requirement: Invalid connector field lists refuse activation

`registerConnectorServer` SHALL throw before registering any route when the field list is invalid. A field list is invalid when it has more than 32 fields, a duplicate name, a name that does not match `^[A-Za-z][A-Za-z0-9_]{0,63}$`, an unknown `kind`, a label over 80 characters, help over 300 characters, a select with no options or more than 50, or a field that breaks the "Connector field contract".

#### Scenario: Duplicate field name
- **WHEN** a spec declares two fields named `apiKey`
- **THEN** `registerConnectorServer` SHALL throw and SHALL register no route

### Requirement: Connector config routes rely on fail-closed tiering and the reviewed MCP manifest

Connector config routes use the concrete path `/api/plugins/<pluginId>/config`, so generic `:id` rows SHALL NOT be relied on. They SHALL be protected by the fail-closed `operate` default for unlisted routes, and SHALL not be advertised over MCP, which advertises only reviewed manifest rows. A first-party connector plugin SHALL add concrete `operate` rows in `ROUTE_TIERS` for its three config routes and an MCP denylist prefix `/api/plugins/<id>/`.

#### Scenario: Unlisted third-party connector route is operate
- **WHEN** `routeTier("PUT", "/api/plugins/acme-connector/config")` is called and `ROUTE_TIERS` has no row for it
- **THEN** it SHALL return `operate`

#### Scenario: Fixture connector routes are tiered and denylisted
- **WHEN** the MCP manifest completeness tests run
- **THEN** `GET`, `PUT` and `DELETE /api/plugins/connector-kit-fixture/config` SHALL each have an `operate` row in `ROUTE_TIERS`, and `isDenylisted("/api/plugins/connector-kit-fixture/config")` SHALL be `true`
