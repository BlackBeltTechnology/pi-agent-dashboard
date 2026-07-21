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
