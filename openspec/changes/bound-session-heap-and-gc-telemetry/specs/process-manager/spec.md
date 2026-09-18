## ADDED Requirements

### Requirement: The resolved pi invocation carries the session heap arguments

The resolved pi invocation SHALL be normalized so it can carry Node runtime
arguments before the pi entry point, and the configured session heap arguments
SHALL be inserted there.

Pi resolution yields either a single-element invocation naming an executable
script, or an explicit runtime-and-script pair. Both SHALL end up in the form
runtime, then heap arguments, then entry point, then pi's own arguments. The
heap arguments SHALL precede the entry point; placed after it they are pi's
arguments, not the runtime's.

Normalization SHALL happen after the invocation has been re-pointed at the
resolved runtime, not before. Re-pointing identifies the runtime-and-script pair
by the shape of the invocation, so inserting arguments first would destroy that
recognition and silently disable it.

Mechanisms whose invocation must resolve inside another namespace SHALL be left
unchanged, and the ceiling applied by the per-window route defined in the
heap-limits capability. Where no runtime position can be produced at all, the
invocation SHALL be left unchanged and the ceiling applied by the fallback
route.

#### Scenario: Runtime-and-script invocation
- **WHEN** pi resolves to an explicit runtime and script pair
- **THEN** the heap arguments SHALL be inserted between them

#### Scenario: Single-element executable invocation
- **WHEN** pi resolves to a single executable script path
- **THEN** the invocation SHALL be rewritten to lead with the resolved runtime followed by the heap arguments and that path

#### Scenario: Pi's own arguments are unchanged
- **WHEN** heap arguments are inserted
- **THEN** pi's own arguments SHALL keep their order and content
- **AND** no heap argument SHALL be visible to pi as one of its arguments

#### Scenario: Runtime re-pointing still occurs
- **WHEN** the invocation is both re-pointed at a resolved runtime and given heap arguments
- **THEN** the re-pointing SHALL take effect
- **AND** the resulting invocation SHALL lead with the resolved runtime

#### Scenario: Namespace-bound invocation is not rewritten
- **WHEN** a mechanism requires the pi name to resolve inside another namespace
- **THEN** the invocation SHALL be left unchanged
- **AND** the ceiling SHALL be delivered by the per-window route instead

#### Scenario: Ordering across every spawn mechanism
- **WHEN** a session is spawned through any supported mechanism
- **THEN** the pi process SHALL run under the configured ceiling

### Requirement: Heap arguments are shell-safe on command-string mechanisms

Some spawn mechanisms pass the invocation as a command string interpreted by a
shell rather than as an argument vector. Heap arguments SHALL be escaped for
those mechanisms exactly as the rest of the invocation is.

Since heap arguments are derived from operator-supplied configuration, they
SHALL be validated as integers before being composed into any command string.

#### Scenario: Command-string mechanism escapes the heap arguments
- **WHEN** a session is spawned through a mechanism that builds a shell command string
- **THEN** the heap arguments SHALL be escaped with the same treatment as the other tokens

#### Scenario: Non-integer configuration never reaches a command string
- **WHEN** a heap configuration value is not a positive integer
- **THEN** the default SHALL be used
- **AND** the original value SHALL NOT appear in any command string or argument vector
