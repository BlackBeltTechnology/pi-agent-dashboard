# apple-pim-access Specification

## Purpose
TBD - created by archiving change add-apple-tools-imcp-plugin. Update Purpose after archive.
## Requirements
### Requirement: Skill documents the reachable service set

The Apple-tools skill SHALL enumerate the Apple services reachable through iMCP — Calendar, Contacts, Location, Maps, Messages, Reminders, Weather — so the agent does not probe for capabilities that do not exist.

#### Scenario: Agent consults the service list before tool discovery

- **WHEN** the agent is asked to read Apple calendar or contact data
- **THEN** the skill identifies the corresponding iMCP service as available
- **AND** directs the agent through the MCP adapter rather than an ad-hoc AppleScript

### Requirement: Mail is documented as out of scope with a redirect

The skill SHALL state explicitly that Apple Mail is NOT reachable through iMCP, SHALL clarify that the "Messages" service is iMessage/SMS rather than email, and SHALL redirect mail work to the direct `.emlx` export path.

#### Scenario: Mail request is redirected, not attempted

- **WHEN** the agent is asked to search or read Apple Mail messages
- **THEN** the skill states that iMCP exposes no Mail service
- **AND** names the `apple-mail-fast-export` path as the correct route
- **AND** the agent does not attempt to reach mail through an iMCP tool

#### Scenario: Messages is not mistaken for email

- **WHEN** the agent evaluates whether the "Messages" service satisfies an email request
- **THEN** the skill's documentation identifies Messages as iMessage/SMS only

### Requirement: Skill verifies provisioning at load

The skill SHALL run the write-suppressed provisioning check when it loads and SHALL surface an unprovisioned state before any Apple-data work is planned, rather than allowing the gap to surface as an opaque mid-task tool failure.

#### Scenario: Unprovisioned host is reported at load

- **WHEN** the skill loads on a macOS host with no iMCP application present
- **THEN** it reports the provisioning gap and names the installer command
- **AND** it does not attempt an Apple-data tool call

#### Scenario: Non-macOS load cost is negligible

- **WHEN** the skill loads on a non-macOS host
- **THEN** the check short-circuits at the platform gate
- **AND** no OS-version subprocess is spawned

#### Scenario: Check result is cached per session

- **WHEN** the skill's provisioning check has already run in the current session
- **THEN** subsequent consultations reuse the cached result without re-probing
- **AND** the cache is held in the checker module's process-local state, keyed by the resolved configuration, so it neither persists across sessions nor requires a cache file

### Requirement: Access is mediated through the MCP adapter

The skill SHALL direct Apple-data access through the MCP adapter's search-then-invoke pattern rather than instructing the agent to spawn `imcp-server` directly.

#### Scenario: Tool discovery precedes invocation

- **WHEN** the agent needs an Apple-data tool whose exact name is unknown
- **THEN** the skill directs it to search the adapter's tool catalogue first
- **AND** then invoke the resolved tool by name with arguments

### Requirement: Permission-revocation failures are diagnosable

The skill SHALL document that TCC grants may be revoked out of band and that such revocation is undetectable ahead of a call, so a permission-class tool failure is attributed correctly.

#### Scenario: Permission failure is attributed to grants

- **WHEN** an Apple-data tool call fails with a permission-class error on a provisioned host
- **THEN** the skill attributes the failure to a revoked or ungranted TCC permission
- **AND** directs the operator to the iMCP menu bar rather than re-running the installer

