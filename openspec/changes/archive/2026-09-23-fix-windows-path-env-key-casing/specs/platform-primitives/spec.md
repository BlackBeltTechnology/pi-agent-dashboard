## ADDED Requirements

### Requirement: Spawn-env PATH key is case-normalized on Windows
On Windows, any site that builds a child env from a copy of the process env and then writes or overlays PATH SHALL produce an env with at most one key whose upper-cased name is `PATH`, and that key SHALL be named `PATH`. This covers the shared spawn-env builder and the env-overlay sites.

Normalizing a single env:
- Merges all case variants (`PATH`, `Path`, `path`, …) into one `PATH`.
- Entries are `;`-separated and de-duplicated case-insensitively in first-seen order. The `PATH` key's value comes first, then the other variants in sorted key order.
- Empty entries are dropped. Variants whose value is JS `undefined` contribute nothing and are removed.
- If at least one variant has a string value (even an empty one), a `PATH` key SHALL be written, possibly as an empty string. Otherwise no `PATH` key SHALL be written.
- The env SHALL be returned as the same object when any of the following holds:
  - the platform is not Windows
  - no PATH variant exists
  - the only variant is a string-valued key named exactly `PATH`

When a caller-supplied env is overlaid on a process-env copy, both sides SHALL be normalized first. A caller-supplied PATH in any casing, including an empty one, then replaces the inherited PATH, matching POSIX overlay semantics.

The input env and `process.env` SHALL NOT be mutated. On non-Windows platforms, keys that differ only in case are distinct variables and SHALL be left untouched.

#### Scenario: Windows `Path` key is preserved through spawn-env construction
- **WHEN** the spawn environment is built on win32 from an env whose only PATH-like key is `Path` = `C:\Program Files\Git\cmd;C:\Windows\System32`
- **THEN** the result SHALL contain exactly one key whose upper-cased name is `PATH`, and that key SHALL be `PATH`
- **AND** its `;`-separated value SHALL include `C:\Program Files\Git\cmd` and `C:\Windows\System32`
- **AND** the dashboard-prepended directories SHALL come before those inherited entries

#### Scenario: Duplicate case variants are merged, not shadowed
- **WHEN** an env on win32 carries both `PATH` = `C:\managed` and `Path` = `C:\managed;C:\Program Files\Git\cmd`
- **THEN** the normalized env SHALL have a single `PATH` = `C:\managed;C:\Program Files\Git\cmd`
- **AND** no `Path` key SHALL remain

#### Scenario: Case-insensitive de-duplication on Windows
- **WHEN** an env on win32 carries `Path` = `C:\Windows\System32;c:\windows\system32`
- **THEN** the normalized `PATH` SHALL contain that directory only once

#### Scenario: Caller overlay replaces inherited PATH regardless of casing
- **WHEN** on win32 a caller env `{ Path: "C:\\caller" }` is overlaid on a process-env copy `{ Path: "C:\\Windows\\System32", FOO: "1" }`
- **THEN** the child env SHALL have exactly one PATH key, `PATH` = `C:\caller`, and SHALL keep `FOO` = `1`
- **WHEN** the caller env is `{ Path: "" }` instead
- **THEN** the child env SHALL have `PATH` = `""` and no other PATH-like key

#### Scenario: Undefined, empty and missing values
- **WHEN** an env on win32 carries `Path` = JS `undefined` and `PATH` = `C:\a`
- **THEN** normalization SHALL yield `PATH` = `C:\a`, with no `Path` key and without throwing
- **WHEN** an env on win32 carries only `Path` = JS `undefined`
- **THEN** normalization SHALL yield an env with no PATH-like key
- **WHEN** an env on win32 carries only `Path` = `""`
- **THEN** normalization SHALL yield `PATH` = `""`
- **WHEN** an env on win32 carries no PATH-like key
- **THEN** normalization SHALL return the same object

#### Scenario: Identity cases
- **WHEN** an env on win32 has exactly one PATH-like key, named `PATH`, with a string value
- **THEN** normalization SHALL return the same object
- **WHEN** an env on win32 has exactly one PATH-like key named `Path`
- **THEN** normalization SHALL return a new object in which that key is renamed to `PATH`

#### Scenario: POSIX env is unchanged
- **WHEN** an env on linux or darwin carries `PATH` = `/usr/bin` and `Path` = `/opt/x`
- **THEN** normalization SHALL return the same object, with both keys and values unchanged

#### Scenario: Idempotent
- **WHEN** normalization is applied to its own output on win32
- **THEN** the result SHALL be the same object as its input

#### Scenario: Input env is not mutated
- **WHEN** normalization or the spawn-env builder is called with an env object on win32 that needs merging
- **THEN** the caller's object SHALL keep its original keys and values
