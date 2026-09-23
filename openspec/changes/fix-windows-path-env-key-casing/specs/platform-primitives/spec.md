## ADDED Requirements

### Requirement: Spawn-env PATH key is case-normalized on Windows
Every shared helper that builds or augments a child-process environment's PATH SHALL, on Windows, treat all case variants of the PATH key (`PATH`, `Path`, `path`, …) as one variable. Its output SHALL carry exactly one PATH key, named `PATH`. That key SHALL keep every entry of the inherited PATH plus whatever the helper added. Entries SHALL be de-duplicated case-insensitively in first-seen order, with the value of the `PATH` key itself taken first. The helpers SHALL NOT mutate their input env or `process.env`. On non-Windows platforms, keys that differ only in case SHALL be treated as distinct variables and left untouched.

#### Scenario: Windows `Path` key is preserved through spawn-env construction
- **WHEN** the spawn environment is built on win32 from an env whose only PATH-like key is `Path` = `C:\Program Files\Git\cmd;C:\Windows\System32`
- **THEN** the result SHALL contain exactly one key whose upper-cased name is `PATH`, and that key SHALL be `PATH`
- **AND** its value SHALL include `C:\Program Files\Git\cmd` and `C:\Windows\System32`
- **AND** the dashboard-prepended directories SHALL come before those inherited entries

#### Scenario: Duplicate case variants are merged, not shadowed
- **WHEN** an env on win32 carries both `PATH` = `C:\managed` and `Path` = `C:\managed;C:\Program Files\Git\cmd`
- **THEN** the normalized env SHALL have a single `PATH` = `C:\managed;C:\Program Files\Git\cmd`
- **AND** no `Path` key SHALL remain

#### Scenario: Case-insensitive de-duplication on Windows
- **WHEN** an env on win32 carries `Path` = `C:\Windows\System32;c:\windows\system32`
- **THEN** the normalized `PATH` SHALL contain that directory only once

#### Scenario: POSIX env is unchanged
- **WHEN** an env on linux or darwin carries `PATH` = `/usr/bin` and `Path` = `/opt/x`
- **THEN** normalization SHALL return an env equal to the input, with both keys kept and neither value changed

#### Scenario: Idempotent
- **WHEN** a spawn-env helper is applied to its own output on win32
- **THEN** the result SHALL deep-equal the single-application result

#### Scenario: Input env is not mutated
- **WHEN** a spawn-env helper is called with an env object on win32
- **THEN** the caller's object SHALL keep its original keys and values
