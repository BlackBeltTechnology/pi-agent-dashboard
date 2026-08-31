# boot-parent-liveness Specification

## Purpose

Determine whether the exact process the dashboard server was spawned under (its boot parent) is still alive, and expose the result plus the server's live parent PID through `/api/health` so Electron zombie detection can tell an orphaned/zombie parent from a live one. Windows never reparents orphans, so the POSIX `ppid !== bootParentPid` signal is unavailable there; a kernel-handle liveness check fills that gap.

## Requirements

### Requirement: Boot parent PID capture

The system SHALL capture the boot parent PID exactly once at module load and expose it as a stable value for the process lifetime.

#### Scenario: Boot parent PID recorded at load
- **WHEN** the boot-parent-liveness module loads
- **THEN** `bootParentPid` SHALL be set to `process.ppid` at that moment
- **AND** `bootParentPid` SHALL remain that value for the process lifetime regardless of later reparenting

#### Scenario: Boot parent PID exposed in health
- **WHEN** `/api/health` is requested
- **THEN** the response SHALL include `bootParentPid` as the number captured at load

### Requirement: Tier 1 cross-platform liveness check

The system SHALL provide a zero-dependency liveness check available on all platforms using a POSIX signal-0 probe, and SHALL never throw.

#### Scenario: Boot parent alive via signal 0
- **WHEN** `computeBootParentAlive()` runs on any platform without an active Tier-2 handle
- **AND** `process.kill(bootParentPid, 0)` succeeds
- **THEN** `isProcessAlive(bootParentPid)` SHALL return `true`
- **AND** `computeBootParentAlive()` SHALL return `true`

#### Scenario: Boot parent dead via signal 0
- **WHEN** `computeBootParentAlive()` runs without an active Tier-2 handle
- **AND** `process.kill(bootParentPid, 0)` throws
- **THEN** `isProcessAlive(bootParentPid)` SHALL return `false`
- **AND** `computeBootParentAlive()` SHALL return `false`

#### Scenario: PID reuse under-detection is tolerated
- **WHEN** the original boot parent has exited and its PID has been recycled by another live process
- **THEN** the Tier-1 signal-0 probe SHALL read `true` (alive)
- **AND** this SHALL only under-detect a zombie, never falsely report a live parent as dead

### Requirement: Tier 2 Windows identity-safe liveness check

On win32 the system SHALL, when possible, hold a `SYNCHRONIZE` handle to the specific boot parent process object via koffi and use `WaitForSingleObject` per request to detect that exact process exiting, immune to PID reuse.

#### Scenario: Tier 2 handle acquired at load
- **WHEN** the module loads on `win32`
- **AND** koffi loads `kernel32.dll` and `OpenProcess(SYNCHRONIZE, false, bootParentPid)` returns a non-null handle
- **THEN** the system SHALL retain that handle and a bound `WaitForSingleObject` function
- **AND** `bootParentLivenessTier()` SHALL report `"tier2"`

#### Scenario: Boot parent still alive on Windows
- **WHEN** `computeBootParentAlive()` runs with an active Tier-2 handle
- **AND** `WaitForSingleObject(handle, 0)` returns a value other than `WAIT_OBJECT_0` (`0x0`)
- **THEN** `computeBootParentAlive()` SHALL return `true`

#### Scenario: Boot parent exited on Windows (zombie)
- **WHEN** `computeBootParentAlive()` runs with an active Tier-2 handle
- **AND** `WaitForSingleObject(handle, 0)` returns `WAIT_OBJECT_0` (the process signalled/exited)
- **THEN** `computeBootParentAlive()` SHALL return `false`

#### Scenario: Tier 2 immune to PID reuse
- **WHEN** the boot parent has exited on win32 and its PID is recycled
- **THEN** the retained handle SHALL still refer to the original process object (the kernel pins it while the handle is held)
- **AND** `WaitForSingleObject(handle, 0)` SHALL return `WAIT_OBJECT_0` and report the boot parent dead

### Requirement: Tier 2 to Tier 1 degradation

The system SHALL fall back to Tier 1 on any Tier-2 unavailability or failure, permanently, and SHALL never throw from `computeBootParentAlive()`.

#### Scenario: koffi or OpenProcess unavailable at load
- **WHEN** the module loads on `win32`
- **AND** koffi fails to load, or `OpenProcess` throws, or `OpenProcess` returns a null handle
- **THEN** Tier 2 SHALL be permanently disabled
- **AND** `computeBootParentAlive()` SHALL route to the Tier-1 signal-0 probe
- **AND** `bootParentLivenessTier()` SHALL report `"tier1"`

#### Scenario: WaitForSingleObject throws at runtime
- **WHEN** `computeBootParentAlive()` calls `WaitForSingleObject` and it throws
- **THEN** Tier 2 SHALL be permanently disabled
- **AND** the call SHALL fall through to the Tier-1 signal-0 probe and return its result

#### Scenario: Non-win32 platforms use Tier 1
- **WHEN** the module loads on any platform other than `win32`
- **THEN** no Tier-2 handle SHALL be acquired
- **AND** `bootParentLivenessTier()` SHALL report `"tier1"`

### Requirement: Live parent PID reader

The system SHALL read the server's live (reparenting-aware) parent PID fresh on each call, rather than returning the value Node caches on first `process.ppid` access.

#### Scenario: Linux reads /proc/self/stat
- **WHEN** `readLivePpid()` is called on `linux`
- **THEN** it SHALL read `/proc/self/stat`, slice after the last `)`, and parse the ppid field (field after process state) without spawning a subprocess
- **AND** if the read or parse fails or yields a non-finite number, it SHALL return `process.ppid`

#### Scenario: macOS reads via ps
- **WHEN** `readLivePpid()` is called on `darwin`
- **THEN** it SHALL run `ps -o ppid= -p <pid>` via `execFileSync` (no shell) with a 1000 ms timeout and parse the output
- **AND** if the command fails, times out, or yields a non-finite number, it SHALL return `process.ppid`

#### Scenario: Windows and other platforms return cached ppid
- **WHEN** `readLivePpid()` is called on `win32` or any other platform
- **THEN** it SHALL return `process.ppid` (Windows never reparents, so zombie detection relies on `bootParentAlive` instead)

### Requirement: Health endpoint integration

`/api/health` SHALL expose the boot parent PID, the live parent PID, and the boot-parent liveness result so clients can perform Electron zombie detection.

#### Scenario: Health reports liveness fields
- **WHEN** `/api/health` is requested
- **THEN** the response SHALL include `bootParentPid` (static, captured at load), `ppid` from `readLivePpid()` (live), and `bootParentAlive` from `computeBootParentAlive()`
- **AND** POSIX clients SHALL compare live `ppid` against `bootParentPid` together with `bootParentAlive`, while Windows clients SHALL rely on `bootParentAlive` alone

### Requirement: An ephemeral server exits when its boot parent dies

A server started in ephemeral mode SHALL terminate once its boot parent is
determined dead. Ephemeral mode SHALL be explicit opt-in via a flag; it SHALL
NOT be enabled by an environment variable, nor inferred from the home
directory, the bind address, or the port. A server not in ephemeral mode SHALL
be unaffected, regardless of its boot parent's state. The liveness check driving
the exit SHALL evaluate on a bounded cadence so exit latency after parent death
has a stated upper bound. Termination SHALL go through the server's normal
graceful-stop path (draining spawned sessions and recording an exit intent), not
a raw process exit, and that exit intent SHALL suppress crash recovery.

For the kill decision, "dead" SHALL mean the boot parent PID could not be
signalled because it does not exist (`ESRCH`, or the Windows Tier-2
signalled-exit). A signal failure that is NOT proof of absence — notably
`EPERM` (parent alive but owned by another user / hardened) — SHALL be treated
as ALIVE, so the server never exits while its parent lives. Where the
reuse-immune Tier-2 handle exists (Windows), it SHALL be authoritative over the
Tier-1 signal-0 probe.

#### Scenario: Ephemeral server terminates after its parent exits
- **GIVEN** a server started in ephemeral mode
- **WHEN** its boot parent exits
- **AND** the next bounded liveness evaluation reports the boot parent absent (`ESRCH`)
- **THEN** the server SHALL shut down
- **AND** the shutdown reason SHALL name the dead boot parent

#### Scenario: Standalone server with a dead boot parent keeps running
- **GIVEN** a server NOT started in ephemeral mode
- **AND** `/api/health` reports `bootParentAlive: false`
- **THEN** the server SHALL keep running
- **AND** SHALL NOT shut down on that basis

#### Scenario: Ephemeral mode is not inferred
- **GIVEN** a server whose `HOME` is a temporary directory and which is bound to loopback
- **AND** ephemeral mode was not requested explicitly
- **THEN** the server SHALL NOT be treated as ephemeral

#### Scenario: A permission error is not treated as parent death
- **GIVEN** an ephemeral server whose boot-parent liveness probe fails with `EPERM`
- **THEN** the boot parent SHALL be treated as alive
- **AND** the server SHALL keep running
- **AND** SHALL NOT shut down on that basis

#### Scenario: POSIX PID reuse defers the exit rather than causing a false one
- **GIVEN** an ephemeral server on POSIX whose boot parent has exited
- **AND** the boot parent's PID has been recycled by another live process
- **AND** only the Tier-1 signal-0 probe is available
- **THEN** the Tier-1 probe SHALL read the parent as alive
- **AND** the server SHALL keep running

#### Scenario: Windows PID reuse resolves via the reuse-immune tier
- **GIVEN** an ephemeral server on Windows whose boot parent has exited
- **AND** the boot parent's PID has been recycled by another live process
- **WHEN** the reuse-immune Tier-2 handle reports the original parent exited
- **THEN** the Tier-2 verdict SHALL be authoritative
- **AND** the server SHALL shut down

#### Scenario: Ephemeral mode is not enabled by an environment variable
- **GIVEN** `PI_DASHBOARD_EPHEMERAL` is set in the environment
- **AND** the ephemeral flag was not passed explicitly
- **THEN** the server SHALL NOT be treated as ephemeral

#### Scenario: Ephemeral state is visible in health
- **WHEN** `/api/health` is requested on an ephemeral server
- **THEN** the response SHALL indicate that the server is ephemeral
