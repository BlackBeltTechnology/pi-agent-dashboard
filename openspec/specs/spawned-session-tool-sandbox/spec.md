# spawned-session-tool-sandbox Specification

## Purpose
TBD - created by archiving change constrain-agent-tool-surface. Update Purpose after archive.
## Requirements
### Requirement: Every invoice-bot-spawned session is guarded

Every pi session spawned via the invoice bot SHALL be guarded — built-in tools
disabled AND the tool-call working-directory containment guard applied —
regardless of which spawn path created it. A session SHALL be treated as
invoice-bot-spawned when EITHER it is spawned by the invoice plugin (origin) OR
it runs in a working directory the invoice plugin registered as guarded. This
union SHALL cover the per-invoice main sessions, the persistent "Ask" (Kérdezz)
session, and any other session the invoice bot spawns.

#### Scenario: Plugin-originated spawn is guarded regardless of cwd registration

- **WHEN** the invoice plugin spawns a session
- **THEN** that session SHALL be guarded even if its working directory was not
  separately registered

#### Scenario: Every invoice-bot session type is covered

- **WHEN** a per-invoice main session, the persistent "Ask" (Kérdezz) session, or
  any other invoice-bot-spawned session starts
- **THEN** it SHALL run with built-in tools disabled and the tool-call cwd guard
  applied

### Requirement: Guarded working directories are registered

The system SHALL maintain a set of guarded working directories. A first-party
plugin SHALL be able to register a working directory as guarded when it owns the
sessions running there. A working directory that is not registered SHALL NOT be
subject to any tool or sandbox restriction.

#### Scenario: Plugin registers its workspace as guarded

- **WHEN** the invoice plugin initializes and declares its workspace working
  directory
- **THEN** that working directory SHALL be recorded as guarded for the lifetime
  of the plugin

#### Scenario: Unrelated session is unrestricted

- **WHEN** a session is spawned that is neither invoice-bot-originated nor in a
  registered guarded working directory
- **THEN** the session SHALL receive the default tool surface with no built-in
  tools disabled and no containment guard applied

### Requirement: Built-in tools are disabled for guarded-directory sessions

A session spawned into a guarded working directory SHALL run with built-in tools
disabled while extension and custom tools remain enabled, so that the model
retains the workspace's own tool surface (for example the `ib_*` tools) but has
no built-in filesystem or shell tool with which to read, write, or execute
outside the workspace.

#### Scenario: Per-invoice flow session drops built-in tools

- **WHEN** the plugin spawns a session to run an invoice flow in a guarded
  working directory
- **THEN** the spawned pi process SHALL be launched with built-in tools disabled
- **AND** the workspace's extension/custom tools SHALL remain available

#### Scenario: Persistent Ask session drops built-in tools

- **WHEN** the client-initiated spawn creates the persistent "Ask" session in a
  guarded working directory
- **THEN** the spawned pi process SHALL be launched with built-in tools disabled
- **AND** no UI-side change SHALL be required to obtain this behaviour

#### Scenario: Injected instruction cannot invoke a disabled tool

- **WHEN** content processed by a guarded-directory session attempts to make the
  model read a path outside the working directory, edit the flow definition, or
  run a shell command
- **THEN** the action SHALL be impossible because no built-in tool capable of it
  exists in the session

### Requirement: Policy is keyed on invoice-bot origin or guarded cwd, not spawn path

The restriction SHALL be applied based on whether the session is invoice-bot-
spawned — by plugin origin OR by running in a guarded working directory — never
left to a particular spawn path to opt in. Any session meeting either condition
SHALL receive the restriction, whether it was created by the plugin spawn hook or
the generic client spawn path.

#### Scenario: Same policy across both spawn paths

- **WHEN** an invoice-bot session is created via either the plugin spawn hook or
  the generic client spawn path (plugin origin, or a guarded cwd)
- **THEN** both spawned sessions SHALL run with built-in tools disabled and the
  tool-call cwd guard applied

### Requirement: An extensible guard policy supports tool-call folder containment

The guard SHALL be expressed as an extensible policy so further constraints
(folder scoping, per-tool denials, and future rules) can be added without
changing any spawn call site. The enforced baseline for every guarded session is
built-in tools disabled. When a folder policy is configured, the session SHALL
additionally load a tool-call guard that, before a tool executes, rejects any
tool call whose filesystem path argument resolves (after symlink resolution)
outside the allowed roots, and blocks any denied tool. Because built-in tools are
disabled and no general-purpose shell/exec tool is present, every filesystem
access flows through a tool call the guard can inspect, so when active the guard
SHALL be an authoritative working-directory boundary with no OS-level isolation
runtime. Path comparison SHALL normalize separators and drive-letter case so it
holds on Windows.

#### Scenario: Path-taking tool call outside the working directory is blocked

- **WHEN** a remaining tool call references a path that resolves outside the
  guarded working directory
- **THEN** the guard SHALL block the call before execution with a rejection
  reason, and the tool SHALL NOT run

#### Scenario: No bypass primitive remains

- **WHEN** a guarded-directory session runs with built-in tools disabled and no
  general-purpose shell/exec tool
- **THEN** every filesystem access SHALL flow through a guarded tool call, so the
  containment SHALL hold in-process without a container or VM

#### Scenario: Symlink escaping the working directory is rejected

- **WHEN** a tool-call path argument is a symlink whose real target is outside
  the guarded working directory
- **THEN** the guard SHALL reject it after resolving the real path

### Requirement: Enforcement is host-prerequisite-free and cross-platform

The restriction SHALL be applied by disabling built-in tools at spawn via the pi
CLI, with no dependency on any external isolation runtime, so that it behaves
identically on Windows, macOS, and Linux hosts.

#### Scenario: Same guarantee on every host OS

- **WHEN** a guarded-directory session is spawned on a Windows, macOS, or Linux
  host
- **THEN** the session SHALL run with built-in tools disabled without requiring
  any container, VM, or other external isolation runtime

