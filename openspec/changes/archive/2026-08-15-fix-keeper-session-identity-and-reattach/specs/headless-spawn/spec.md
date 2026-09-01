## ADDED Requirements

### Requirement: Pi PID capture SHALL follow an identity-bearing resolution only

For a keeper-mode registry entry (`keeperPid !== undefined`), the registry SHALL record
`entry.piPid` from a `session_register` that resolves that entry **when, and only when, the
resolution was identity-bearing** — that is, performed by the spawn-token tier or the
pid-matching tier. Both match on a value unique to the session.

The cwd-FIFO tier SHALL NEVER cause `piPid` to be recorded, irrespective of how many candidate
entries existed. That tier matches on arrival order within a cwd, so the entry it selects is not
known to belong to the registering session — a lone unlinked entry may belong to a session that
has not registered yet. Recording there would persist a PID belonging to a different session and
grant `killBySessionId` false confidence. Entries linked only by cwd-FIFO SHALL obtain their pi
PID from the keeper's pi-PID sidecar instead.

When the register carries no pid, the registry SHALL link as before and leave `piPid` unset.

Note: for a keeper-mode entry the spawn-time `pid` is the keeper's PID and the register carries
pi's PID, so the two always differ. Any "pid differs" condition is a type-correctness assertion,
not a safety discriminator, and SHALL NOT be relied on to prevent a wrong capture.

The registry SHALL persist the entry after recording `piPid`.

#### Scenario: Pid-tier resolution captures piPid

- **GIVEN** a keeper-mode entry with `keeperPid = K`, `pid = K`, and `piPid` unset
- **WHEN** a `session_register` carrying `pid = P` resolves that entry via the pid-matching tier
- **THEN** the registry SHALL set `entry.piPid = P` and persist the entry

#### Scenario: Single-candidate cwd-FIFO resolution SHALL NOT capture piPid

- **GIVEN** exactly one unlinked keeper-mode entry for cwd `C`
- **WHEN** a `session_register` for cwd `C` carrying `pid = P` resolves it via the cwd-FIFO tier
- **THEN** the registry SHALL leave `piPid` unset on that entry
- **AND** the registry SHALL report the positional resolution

#### Scenario: Multi-candidate cwd-FIFO resolution SHALL NOT capture piPid

- **GIVEN** two unlinked keeper-mode entries for cwd `C`
- **WHEN** a `session_register` for cwd `C` carrying `pid = P` resolves one of them via the cwd-FIFO tier
- **THEN** the registry SHALL leave `piPid` unset on that entry
- **AND** the registry SHALL report the positional resolution

#### Scenario: Register without a pid leaves piPid unset

- **GIVEN** a keeper-mode entry with `piPid` unset
- **WHEN** a `session_register` carrying no pid resolves it
- **THEN** the entry SHALL be linked as before
- **AND** `piPid` SHALL remain unset

#### Scenario: Non-keeper entries are unaffected

- **GIVEN** a non-keeper entry (`keeperPid === undefined`)
- **WHEN** any tier resolves it
- **THEN** `piPid` SHALL remain undefined
- **AND** pid consumers SHALL continue to fall back to `entry.pid`

### Requirement: The keeper's pi-PID sidecar SHALL fill an absent `piPid`

The pi PID recorded by the keeper after spawning pi SHALL be used to populate `entry.piPid` for
entries that do not have one — the reclaimed and cwd-FIFO-linked populations.

The sidecar SHALL NOT override a `piPid` already established by an identity-bearing capture. A
capture from the spawn-token or pid-matching tier can only occur while pi is alive, so it names
the same process the sidecar does; treating the file as an arbiter over the stronger per-spawn
secret would invert the trust order without any reachable disagreement to resolve.

When the sidecar is absent, unreadable, or unparseable, the registry SHALL leave `piPid` exactly
as it was.

The registry SHALL NOT infer a pi PID from a cwd, a process name, or a process-tree enumeration.

#### Scenario: Sidecar fills an absent piPid

- **GIVEN** an entry with `piPid` unset and a live keeper
- **AND** the keeper's pi-PID sidecar contains a live PID `Y`
- **WHEN** keeper discovery runs
- **THEN** the registry SHALL set `entry.piPid = Y` and persist it

#### Scenario: Sidecar does not override an existing piPid

- **GIVEN** an entry persisting `piPid = X`
- **WHEN** keeper discovery reads a pi-PID sidecar for that session
- **THEN** `entry.piPid` SHALL remain `X`

#### Scenario: Absent sidecar leaves the entry untouched

- **GIVEN** an entry and no readable pi-PID sidecar
- **WHEN** keeper discovery runs
- **THEN** `entry.piPid` SHALL be left exactly as it was

#### Scenario: Unparseable sidecar never produces a guess

- **GIVEN** a pi-PID sidecar whose contents do not parse as a positive integer
- **WHEN** keeper discovery runs
- **THEN** the registry SHALL leave `piPid` unchanged
- **AND** SHALL NOT derive a PID from any other source

### Requirement: A recorded pi PID SHALL be liveness-checked before it is trusted

A PID that names a dead process is a latent hazard: OS PID reuse can turn it into a live,
unrelated process that a later kill would terminate. The server SHALL verify that a pi PID read
from a sidecar refers to a live process before recording it during discovery.

This check rejects a PID naming a dead process. It SHALL NOT be relied on to detect a PID that
has already been reused by an unrelated live process, which passes a liveness test. The residual
window spans pi's death until the keeper unlinks its sidecar during shutdown.

#### Scenario: Dead pi PID is not recorded

- **GIVEN** a pi-PID sidecar containing PID `P`
- **AND** `P` is not alive
- **WHEN** keeper discovery runs
- **THEN** the registry SHALL NOT record `P`
- **AND** the condition SHALL be observable

#### Scenario: A missing sidecar SHALL NOT be treated as a dead pi

- **GIVEN** a live keeper with no pi-PID sidecar, because the write failed or it predates this change
- **WHEN** keeper discovery evaluates pi liveness for that session
- **THEN** the liveness result SHALL be "alive"
- **AND** the server SHALL NOT terminate the keeper on the basis of the missing file

#### Scenario: Live pi PID is recorded

- **GIVEN** a pi-PID sidecar containing a live PID `P` for a live keeper
- **WHEN** keeper discovery runs
- **THEN** the registry SHALL record `entry.piPid = P`

### Requirement: Positional resolution of a keeper session SHALL be reported

The cwd-FIFO tier selects by arrival order, so a keeper session resolved that way had its identity
decided by position rather than by any value unique to it. The server SHALL report whenever the
cwd-FIFO tier resolves a keeper-mode entry.

The report SHALL NOT be interpreted as a mis-map count. Nothing at that point knows the true owner
of the entry — that is precisely why the tier is untrusted for capture — so the signal records
that identity was decided positionally, not that it was decided wrongly.

A cwd-FIFO call that matches nothing SHALL NOT be reported.

#### Scenario: Positional resolution of a keeper entry is reported

- **GIVEN** one or more unlinked keeper-mode entries sharing cwd `C`
- **WHEN** a `session_register` for cwd `C` resolves one of them via the cwd-FIFO tier
- **THEN** the server SHALL report the positional resolution naming the cwd and the resolved entry

#### Scenario: Non-matching cwd-FIFO call is not reported

- **GIVEN** a `session_register` for a cwd with no keeper-mode entry
- **WHEN** the register falls through to the cwd-FIFO tier and matches nothing
- **THEN** the server SHALL NOT report a mis-map risk
