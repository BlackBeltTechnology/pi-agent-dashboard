# mcp-client-config Specification

## Purpose
Server-side ownership of `pi-mcp-adapter` configuration on the dashboard: reads the adapter's full layer stack, writes only the two Pi-owned layers, and exposes that capability to other plugins as an in-process service.

## Requirements

### Requirement: Plugin identity and adapter requirement

The dashboard SHALL ship a first-party plugin with id `mcp-client` (npm `@blackbelt-technology/pi-dashboard-mcp-client-plugin`, per the package naming convention) that declares `pi-mcp-adapter` as a required pi extension. No other first-party plugin SHALL declare that requirement.

#### Scenario: Missing adapter is reported on the mcp-client row

- **WHEN** `pi-mcp-adapter` is not installed
- **THEN** the plugins index lists `pi-mcp-adapter` under `missingRequirements` for the `mcp-client` row
- **AND** because `pi-mcp-adapter` is itself a recommended-extension row, the inline one-click Install affordance renders (not the Packages-tab fallback link)
- **AND** the `apple-tools` row lists no MCP-adapter requirement of its own

### Requirement: Effective configuration is read through the adapter's discovery, never re-implemented

The plugin SHALL obtain the effective MCP configuration for a directory by invoking the adapter's own configuration loader, so precedence and file discovery cannot drift from what a pi session in that directory observes. Because the adapter's loaders are synchronous, the plugin SHALL run them off the server's event loop (a worker thread) under a deadline `adapterLoadTimeoutMs` taken from the plugin's own host config namespace `plugins.mcp-client` (integer, default `10000`, minimum `1000`, maximum `120000`, declared in the manifest `configSchema`); on expiry the worker SHALL be terminated, the load SHALL fail with an adapter-timeout error carrying the timeout value, and the next load SHALL use a fresh worker. Write-only operations SHALL never spawn or use the worker.

#### Scenario: Effective view matches the adapter

- **WHEN** the effective configuration is requested for a cwd
- **THEN** the set of servers, their merged fields, and the global settings equal what `pi-mcp-adapter` resolves for a session started in that cwd, except that inherited secret values are replaced by redaction markers per the layer-model requirement (redaction takes precedence)

#### Scenario: Global view uses no project layers

- **WHEN** the effective configuration is requested without a cwd
- **THEN** the adapter loader is invoked with a plugin-owned, always-empty scratch directory under the OS temp root as cwd
- **AND** only user-level sources contribute
- **AND** no file under the dashboard server's own working directory is read

#### Scenario: Stalled adapter load times out without blocking the server

- **WHEN** `adapterLoadTimeoutMs` is `1000` and an adapter load does not complete within that time
- **THEN** the load fails with an adapter-timeout error naming `1000`
- **AND** an unrelated request served during that second completes normally
- **AND** the next effective-view request runs and succeeds on a fresh worker

#### Scenario: Timeout change applies without restart

- **WHEN** the operator saves `adapterLoadTimeoutMs: 2500` and then requests the effective view
- **THEN** that request's deadline is `2500`

#### Scenario: Out-of-range timeout is rejected by the host

- **WHEN** a plugin-config write carries `adapterLoadTimeoutMs: 500` or `200000` or `"10s"`
- **THEN** the host config route rejects it against the manifest `configSchema`
- **AND** the previous value stays in effect

#### Scenario: JSONC and alias key are read as the adapter reads them

- **WHEN** a layer file contains comments, trailing commas, or the `mcp-servers` alias key
- **THEN** the effective view and layer parse status agree with what the adapter loads
- **AND** the layer is not reported as unparseable

### Requirement: Layer model with provenance

Every server in an effective view SHALL carry provenance derived from the adapter's own `getServerProvenance`, classified by its `kind` combined with Pi-path equality (`user` → Pi global; `project` with path equal to `<cwd>/.pi/mcp.json` → Pi folder; `project` with any other path, i.e. `<cwd>/.mcp.json` → shared; `import` → shared, labelled by `importKind` since its `path` is the adapter's write target rather than the defining file), naming the highest-precedence source that defines it and every lower discovered layer that also defines it. Sources SHALL be classified as **Pi-owned** (`~/.pi/agent/mcp.json`, `<cwd>/.pi/mcp.json`), **shared** (every other discovered file, including imports), or **other** (servers the adapter merges from `package.json#mcp` or agent plugins, which have no editable file). Only Pi-owned sources are writable. Secret-marked field values that are not defined in the requested scope's writable Pi-owned layer SHALL be redacted in the effective view. For a scalar secret the marker replaces the value; for a record-valued secret field (`env`, `headers`, `requestHeadersCommand.env`) the marker carries the record's key names and, per key, whether the value is a secret (by the credential-name pattern) — key names are not secrets and let the client state override consequences without receiving any value.

#### Scenario: Inherited secret is redacted in the payload

- **WHEN** a server's `headers` record `{ Authorization, Accept }` is defined in a shared layer and the effective view is requested at global scope
- **THEN** the payload carries a redaction marker for `headers` listing keys `Authorization` (secret) and `Accept` (not secret)
- **AND** no header value appears in the response body

#### Scenario: Own-layer secret is not redacted

- **WHEN** the same field is defined in `~/.pi/agent/mcp.json` and the effective view is requested at global scope
- **THEN** the payload carries the value

#### Scenario: The writable layer's own entry is exposed as `own`

- **WHEN** the requested scope's writable Pi-owned layer defines a server that a lower layer also defines
- **THEN** that server's view carries `own`, the writable layer's own entry, unmerged
- **AND** its merged `entry` still carries every lower layer's values
- **AND** a server the writable layer does not define carries no `own`
- **AND** a client can therefore distinguish an override (a key in `own`) from an inherited field (a key absent from `own`), which the merged `entry` alone cannot express for a non-secret key

#### Scenario: Shared project file is not Pi folder

- **WHEN** a server is defined only in `<cwd>/.mcp.json`
- **THEN** it is classified shared and marked not writable
- **AND** a folder-scope write for it targets `<cwd>/.pi/mcp.json`

#### Scenario: Package or plugin server is classified other

- **WHEN** a server is present in the effective view but absent from the adapter's provenance map
- **THEN** it is classified `other`, naming the source kind
- **AND** it is marked not writable

#### Scenario: Server defined in a shared layer is flagged read-only

- **WHEN** a server is defined only in a shared layer
- **THEN** its provenance names that layer
- **AND** it is marked not writable

#### Scenario: Server defined in several layers reports all of them

- **WHEN** a server key appears in both a shared layer and a Pi-owned layer
- **THEN** provenance lists both, highest precedence first
- **AND** the effective fields are the merged result the adapter computes

#### Scenario: Unparseable layer is reported, not hidden

- **WHEN** one discovered layer file exists but is not valid JSON
- **THEN** the effective view still returns the servers from every parseable layer
- **AND** it reports the failing layer's path and the parse error
- **AND** servers whose only definition lives in the failing layer are absent from the view

### Requirement: Writes target only Pi-owned layers and are merge-only

Every write SHALL target exactly one of the two Pi-owned layers, selected by scope (`global` → the adapter's Pi-global path, `~/.pi/agent/mcp.json` by default; `project` → the adapter's Pi-project path, `<cwd>/.pi/mcp.json`), resolved through the adapter's own path helpers so reads and writes agree under `PI_CODING_AGENT_DIR` or a custom config directory. Object-valued fields (`env`, `headers`, `searchKeywords`, `oauth`, `requestHeadersCommand`) are layer-atomic: setting one in a Pi-owned layer replaces the inherited object wholesale, as the adapter's merge does; the schema SHALL mark each such field so clients derive the list. Refusals SHALL be reported as a closed set (`unparseable`, `entry-not-object`, `invalid-name`, `transport-conflict`, `write-failed` carrying the IO error code) shared by the service's write and check operations; `write-failed` is the outcome of a permission, disk-full, or uncreatable-directory failure on a parseable target. A write SHALL be a patch — a set of fields to set plus a set of keys to unset — and SHALL modify only those keys, preserving every sibling server entry and every unrecognised key in meaning. Writes SHALL parse the target with the adapter's JSONC rules, SHALL write servers back under whichever of `mcpServers` / `mcp-servers` the file already uses (never both), exactly as the adapter's own `writeProjectServerDisabledOverride` does, and SHALL be atomic and hardened (temporary file created exclusively with a random name and mode `0600`, fsync, then rename — the same discipline `apple-tools` applies today; the adapter's own writer, which lacks these, SHALL NOT be used). A write SHALL be refused when the target file exists but the adapter's parser cannot parse it, and SHALL be refused when the existing entry for the named server is not an object. Server names `__proto__`, `constructor`, and `prototype` SHALL be refused at every entry point. Comments in the target file are not preserved.

#### Scenario: IO failure is reported as write-failed

- **WHEN** the target parses but cannot be written (permission denied, disk full, or uncreatable parent directory)
- **THEN** the result is `write-failed` with the error code
- **AND** the existing file is left byte-identical

#### Scenario: Custom agent directory is honoured

- **WHEN** `PI_CODING_AGENT_DIR` points at a custom directory and a global-scope write is made
- **THEN** the write lands in `<custom>/mcp.json`
- **AND** the effective view reports that same file as Pi global

#### Scenario: Written file keeps restrictive permissions

- **WHEN** a write replaces an existing `0600` config file
- **THEN** the resulting file is `0600`
- **AND** no temporary file with a predictable name existed during the write

#### Scenario: Prototype key is refused

- **WHEN** a write names the server `__proto__`
- **THEN** the write is refused
- **AND** no file is modified

#### Scenario: Alias key is preserved, not shadowed

- **WHEN** the target file defines servers under `mcp-servers` and a server is upserted
- **THEN** the written file has a single `mcp-servers` key containing the previous servers and the upserted one
- **AND** no `mcpServers` key is added

#### Scenario: Malformed existing entry refuses the write

- **WHEN** the target file is parseable but `mcpServers.<name>` is not an object
- **THEN** the write is refused naming the path and key
- **AND** the file is left byte-identical

#### Scenario: Shared layer is never written

- **WHEN** any write is requested for a server whose only definition is in a shared layer
- **THEN** the write creates or updates an entry in the requested Pi-owned layer
- **AND** the shared layer file is left unmodified

#### Scenario: Sibling servers and unknown keys survive

- **WHEN** a server entry is upserted
- **THEN** every other `mcpServers` entry in the target file is preserved
- **AND** every top-level key the plugin does not recognise is preserved

#### Scenario: Unparseable target refuses the write

- **WHEN** the target Pi-owned file exists but is not valid JSON
- **THEN** the write is refused with an error naming the path and parse failure
- **AND** the file is left byte-identical

#### Scenario: Interrupted write leaves a whole file

- **WHEN** the process is interrupted during a write
- **THEN** the target file is either the complete previous content or the complete new content

#### Scenario: Removing a server removes only that key

- **WHEN** a server is removed from a Pi-owned layer
- **THEN** only that `mcpServers` key is deleted from that file
- **AND** definitions of the same server in lower or shared layers are untouched

### Requirement: Disabled flag semantics follow the adapter

Disabling a server SHALL write `disabled: true` into the requested Pi-owned layer. Enabling SHALL remove the `disabled` key from that layer, then re-evaluate the adapter's full effective merge for the scope, and write an explicit `disabled: false` into that layer only if the server is still disabled; if removal leaves the layer entry empty, the entry SHALL be deleted — so the enable always takes effect and the decision is the adapter's own merge (every file layer, imports declared in any file, host discovery, agent plugins), never a re-implementation. Direct-tools writes SHALL NOT delegate to the adapter's `writeDirectToolsConfig`, which copies credentials between layers.

#### Scenario: Enable removes the key when no lower layer disables

- **WHEN** a server `disabled: true` only in a Pi-owned layer is enabled at that scope
- **THEN** the `disabled` key is absent from that entry after the write
- **AND** every other field of the entry is unchanged

#### Scenario: Enable writes explicit false when a lower layer disables

- **WHEN** a server is `disabled: true` in a shared layer and is enabled at a Pi-owned scope
- **THEN** the Pi-owned entry contains `disabled: false`
- **AND** the effective view reports the server enabled

#### Scenario: Enable over an import-declared disable

- **WHEN** a server is disabled only through an `imports` entry declared inside `<cwd>/.mcp.json` and is enabled at project scope
- **THEN** `<cwd>/.pi/mcp.json` contains `disabled: false` for that server
- **AND** the effective view reports the server enabled

#### Scenario: Enable whose merge re-evaluation times out

- **WHEN** enabling removes the `disabled` key and the adapter merge re-evaluation exceeds `adapterLoadTimeoutMs`
- **THEN** the removal write stays in the file (no revert)
- **AND** the caller receives the adapter-timeout error
- **AND** no `disabled: false` is written

#### Scenario: Project-scope disable overrides without mutating global

- **WHEN** a server enabled at global scope is disabled at project scope
- **THEN** `<cwd>/.pi/mcp.json` gains `disabled: true` for that server
- **AND** `~/.pi/agent/mcp.json` is left unmodified

### Requirement: Project-scope writes validate the directory

A project-scope write SHALL be refused unless the supplied directory is in the host's known folder set after canonicalisation. The directory value SHALL be treated as untrusted input. The admission function SHALL be the one shared implementation used by the kb plugin — the whole admission module (`isAllowedCwd`, `canonPath`, and the git main-checkout resolution that admits a worktree whose main checkout is known) — extracted into the shared package so both plugins import it rather than each carrying a copy. A worktree cwd whose main checkout is a known folder is admitted, as for kb.

#### Scenario: Worktree of a known folder is admitted

- **WHEN** a project-scope write names a git worktree whose main checkout is in the known folder set
- **THEN** the write is admitted and lands in that worktree's `.pi/mcp.json`

#### Scenario: Unknown directory is refused

- **WHEN** a project-scope write names a directory outside the host's known folder set
- **THEN** no filesystem write occurs
- **AND** the caller receives a not-allowed error

#### Scenario: Path traversal in the directory is refused

- **WHEN** the supplied directory resolves outside every known folder after normalisation
- **THEN** no filesystem write occurs

### Requirement: Global settings are written merge-only

Global adapter settings live under the top-level `settings` object of `~/.pi/agent/mcp.json` and SHALL be written there only, merged key-by-key inside that object. Clearing a setting SHALL delete its key from that file; the effective value then falls through to a lower layer's value if one defines the key, else the adapter default, and the effective view SHALL report which.

#### Scenario: Only changed settings keys are touched

- **WHEN** one global setting is changed
- **THEN** that key is updated inside `settings` in `~/.pi/agent/mcp.json`
- **AND** every other `settings` key, every other top-level key, and every `mcpServers` entry is preserved

#### Scenario: Cleared setting deletes the key

- **WHEN** a global setting is cleared
- **THEN** its key is absent from `settings` after the write

#### Scenario: Cleared setting falls through to a lower layer

- **WHEN** a setting is cleared and a shared layer defines the same key
- **THEN** the effective view reports the shared layer's value with that layer as its source

### Requirement: Configuration schema is published

The plugin SHALL publish a JSON Schema describing the per-server entry and the global settings, sufficient for a client to render editors without hard-coding field lists. Every per-server field SHALL be optional in the schema, because a layer entry may be a partial override. Transport exclusivity SHALL be validated on the layer entry the write would leave in the target file: at most one of `command`, `url`, `socket` (checked by every write path, including the service); and at least one when no lower-precedence source defines the server — this second check needs the adapter's merge (evaluated for the scope's cwd, or the scratch directory for global scope, never the server's own cwd) and is therefore performed by the HTTP layer only; service callers (dependent plugins) always supply a transport. The schema SHALL mark secret-bearing fields, layer-atomic object fields, and each field's transport. Schema `default` values are display metadata only: request validation SHALL NOT inject defaults into a patch.

#### Scenario: Schema covers the adapter's server fields

- **WHEN** the schema is requested
- **THEN** it describes every per-server field the workspace adapter's types declare for the `command`, `url`, and `socket` transports
- **AND** it describes every global setting those types declare
- **AND** a compile-time check fails when a type key is missing from the schema or a schema key is missing from the type
- **AND** `bearerToken`, `oauth.clientSecret`, `headers`, `env`, and `requestHeadersCommand.env` carry the secret marker

#### Scenario: Validation does not inject defaults

- **WHEN** a patch `set: { command: "/bin/x" }` is validated and written
- **THEN** the written entry contains only `command`
- **AND** no schema default appears in the file

#### Scenario: Partial override patch is accepted

- **WHEN** a project-scope patch contains only `disabled: true` for a server defined in a lower layer
- **THEN** validation passes
- **AND** the patch is written

#### Scenario: New server without a transport is rejected

- **WHEN** a patch would create a server no lower source defines, with neither `command`, `url`, nor `socket`
- **THEN** validation fails naming the transport fields
- **AND** no file is written

#### Scenario: Layer entry with two transports is rejected

- **WHEN** a patch would leave both `command` and `url` in the same layer entry
- **THEN** validation fails naming both fields
- **AND** no file is written

#### Scenario: Override may switch transport

- **WHEN** a server defined with `url` in a shared layer receives a Pi-owned patch containing only `command`
- **THEN** validation passes
- **AND** the Pi-owned entry contains only `command`

#### Scenario: Secret fields are marked

- **WHEN** the schema is requested
- **THEN** fields holding credentials (request headers, environment variables, auth blocks) carry a secret marker

#### Scenario: Unknown fields are accepted

- **WHEN** a config file contains a per-server field absent from the schema
- **THEN** reads succeed and the field is preserved through any write

### Requirement: Adapter version floor is owned by mcp-client

The plugin SHALL determine the installed `pi-mcp-adapter` version and report a verdict of `ok`, `absent`, `below-floor`, or `unparseable` against the dashboard's minimum supported version. This verdict SHALL be the single source consulted by any dashboard surface that depends on the adapter.

#### Scenario: Verdict exposes version and floor

- **WHEN** the adapter is installed at a version below the floor
- **THEN** the verdict is `below-floor`
- **AND** it carries both the installed version and the floor

#### Scenario: Absent adapter yields absent verdict

- **WHEN** the adapter is not installed under the resolved agent directory
- **THEN** the verdict is `absent`

#### Scenario: Probe follows the custom agent directory

- **WHEN** `PI_CODING_AGENT_DIR` points at a custom directory containing `npm/node_modules/pi-mcp-adapter`
- **THEN** the verdict reflects that installation, not `~/.pi/agent`

### Requirement: In-process service for dependent plugins

The service SHALL be constructed by an exported factory taking injected file IO, the known-cwd set, and an optional adapter port (defaulting to a port that runs the real `pi-mcp-adapter/config` loaders in the worker thread; its loading functions are asynchronous and accept the deadline) whose pure path helpers determine every target path, so a hostless process (a dependent plugin's CLI) can obtain the same implementation and tests can run hermetically. Write-only operations (`ensureServerEntry`, `setDirectTools`, disable, `ensureAdapterPackage`, `checkConfigFiles`) SHALL read only the target file through the injected IO and SHALL NOT call the adapter's loading functions. At registration the plugin SHALL build it with the host's IO and known folders and provide it as `mcp-client.config` through the host's cross-plugin seam. The service SHALL expose: read a server's raw entry from the Pi-owned layer at a scope (a file read only, no adapter loading), ensure a server entry exists with given fields (merge-only), set the disabled flag, set the direct-tools list, read the adapter verdict, ensure the adapter package is listed in `~/.pi/agent/settings.json#packages` (merge-only, atomic, refused on unparseable), and a write-suppressed parse-status check of the global `~/.pi/agent/mcp.json` and `~/.pi/agent/settings.json` that, given a server name and the fields a subsequent ensure call would set, also reports whether that ensure would be refused, using the same validation function over the same post-patch entry and the same refusal set (so a dependent's check mode and write mode agree). Each writing operation SHALL carry the same layer, merge, atomicity, and directory-validation guarantees as the HTTP surface.

#### Scenario: Check and write agree on a transport conflict

- **WHEN** the existing entry defines `url` and the check is asked about setting `command`
- **THEN** the check reports `transport-conflict`
- **AND** `ensureServerEntry` with the same fields is refused with `transport-conflict`

#### Scenario: Factory-built service matches the provided one

- **WHEN** the factory is called with in-memory IO and a stubbed adapter port whose path helpers point at a temp directory
- **THEN** every operation behaves per this capability against those injected paths
- **AND** no real filesystem path is touched

#### Scenario: Write-only operations do not consult the adapter

- **WHEN** `ensureServerEntry`, `ensureAdapterPackage`, or `checkConfigFiles` is called on a factory instance whose adapter port throws on any loading call
- **THEN** the operation completes normally
- **AND** only the target file is read or written

#### Scenario: Ensure-adapter-package is merge-only

- **WHEN** a dependent calls ensure-adapter-package and `settings.json` lists other packages
- **THEN** `npm:pi-mcp-adapter` is present in `packages` after the call
- **AND** every other package and every other key is preserved

#### Scenario: Config check never writes

- **WHEN** a dependent calls the parse-status check
- **THEN** no file is created or modified
- **AND** an unparseable file is reported with its path and error

#### Scenario: Dependent plugin observes the service

- **WHEN** a plugin declaring `dependsOn: ["mcp-client"]` consumes `mcp-client.config` during its own registration
- **THEN** it receives the service (not `undefined`)

#### Scenario: Ensure-entry preserves caller-owned fields

- **WHEN** a dependent calls ensure-entry for server `X` with a `command`, and `X` already exists at that scope with additional fields
- **THEN** `command` is updated
- **AND** the additional fields are preserved

#### Scenario: Service disabled means no service

- **WHEN** the `mcp-client` plugin is disabled
- **THEN** no `mcp-client.config` service is provided
- **AND** plugins depending on it are reported with `mcp-client` in `missingDeps` and are not loaded

### Requirement: HTTP surface

The plugin SHALL expose routes, under its plugin prefix, to read the effective view (global or for a known cwd), read the schema, patch/remove a server at a scope, set disabled at a scope, patch global settings, and read the adapter verdict. Remove SHALL return the removed raw layer entry so the caller can restore it exactly. Server-mutating bodies SHALL be patches (`set` + `unset`), never whole entries. For project scope the cwd travels in the body of `PUT` routes and as a query parameter on `DELETE`. Server names in the path SHALL be URL-decoded and validated (1–128 characters; no `/`, `\`, or control characters; not `.` or `..`) before use. Every route SHALL require the same authentication as every other plugin route AND SHALL be registered behind the host's `networkGuard` pre-handler: mutating payloads become executable configuration for pi, and the effective view returns own-layer credentials. A route whose adapter load times out SHALL respond `504` with `error: "adapter-timeout"` and the `timeoutMs` in effect.

#### Scenario: Adapter timeout is a 504

- **WHEN** `GET .../effective` or an enable write hits the adapter deadline
- **THEN** the response status is `504`
- **AND** the body carries `error: "adapter-timeout"` and the configured `timeoutMs`

#### Scenario: Remove returns the removed entry

- **WHEN** a server is removed from a Pi-owned layer
- **THEN** the response carries that layer's entry as it was in the file
- **AND** re-submitting it as a patch recreates a byte-equivalent entry

#### Scenario: Network guard shields every route

- **WHEN** any route, including `GET /effective`, is called from an origin the host network guard refuses
- **THEN** the response is the guard's refusal
- **AND** no file is read or written

#### Scenario: Invalid server name is rejected

- **WHEN** a mutating route names a server containing `/` or a control character
- **THEN** the response is a validation error
- **AND** no file is read or written

#### Scenario: Effective view for a cwd

- **WHEN** `GET .../effective?cwd=<known cwd>` is requested
- **THEN** the response contains servers with provenance, global settings, layer parse errors, and the adapter verdict

#### Scenario: Effective view for an unknown cwd

- **WHEN** `GET .../effective?cwd=<unknown cwd>` is requested
- **THEN** the response is a not-allowed error
- **AND** no project file is read

#### Scenario: Invalid server payload is rejected before writing

- **WHEN** an upsert carries a payload that fails schema validation
- **THEN** the response lists the failing fields
- **AND** no file is written

### Requirement: Plugin is registered for production bundling

The plugin SHALL be registered wherever first-party plugins are enumerated for production builds so it is present in the web bundle and the desktop bundle.

#### Scenario: Production build includes the plugin

- **WHEN** the client is built for production
- **THEN** the `mcp-client` settings section and folder pill are available without a dev-server
