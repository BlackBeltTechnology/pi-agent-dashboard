## MODIFIED Requirements

### Requirement: File reference detection with line:col suffix

The linkifier SHALL detect file references of the shape `<path>:<line>` or `<path>:<line>:<col>` where `<path>` ends in a generic file extension. A file extension for detection purposes is a dot followed by an alphabetic character and up to 15 further alphanumeric characters (`\.[A-Za-z][A-Za-z0-9]{0,15}`); a fixed allowlist MUST NOT be used. An all-numeric tail (e.g. `.2024`, `.3`) MUST NOT be treated as an extension so that version-like prose does not masquerade as a file.

Each detected match MUST render as a clickable element exposing `path`, `line`, and (when present) `col`.

#### Scenario: grep-style match
- **WHEN** tool output contains `src/foo.ts:42:7: error TS2322`
- **THEN** `src/foo.ts:42:7` SHALL render as a clickable file link with `path="src/foo.ts"`, `line=42`, `col=7`

#### Scenario: line-only match
- **WHEN** tool output contains `at src/bar.js:120`
- **THEN** `src/bar.js:120` SHALL render as a clickable file link with `path="src/bar.js"`, `line=120`, `col` unset

#### Scenario: relative path with parent traversal
- **WHEN** tool output contains `../pkg/baz.tsx:5`
- **THEN** `../pkg/baz.tsx:5` SHALL render as a clickable file link with `path="../pkg/baz.tsx"`, `line=5`

#### Scenario: unlisted text extension with line suffix
- **WHEN** tool output contains `config/app.toml:12`
- **THEN** `config/app.toml:12` SHALL render as a clickable file link with `path="config/app.toml"`, `line=12`

### Requirement: File reference detection by extension

The linkifier SHALL detect bare file paths (no `:line` suffix) when the path ends in a generic file extension (`\.[A-Za-z][A-Za-z0-9]{0,15}`, no fixed allowlist) AND the path contains either a path separator OR a leading `./` / `../` segment. Any text or code extension SHALL be accepted on equal terms; the extension token MUST be captured in full (e.g. `.json` MUST NOT truncate to `.js`). Bare filenames with no separator (e.g. `README.md` or `Node.js` alone in prose) MUST NOT be detected. Tokens whose extension tail is all-numeric (e.g. `v1.2.3`) MUST NOT be detected.

The relative path grammar SHALL admit leading dot-directory segments (e.g. `.pi`, `.github`, `.config`) both as the leading segment when followed by a separator and as any interior segment, and SHALL admit one or more leading `../` parent-traversal segments. A relative path that begins with `..` MUST be detected as a relative file token (marked NOT absolute) and MUST NOT be re-captured as an absolute path by an interior `/`.

#### Scenario: relative path with separator
- **WHEN** tool output contains `wrote packages/client/src/foo.ts`
- **THEN** `packages/client/src/foo.ts` SHALL render as a clickable file link

#### Scenario: leading dot-slash
- **WHEN** tool output contains `./bar.tsx`
- **THEN** `./bar.tsx` SHALL render as a clickable file link

#### Scenario: json extension not truncated
- **WHEN** tool output contains `.pi/settings.json`
- **THEN** `.pi/settings.json` SHALL render as a single clickable file link with `path=".pi/settings.json"`
- **AND** no trailing `on` text token SHALL remain
- **AND** the leading `.` SHALL be part of the link

#### Scenario: leading dot-directory
- **WHEN** tool output contains `.github/workflows/ci.yml`
- **THEN** `.github/workflows/ci.yml` SHALL render as a clickable file link with `path=".github/workflows/ci.yml"` marked NOT absolute

#### Scenario: interior dot-directory
- **WHEN** tool output contains `a/.config/b.ts`
- **THEN** `a/.config/b.ts` SHALL render as a single clickable file link with `path="a/.config/b.ts"` marked NOT absolute
- **AND** no absolute link SHALL be rendered for `/.config/b.ts`

#### Scenario: multi-level parent traversal
- **WHEN** tool output contains `../../packages/server/src/cli.ts`
- **THEN** `../../packages/server/src/cli.ts` SHALL render as a single clickable file link with `path="../../packages/server/src/cli.ts"` marked NOT absolute
- **AND** the leading `..` SHALL NOT be dropped
- **AND** no absolute link SHALL be rendered for the interior `/...` tail

#### Scenario: unlisted text extension with separator
- **WHEN** tool output contains `wrote scripts/setup.lua and config/db.sql`
- **THEN** `scripts/setup.lua` SHALL render as a clickable file link with `path="scripts/setup.lua"`
- **AND** `config/db.sql` SHALL render as a clickable file link with `path="config/db.sql"`

#### Scenario: version string not detected
- **WHEN** tool output contains `installed v1.2.3 of foo`
- **THEN** no file link SHALL be rendered

#### Scenario: bare filename in prose not detected
- **WHEN** tool output contains `the Node.js runtime and README.md docs`
- **THEN** no file link SHALL be rendered for `Node.js` or `README.md`

#### Scenario: prose noise not detected
- **WHEN** tool output contains `decide and/or skip`
- **THEN** no file link SHALL be rendered for `and/or`
