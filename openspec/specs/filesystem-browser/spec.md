## Purpose
Server-side directory browse API plus the PathPicker UI for choosing filesystem paths when pinning directories or spawning sessions.
## Requirements
### Requirement: Directory browse API
The server SHALL expose `GET /api/browse?path=<dir>&q=<query>&detect=<0|1>` (localhost-only) that returns directory entries for the given path. The response SHALL include `{ success: true, data: { entries: Array<{ name, path, isGit?, isPi? }>, parent: string | null, current: string } }`. Only directories SHALL be listed (no files). Hidden directories (names starting with `.`) SHALL be excluded. If `path` is omitted, it SHALL default to the user's home directory. The entry limit SHALL be 200, applied AFTER filtering and ranking so best matches are never truncated.

When `detect` is omitted, empty, or any value other than `1`, the server SHALL skip per-entry `.git` / `.pi` detection and SHALL omit the `isGit` and `isPi` fields from each entry. The default response is therefore a single-`readdir` enumeration with no per-entry filesystem probes.

When `detect=1`, the server SHALL probe each returned entry's `.git` and `.pi` paths (using `fs.access`-style detection — any error including ENOENT, EACCES, ELOOP, or race-on-deletion SHALL map to `false`) and SHALL populate `isGit` and `isPi` accordingly on every entry.

When `q` is omitted or empty, entries SHALL be sorted alphabetically (case-insensitive).

When `q` is provided, entries SHALL be filtered case-insensitively by substring on `name` and SHALL be ranked into the following tiers, alphabetical within each tier:
- **Tier 0** — exact case-insensitive match of `name` against `q`.
- **Tier 1** — `name` starts with `q` (case-insensitive).
- **Tier 2** — `q` occurs in `name` at a word boundary (preceded by the start of the string or by one of `-`, `_`, `.`, ` `, `/`), case-insensitive.
- **Tier 3** — `q` occurs anywhere in `name` (case-insensitive).

#### Scenario: Browse valid directory without detection
- **WHEN** a GET request is made to `/api/browse?path=/home/user/projects` (no `detect`)
- **THEN** the server SHALL return a list of subdirectories
- **AND** each entry SHALL omit the `isGit` and `isPi` fields
- **AND** no per-entry `.git` / `.pi` filesystem probe SHALL be performed

#### Scenario: Browse valid directory with detection enabled
- **WHEN** a GET request is made to `/api/browse?path=/home/user/projects&detect=1`
- **THEN** the server SHALL return a list of subdirectories
- **AND** each entry SHALL include boolean `isGit` and `isPi` fields reflecting the presence of `.git` and `.pi` directories or files at that entry's path

#### Scenario: detect parameter accepts only `1` as truthy
- **WHEN** a GET request is made with `detect=true`, `detect=yes`, or any value other than `1`
- **THEN** the server SHALL behave as if `detect` were omitted (no probe, fields omitted)

#### Scenario: detect probe failures surface as false
- **WHEN** `detect=1` is requested and an entry's `.git` or `.pi` lookup fails for any reason (ENOENT, EACCES, ELOOP, or the entry is removed mid-request)
- **THEN** the corresponding flag SHALL be `false` for that entry
- **AND** the request SHALL still succeed

#### Scenario: Browse home directory (default)
- **WHEN** a GET request is made to `/api/browse` without a path parameter
- **THEN** the server SHALL return entries for the user's home directory (`os.homedir()`)

#### Scenario: Browse non-existent directory
- **WHEN** a GET request is made with a path that does not exist
- **THEN** the server SHALL return `{ success: false, error: "directory not found" }`

#### Scenario: Parent path included
- **WHEN** a directory listing is returned for `/home/user/projects`
- **THEN** the `parent` field SHALL be `/home/user`

#### Scenario: Root directory has no parent
- **WHEN** a directory listing is returned for `/`
- **THEN** the `parent` field SHALL be `null`

#### Scenario: Remote access blocked
- **WHEN** a GET request originates from a non-loopback address
- **THEN** the server SHALL return `{ success: false, error: "localhost only" }`

#### Scenario: Hidden directories excluded
- **WHEN** a directory contains subdirectories like `.config`, `.cache`, `projects`
- **THEN** only `projects` SHALL appear in the entries (hidden dirs excluded)

#### Scenario: Entry limit applies after filtering
- **WHEN** a directory contains 300 subdirectories and `q=pi` is supplied
- **THEN** the server SHALL filter and rank first, then return at most 200 entries
- **AND** a directory named `pi-dashboard` SHALL appear in the results even if alphabetically past position 200

#### Scenario: Substring filter returns non-prefix matches
- **WHEN** a GET request is made with `q=dash` against a directory containing `pi-dashboard`, `my-dashboard-old`, and `readme`
- **THEN** `pi-dashboard` and `my-dashboard-old` SHALL appear in the results
- **AND** `readme` SHALL NOT appear

#### Scenario: Ranking by tier
- **WHEN** a GET request is made with `q=pi` against a directory containing `pi` (tier 0), `pi-core` (tier 1), `my-pi-tools` (tier 2), and `epiphany` (tier 3)
- **THEN** the entries SHALL be returned in the order `pi`, `pi-core`, `my-pi-tools`, `epiphany`

#### Scenario: Alphabetical order within tier
- **WHEN** two entries are in the same rank tier (e.g. both match `pi` as prefix)
- **THEN** they SHALL appear in case-insensitive alphabetical order

#### Scenario: Empty query treated as no filter
- **WHEN** `q` is an empty string or only whitespace
- **THEN** the server SHALL behave as if `q` were omitted (alphabetical, unfiltered)

### Requirement: Directory flag classification API
The server SHALL expose `GET /api/browse/flags?paths=<json-array>` (localhost-only) that classifies a batch of absolute paths as git repositories and/or pi projects. The `paths` query value SHALL be a URL-encoded JSON array of absolute path strings.

The response on success SHALL be:

```
{
  success: true,
  data: {
    flags: { [absolutePath: string]: { isGit: boolean; isPi: boolean } }
  }
}
```

The response key set SHALL equal the input `paths` set (one classification per input path, no extras, no omissions). For every input path the server SHALL probe `<path>/.git` and `<path>/.pi` using `fs.access`-style detection: any error (ENOENT, EACCES, ELOOP, race-on-deletion, target is not a directory, anything else) SHALL map the corresponding flag to `false`. The endpoint SHALL never throw out of a single bad path — only out-of-protocol failures (malformed `paths` JSON, over-cap input) SHALL produce a top-level error.

The endpoint SHALL cap input length at 100 paths per request. Internal probe concurrency SHALL be bounded (initial value 32 in-flight `fs.access` calls).

#### Scenario: Bulk classification of mixed paths
- **WHEN** a GET request is made with `paths=["/a/git-repo","/a/pi-project","/a/plain"]` where `/a/git-repo/.git` exists, `/a/pi-project/.pi` exists, and `/a/plain` is a plain directory
- **THEN** the response `data.flags` SHALL contain `"/a/git-repo": { isGit: true, isPi: false }`, `"/a/pi-project": { isGit: false, isPi: true }`, and `"/a/plain": { isGit: false, isPi: false }`

#### Scenario: Bulk classification of a non-existent path
- **WHEN** the request includes a path that does not exist on disk
- **THEN** the response SHALL include that path with `{ isGit: false, isPi: false }`
- **AND** the request SHALL still return `success: true`

#### Scenario: Path-count cap exceeded
- **WHEN** a GET request is made with more than 100 paths in the `paths` array
- **THEN** the server SHALL return `{ success: false, error: "too many paths" }` with HTTP 400
- **AND** no filesystem probe SHALL be performed

#### Scenario: Malformed paths parameter
- **WHEN** the `paths` query value is missing, empty, not valid JSON, or not an array of strings
- **THEN** the server SHALL return `{ success: false, error: "invalid paths" }` with HTTP 400

#### Scenario: Bulk classification remote access blocked
- **WHEN** a GET request to `/api/browse/flags` originates from a non-loopback address
- **THEN** the server SHALL return `{ success: false, error: "localhost only" }`

#### Scenario: Empty paths array
- **WHEN** a GET request is made with `paths=[]`
- **THEN** the server SHALL return `{ success: true, data: { flags: {} } }`
- **AND** no filesystem probe SHALL be performed

### Requirement: Directory create API
The server SHALL expose `POST /api/browse/mkdir` (localhost-only) that creates a new directory under a specified parent. The request body SHALL be `{ parent: string, name: string }`. On success the response SHALL be `{ success: true, data: { path: string } }` where `path` is the absolute path of the created directory.

The server SHALL validate:
- `parent` is an absolute path, exists on disk, and is a directory.
- `name` is non-empty after trimming, is not `.` or `..`, contains no `/` or backslash or `\0`, and has no leading or trailing whitespace.

Directory creation SHALL be non-recursive (`fs.mkdir` without `recursive: true`): if the target already exists the server SHALL fail rather than silently succeed.

#### Scenario: Create a new folder
- **WHEN** a POST request is made to `/api/browse/mkdir` with body `{ parent: "/home/user/projects", name: "new-thing" }` and `/home/user/projects/new-thing` does not exist
- **THEN** the server SHALL create the directory and return `{ success: true, data: { path: "/home/user/projects/new-thing" } }`

#### Scenario: Parent does not exist
- **WHEN** `parent` points to a non-existent path
- **THEN** the server SHALL return `{ success: false, error: "parent not found" }`

#### Scenario: Parent is a file
- **WHEN** `parent` points to a regular file
- **THEN** the server SHALL return `{ success: false, error: "parent is not a directory" }`

#### Scenario: Target already exists
- **WHEN** a directory with that `name` already exists under `parent`
- **THEN** the server SHALL return `{ success: false, error: "already exists" }`

#### Scenario: Invalid name - path separator
- **WHEN** `name` contains `/` or backslash (e.g. `"foo/bar"`)
- **THEN** the server SHALL return `{ success: false, error: "invalid name" }` and SHALL NOT create any directory

#### Scenario: Invalid name - traversal
- **WHEN** `name` is `.` or `..`
- **THEN** the server SHALL return `{ success: false, error: "invalid name" }` and SHALL NOT create any directory

#### Scenario: Invalid name - null byte
- **WHEN** `name` contains a null byte (`\0`)
- **THEN** the server SHALL return `{ success: false, error: "invalid name" }` and SHALL NOT create any directory

#### Scenario: Invalid name - empty or whitespace
- **WHEN** `name` is empty, whitespace-only, or has leading/trailing whitespace
- **THEN** the server SHALL return `{ success: false, error: "invalid name" }` and SHALL NOT create any directory

#### Scenario: Remote access blocked
- **WHEN** a POST request originates from a non-loopback address
- **THEN** the server SHALL return `{ success: false, error: "localhost only" }` and SHALL NOT create any directory

### Requirement: PathPicker component
The PathPicker (Pin Directory dialog) SHALL browse directories via `GET /api/browse` and render an inline error region on failure. When the failure is a network-guard denial (HTTP 403 with `error: "network_not_allowed"`), the PathPicker SHALL render the server-supplied `hint` and an affordance to Settings → Servers — NOT a bare "Access denied" string. Other failures (e.g. directory not found, transport error) SHALL keep their existing error copy.

#### Scenario: Browse denied by network guard
- **WHEN** `GET /api/browse` returns HTTP 403 with `{ error: "network_not_allowed", hint }`
- **THEN** the PathPicker SHALL render the `hint` (remedy) text instead of a bare "Access denied"
- **AND** SHALL offer a link/affordance to Settings → Servers to add the network to `trustedNetworks`

#### Scenario: Browse non-denial error unchanged
- **WHEN** `GET /api/browse` fails for a non-403 reason (directory not found, transport error)
- **THEN** the PathPicker SHALL render its existing error copy for that case

### Requirement: PathPicker new folder creation
The `PathPicker` component SHALL let users create a new directory inside the currently-browsed parent directory via two affordances:
1. A footer **＋ New folder** button that opens an inline name-entry row at the top of the list.
2. An inline **＋ Create "<name>" here** row shown at the bottom of the list when the typed partial is non-empty AND no visible entry exactly matches the partial.

Both SHALL call `POST /api/browse/mkdir` with `{ parent: <currently-browsed directory>, name: <entered name> }`. On success the picker SHALL refresh the list and descend into the newly created directory (input becomes `<newPath>/`). On failure the server error SHALL be displayed inline in the existing error slot and the picker SHALL remain on the current directory.

#### Scenario: Inline create from typed partial
- **WHEN** the user types `new-thing` into the input, no existing entry matches exactly, and presses Enter while the "Create \"new-thing\" here" row is highlighted
- **THEN** the picker SHALL call `POST /api/browse/mkdir` with `parent` = the currently-browsed directory and `name="new-thing"`
- **AND** on success the input SHALL become `<parent>/new-thing/` and the list SHALL show the new (empty) directory's contents

#### Scenario: Footer New folder button
- **WHEN** the user clicks **＋ New folder** and types `experiments` then presses Enter
- **THEN** the picker SHALL call `POST /api/browse/mkdir` with `parent` = the currently-browsed directory and `name="experiments"`
- **AND** on success the input SHALL become `<parent>/experiments/` and the list SHALL show the new directory's contents

#### Scenario: Footer name entry cancelled
- **WHEN** the user opens the footer name entry and presses Escape
- **THEN** no directory SHALL be created
- **AND** focus SHALL return to the main input
- **AND** the inline name entry row SHALL close

#### Scenario: Create fails with existing name
- **WHEN** the server returns `{ success: false, error: "already exists" }`
- **THEN** the error SHALL be displayed in the PathPicker's error slot
- **AND** the input SHALL remain unchanged
- **AND** the picker SHALL NOT descend

#### Scenario: Create fails with invalid name
- **WHEN** the user enters a name containing `/` and submits
- **THEN** the server SHALL reject the request with `"invalid name"` and the error SHALL be shown inline
- **AND** no directory SHALL be created

#### Scenario: Inline create hidden on exact match
- **WHEN** the typed partial exactly matches an existing visible entry name (case-insensitive)
- **THEN** the inline "Create here" row SHALL NOT be shown

