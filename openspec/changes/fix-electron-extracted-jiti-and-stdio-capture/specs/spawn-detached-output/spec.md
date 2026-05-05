## ADDED Requirements

### Requirement: spawnDetached routes logFd to both stdout and stderr
The `spawnDetached(opts)` primitive in `packages/shared/src/platform/detached-spawn.ts` SHALL, when `opts.logFd` is supplied, attach that file descriptor to BOTH the child's stdout (`stdio[1]`) and stderr (`stdio[2]`). When `opts.logFd` is omitted, BOTH stdout and stderr SHALL be `"ignore"` (no behavioral change for that case). The `stdio[0]` slot is unchanged: it follows `opts.stdinMode` (default `"ignore"`).

This consolidates capture semantics so a single `logFd` produces a usable `server.log` regardless of whether the child writes via `console.log` (stdout) or `console.error` (stderr). Prior behavior dropped stdout, which silently produced 0-byte log files for any child whose normal startup output went to stdout.

#### Scenario: logFd captures both stdout and stderr
- **GIVEN** a temp file opened with `fs.openSync(path, "a")` yielding `logFd`
- **WHEN** `spawnDetached({ cmd: "node", args: ["-e", "console.log('hi'); process.stderr.write('bye')"], logFd })` is called and the child exits
- **THEN** the contents of the temp file SHALL contain both the substring `"hi\n"` (from stdout) and the substring `"bye"` (from stderr)

#### Scenario: logFd omitted — both streams ignored
- **WHEN** `spawnDetached({ cmd, args })` is called without `logFd`
- **THEN** the child's stdout and stderr SHALL both be discarded (Node `"ignore"`)
- **AND** no parent-side pipe SHALL be created for stdout or stderr by `spawnDetached` itself (callers wanting a pipe must construct one outside this primitive)

#### Scenario: stdin mode is independent of log capture
- **WHEN** `spawnDetached({ cmd, args, logFd, stdinMode: "pipe" })` is called
- **THEN** `stdio[0]` SHALL be `"pipe"` (parent retains a writable stream)
- **AND** `stdio[1]` and `stdio[2]` SHALL both be `logFd`

#### Scenario: doc comment matches behavior
- **WHEN** a developer reads the JSDoc on `SpawnDetachedOptions.logFd`
- **THEN** the comment SHALL describe `logFd` as "Optional file descriptor for combined stdout + stderr" — not "stderr only"
