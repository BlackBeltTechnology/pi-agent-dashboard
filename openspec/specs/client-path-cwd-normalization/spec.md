# client-path-cwd-normalization Specification

## Purpose

Rewrite a raw tool-call path into a cwd-relative display path so the client agrees with the server's relative-posix `data.files` keys, and detect paths a session wrote OUTSIDE its cwd. A change-summary row may carry an absolute `args.path` that never string-equals the relative diff key, blanking the diff; normalization resolves this by keying in-cwd paths relative and leaving out-of-cwd paths absolute as their out-of-cwd signal.

## Requirements

### Requirement: Absolute path detection across POSIX and Windows roots

The system SHALL treat a path as absolute when it begins with a POSIX root, a Windows backslash/UNC root, or a drive-letter root.

#### Scenario: POSIX root

- WHEN a path begins with `/` (e.g. `/home/user/project/src/a.ts`)
- THEN the system SHALL treat it as absolute

#### Scenario: Windows backslash or UNC root

- WHEN a path begins with `\` (e.g. `\\server\share\file.txt`)
- THEN the system SHALL treat it as absolute

#### Scenario: Drive-letter root

- WHEN a path begins with a drive letter followed by `:` and a separator (e.g. `C:\repo\a.ts` or `C:/repo/a.ts`)
- THEN the system SHALL treat it as absolute

#### Scenario: Relative path

- WHEN a path does not begin with any absolute root (e.g. `src/a.ts`)
- THEN the system SHALL treat it as not absolute

### Requirement: Normalize an in-cwd absolute path to relative-posix

The system SHALL rewrite an absolute path located under the session cwd into a relative-posix path, and SHALL leave already-relative paths, empty inputs, and paths with an unknown cwd unchanged.

#### Scenario: Absolute path under cwd

- WHEN `rawPath` is `/home/user/project/src/a.ts` and `cwd` is `/home/user/project`
- THEN the system SHALL return `src/a.ts`

#### Scenario: Windows path under cwd normalized to posix separators

- WHEN `rawPath` is `C:\repo\src\a.ts` and `cwd` is `C:\repo`
- THEN the system SHALL return `src/a.ts`

#### Scenario: Path equal to cwd

- WHEN `rawPath` resolves to exactly the `cwd` (e.g. both `/home/user/project`)
- THEN the system SHALL return an empty string

#### Scenario: cwd with trailing separators

- WHEN `cwd` is `/home/user/project/` and `rawPath` is `/home/user/project/src/a.ts`
- THEN the system SHALL strip the trailing separator(s) before comparing and SHALL return `src/a.ts`

#### Scenario: Already-relative path

- WHEN `rawPath` is `src/a.ts`
- THEN the system SHALL return it unchanged regardless of `cwd`

#### Scenario: Missing rawPath or cwd

- WHEN `rawPath` is empty OR `cwd` is undefined
- THEN the system SHALL return `rawPath` unchanged

### Requirement: Preserve absolute paths that escape the cwd boundary

The system SHALL leave an absolute path that is not under the cwd unchanged, without dropping or nulling it, so out-of-cwd entries remain addressable by their absolute key.

#### Scenario: Absolute path outside cwd

- WHEN `rawPath` is `/etc/hosts` and `cwd` is `/home/user/project`
- THEN the system SHALL return `/etc/hosts` unchanged

#### Scenario: Sibling directory sharing a prefix but not under cwd

- WHEN `rawPath` is `/home/user/project-other/a.ts` and `cwd` is `/home/user/project`
- THEN the system SHALL NOT treat `project-other` as under `project` and SHALL return the path unchanged

### Requirement: Detect out-of-cwd paths via residual absoluteness

The system SHALL report a path as out-of-cwd exactly when its normalized form is still absolute, since normalization makes in-cwd paths relative and leaves out-of-cwd paths absolute.

#### Scenario: In-cwd path is not out-of-cwd

- WHEN `rawPath` is `/home/user/project/src/a.ts` and `cwd` is `/home/user/project`
- THEN the system SHALL report the path as not out-of-cwd (its normalized form `src/a.ts` is relative)

#### Scenario: Out-of-cwd absolute path

- WHEN `rawPath` is `/etc/hosts` and `cwd` is `/home/user/project`
- THEN the system SHALL report the path as out-of-cwd (its normalized form is still absolute)

#### Scenario: Relative path is not out-of-cwd

- WHEN `rawPath` is `src/a.ts`
- THEN the system SHALL report the path as not out-of-cwd
