# platform-paths Specification

## Purpose

OS-aware path primitives concentrated in a single shared module. Centralizes normalization, equality, and user-input parsing for filesystem paths so the rest of the codebase does not branch on `process.platform` for path decisions.

## Requirements

### Requirement: platform/paths module
The dashboard SHALL expose a `packages/shared/src/platform/paths.ts` module containing OS-aware path primitives. The module SHALL be exported from `packages/shared/src/platform/index.ts` as a namespace (`paths.*`) alongside the existing `git.*`, `openspec.*`, and `npm.*` namespaces.

#### Scenario: Module is namespace-exported
- **WHEN** a consumer imports from `@blackbelt-technology/pi-dashboard-shared/platform`
- **THEN** the import surface SHALL expose a `paths` namespace whose members include at minimum `normalizePath`, `samePath`, and `parsePathInput`

#### Scenario: Module has no dependencies beyond Node stdlib
- **WHEN** `packages/shared/src/platform/paths.ts` is inspected
- **THEN** it SHALL import only from `node:path` and `node:fs` (plus types from `./index.js` if needed)
- **AND** it SHALL NOT import from `node:child_process`, `node:os` (beyond `os.homedir` if needed for tilde expansion), or any dashboard-local module outside `packages/shared/src/platform/`

### Requirement: normalizePath canonicalizes any input to the OS-native form
`normalizePath(p, platform = process.platform)` SHALL return a path string where: separators match the OS (`\` on win32, `/` elsewhere), redundant separators are collapsed, `.` and `..` segments are resolved, trailing separators are removed except for roots, and the original case is preserved (NO lowercasing).

#### Scenario: Windows trailing separator is removed
- **WHEN** `normalizePath("C:\\Dev\\BB\\pi-agent-dashboard\\", "win32")` is called
- **THEN** the result SHALL equal `"C:\\Dev\\BB\\pi-agent-dashboard"`

#### Scenario: Windows mixed separators are canonicalized
- **WHEN** `normalizePath("C:/Dev\\BB/pi-agent-dashboard", "win32")` is called
- **THEN** the result SHALL equal `"C:\\Dev\\BB\\pi-agent-dashboard"`

#### Scenario: Windows root is preserved (any drive letter)
- **WHEN** `normalizePath("C:\\", "win32")` is called
- **THEN** the result SHALL equal `"C:\\"` (trailing separator retained for root)
- **AND** the same behavior SHALL hold for every drive letter (`A:\\` → `A:\\`, `B:\\` → `B:\\`, `Z:\\` → `Z:\\`)

#### Scenario: Drive letter case is preserved in normalization output
- **WHEN** `normalizePath("b:\\Dev\\BB", "win32")` is called
- **THEN** the result SHALL equal `"b:\\Dev\\BB"` (drive-letter case preserved, NOT folded to upper/lower)
- **AND** case folding SHALL only happen inside `samePath` at compare time

#### Scenario: Windows UNC path is preserved
- **WHEN** `normalizePath("\\\\server\\share\\path\\", "win32")` is called
- **THEN** the result SHALL equal `"\\\\server\\share\\path"`

#### Scenario: Unix trailing separator is removed
- **WHEN** `normalizePath("/Users/me/Projects/", "linux")` is called
- **THEN** the result SHALL equal `"/Users/me/Projects"`

#### Scenario: Unix root is preserved
- **WHEN** `normalizePath("/", "linux")` is called
- **THEN** the result SHALL equal `"/"`

#### Scenario: Relative segments are resolved
- **WHEN** `normalizePath("C:\\Dev\\BB\\..\\.\\pi-agent-dashboard", "win32")` is called
- **THEN** the result SHALL equal `"C:\\Dev\\pi-agent-dashboard"`

#### Scenario: Case is preserved
- **WHEN** `normalizePath("C:\\Dev\\BB", "win32")` is called and the path happens to exist on disk as `C:\Dev\BB`
- **THEN** the result SHALL equal `"C:\\Dev\\BB"` (exactly as input, not `c:\dev\bb`)

### Requirement: Different drives never match
Paths rooted at different Windows drive letters SHALL be treated as different filesystems. `samePath` SHALL return `false` for any pair whose drive letters (case-folded) differ, regardless of how similar the rest of the path is. UNC paths (`\\server\share\...`) SHALL likewise be treated as distinct from any drive-letter path.

#### Scenario: Different drive letters are not the same path
- **WHEN** `samePath("A:\\Foo", "B:\\Foo", "win32")` is called
- **THEN** the result SHALL be `false`

#### Scenario: Same path on different drives
- **WHEN** `samePath("C:\\Users\\me\\Dev", "D:\\Users\\me\\Dev", "win32")` is called
- **THEN** the result SHALL be `false`

#### Scenario: UNC path vs drive-letter path
- **WHEN** `samePath("\\\\server\\share\\x", "B:\\x", "win32")` is called
- **THEN** the result SHALL be `false`

#### Scenario: Drive letter case does not create false negatives
- **WHEN** `samePath("B:\\Dev\\BB", "b:\\Dev\\BB", "win32")` is called
- **THEN** the result SHALL be `true` (drive letters are case-insensitive on Windows)

### Requirement: samePath tests filesystem-level equality
`samePath(a, b, platform = process.platform)` SHALL return `true` iff `a` and `b` refer to the same filesystem path under the OS's equality rules: case-insensitive on `win32` and `darwin`, case-sensitive on `linux`, tolerant of separator differences, tolerant of trailing-separator differences. It SHALL run both inputs through `normalizePath` before comparison.

#### Scenario: Windows case-insensitive match
- **WHEN** `samePath("C:\\Dev\\BB", "c:\\dev\\bb", "win32")` is called
- **THEN** the result SHALL be `true`

#### Scenario: Windows separator-insensitive match
- **WHEN** `samePath("C:\\Dev\\BB", "C:/Dev/BB", "win32")` is called
- **THEN** the result SHALL be `true`

#### Scenario: Windows trailing-separator-insensitive match
- **WHEN** `samePath("C:\\Dev\\BB", "C:\\Dev\\BB\\", "win32")` is called
- **THEN** the result SHALL be `true`

#### Scenario: Linux case-sensitive non-match
- **WHEN** `samePath("/Users/me/Dev", "/users/me/dev", "linux")` is called
- **THEN** the result SHALL be `false`

#### Scenario: macOS case-insensitive match (HFS+ default)
- **WHEN** `samePath("/Users/me/Dev", "/Users/me/dev", "darwin")` is called
- **THEN** the result SHALL be `true`

#### Scenario: Different paths never match
- **WHEN** `samePath("/a/b", "/a/c", "linux")` is called
- **THEN** the result SHALL be `false`

### Requirement: parsePathInput splits user input OS-correctly
`parsePathInput(value, platform = process.platform)` SHALL return `{ parent, partial }` where `parent` is the directory portion the path picker should browse and `partial` is the filter text for the current child. It SHALL handle Windows drive-letter roots (`C:\`), UNC roots (`\\server\share\`), and Unix roots (`/`).

#### Scenario: Windows path with trailing separator
- **WHEN** `parsePathInput("C:\\Users\\mboto\\", "win32")` is called
- **THEN** the result SHALL equal `{ parent: "C:\\Users\\mboto", partial: "" }`

#### Scenario: Windows path with partial last segment
- **WHEN** `parsePathInput("C:\\Users\\mboto\\Dev", "win32")` is called
- **THEN** the result SHALL equal `{ parent: "C:\\Users\\mboto", partial: "Dev" }`

#### Scenario: Windows drive letter root alone
- **WHEN** `parsePathInput("C:\\", "win32")` is called
- **THEN** the result SHALL equal `{ parent: "C:\\", partial: "" }`

#### Scenario: Windows drive letter with partial
- **WHEN** `parsePathInput("C:\\Us", "win32")` is called
- **THEN** the result SHALL equal `{ parent: "C:\\", partial: "Us" }`

#### Scenario: Bare drive letter is treated as drive root
- **WHEN** `parsePathInput("B:", "win32")` is called
- **THEN** the result SHALL equal `{ parent: "B:\\", partial: "" }`
- **AND** the function SHALL NOT pass bare drive-letter input through `path.win32.resolve`, because that would expand to the process's current working directory on that drive — a cwd-dependent result unsuitable for a pin dialog.

#### Scenario: Drive-relative typed form (drive letter + characters without separator)
- **WHEN** `parsePathInput("B:Dev", "win32")` is called
- **THEN** the result SHALL equal `{ parent: "B:\\", partial: "Dev" }` (defensive interpretation: treat as drive root + partial, NOT as cwd-relative)

#### Scenario: Multi-drive navigation is symmetric
- **WHEN** `parsePathInput("A:\\Foo\\B", "win32")` is called
- **THEN** the result SHALL equal `{ parent: "A:\\Foo", partial: "B" }`
- **AND** the same shape SHALL hold for any drive letter, confirming the parser is drive-agnostic

#### Scenario: Windows UNC path
- **WHEN** `parsePathInput("\\\\server\\share\\dir\\", "win32")` is called
- **THEN** the result SHALL equal `{ parent: "\\\\server\\share\\dir", partial: "" }`

#### Scenario: Windows mixed separators tolerated
- **WHEN** `parsePathInput("C:\\Users\\mboto/Dev", "win32")` is called
- **THEN** the result SHALL equal `{ parent: "C:\\Users\\mboto", partial: "Dev" }`

#### Scenario: Unix absolute path with trailing separator
- **WHEN** `parsePathInput("/Users/me/", "linux")` is called
- **THEN** the result SHALL equal `{ parent: "/Users/me", partial: "" }`

#### Scenario: Unix absolute path with partial
- **WHEN** `parsePathInput("/Users/me/Dev", "linux")` is called
- **THEN** the result SHALL equal `{ parent: "/Users/me", partial: "Dev" }`

#### Scenario: Unix root alone
- **WHEN** `parsePathInput("/", "linux")` is called
- **THEN** the result SHALL equal `{ parent: "/", partial: "" }`

### Requirement: Platform parameter is injectable for testing
Every exported function in `platform/paths.ts` that depends on OS conventions SHALL accept an optional trailing `platform: NodeJS.Platform` parameter that defaults to `process.platform`. Tests SHALL exercise both Windows and Unix branches by passing the parameter explicitly.

#### Scenario: Linux tests run on Windows host
- **WHEN** a test runs `normalizePath("/Users/me/x", "linux")` on a Windows CI host
- **THEN** the result SHALL equal `"/Users/me/x"` regardless of the host's `process.platform`

#### Scenario: Windows tests run on Linux host
- **WHEN** a test runs `normalizePath("C:\\Dev\\BB", "win32")` on a Linux CI host
- **THEN** the result SHALL equal `"C:\\Dev\\BB"` regardless of the host's `process.platform`

### Requirement: No direct process.platform reads outside the primitive
Consumers of `platform/paths.ts` SHALL NOT read `process.platform` themselves for path decisions. They SHALL either (a) omit the `platform` argument and rely on the default, or (b) pass a value threaded from a single source (e.g., the server-issued `BrowseResult.platform` field on the client). This keeps OS awareness concentrated in the primitive, matching the pattern already established for `binary-lookup.ts`, `process.ts`, and `shell.ts`.

#### Scenario: Client does not branch on navigator or process.platform
- **WHEN** the client's `PathPicker.tsx` or `session-grouping.ts` is inspected
- **THEN** neither SHALL contain a reference to `process.platform` or `navigator.platform`
- **AND** OS awareness SHALL flow either through `paths.*` helpers or through a platform value received from the server
