## ADDED Requirements

### Requirement: Find PIDs by command-line marker
The `packages/shared/src/platform/process-identify.ts` module SHALL export `findPidByMarker(marker, opts?)` where `opts` accepts `{ platform?: NodeJS.Platform }`. On Unix (`linux` / `darwin`), the function SHALL run the equivalent of `ps -eo pid,command | grep <marker>` and return the matching PIDs as a `number[]`. On Windows (`win32`), the function SHALL return an empty array; Windows process-by-command-line lookup is delegated to the server's `headlessPidRegistry` which tracks PIDs by session identity directly. The function SHALL never throw; on command failure it SHALL return `[]`.

#### Scenario: Unix finds matching PIDs
- **WHEN** `findPidByMarker("session-abc", { platform: "linux" })` is called AND two processes have `session-abc` in their command line
- **THEN** the function SHALL return both PIDs as numbers

#### Scenario: Unix no match
- **WHEN** `findPidByMarker("no-such-marker", { platform: "linux" })` is called
- **THEN** the function SHALL return `[]`

#### Scenario: Windows returns empty array
- **WHEN** `findPidByMarker("any-marker", { platform: "win32" })` is called
- **THEN** the function SHALL return `[]` without executing any command

#### Scenario: macOS finds matching PIDs
- **WHEN** `findPidByMarker("session-abc", { platform: "darwin" })` is called AND a matching process exists
- **THEN** the function SHALL return the PID in an array

#### Scenario: Command failure returns empty array
- **WHEN** `findPidByMarker` is called AND the underlying `ps` command fails
- **THEN** the function SHALL return `[]` and SHALL NOT throw

### Requirement: Check if PID belongs to a pi-related process
The module SHALL export `isProcessLikePi(pid, opts?)` where `opts` accepts `{ platform?: NodeJS.Platform }`. On Unix, the function SHALL read the process command line (via `ps -p <pid> -o command=` on macOS or `/proc/<pid>/cmdline` on Linux with a `ps` fallback) and return `true` if the command line matches the pattern `\bpi\b|\bnode\b`. On Windows, the function SHALL return `true` unconditionally; Windows pi-ness verification is the responsibility of `headlessPidRegistry`. If the process has already exited (command fails), the function SHALL return `false` on Unix and `true` on Windows (matching current behaviour).

#### Scenario: Unix command line matches
- **WHEN** `isProcessLikePi(1234, { platform: "linux" })` is called AND `/proc/1234/cmdline` contains "node pi-coding-agent/cli.js"
- **THEN** the function SHALL return `true`

#### Scenario: Unix command line does not match
- **WHEN** `isProcessLikePi(5678, { platform: "linux" })` is called AND the process is a non-pi process (e.g., `bash`)
- **THEN** the function SHALL return `false`

#### Scenario: Unix process already exited
- **WHEN** `isProcessLikePi(9999, { platform: "linux" })` is called AND the process does not exist
- **THEN** the function SHALL return `false`

#### Scenario: Windows unconditional true
- **WHEN** `isProcessLikePi(1234, { platform: "win32" })` is called for any PID
- **THEN** the function SHALL return `true` without executing any command

### Requirement: Exported pattern matcher for reuse
The module SHALL export `isPiCommandLine(commandLine: string): boolean` returning `true` if the input string matches the pattern `\bpi\b|\bnode\b`. This SHALL be the shared predicate used by `isProcessLikePi` on Unix and by any future server-side consumer that needs to inspect a captured command line.

#### Scenario: Matches pi
- **WHEN** `isPiCommandLine("/usr/bin/pi --mode rpc")` is called
- **THEN** the function SHALL return `true`

#### Scenario: Matches node
- **WHEN** `isPiCommandLine("node cli.js")` is called
- **THEN** the function SHALL return `true`

#### Scenario: Does not match unrelated
- **WHEN** `isPiCommandLine("/bin/bash")` is called
- **THEN** the function SHALL return `false`

### Requirement: Platform override for tests
Both `findPidByMarker` and `isProcessLikePi` SHALL accept an optional `platform: NodeJS.Platform` field in their `opts` argument, defaulting to `process.platform`. Tests SHALL exercise all three branches (`win32`, `linux`, `darwin`) via explicit `platform` without mutating `process.platform` or using `vi.mock`.

#### Scenario: Tests exercise each platform branch
- **WHEN** tests invoke these functions with `platform: "win32"`, `"linux"`, and `"darwin"`
- **THEN** each invocation SHALL follow the correct OS branch
- **AND** tests SHALL NOT mutate `process.platform`
