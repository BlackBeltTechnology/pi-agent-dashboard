## ADDED Requirements

### Requirement: Doctor window links are scheme-restricted

The Doctor window SHALL parse each report link `href` as a URL and SHALL render it as a clickable link only when the parsed protocol is `http:` or `https:`; an `href` that fails to parse, is relative, or has any other protocol SHALL be shown as plain text. This restriction is already met by the Doctor page and SHALL be kept, covered by a regression test.

#### Scenario: javascript link is not clickable

- **WHEN** a report message contains the markdown link `[x](javascript:alert(1))`
- **THEN** the Doctor window SHALL show it as text with no anchor

#### Scenario: Obfuscated scheme is not clickable

- **WHEN** a report message contains a link whose `href` is `JaVaScRiPt:alert(1)` or has leading whitespace or control characters before `javascript:`
- **THEN** the Doctor window SHALL show it as text with no anchor

#### Scenario: Unparseable or relative href is text

- **WHEN** a report link `href` is `/local/path` or cannot be parsed as a URL
- **THEN** the Doctor window SHALL show it as text with no anchor

#### Scenario: https link opens externally

- **WHEN** the user clicks `[docs](https://example.com/a)` in the Doctor window
- **THEN** the system browser SHALL open `https://example.com/a`
- **AND** the Doctor window SHALL stay on its report

### Requirement: Doctor window navigation is guarded

The Doctor window SHALL deny any request to open a new window, opening an `http`/`https` target in the system browser instead; SHALL block any in-window navigation whose URL differs from the Doctor page's own file URL (a reload or a hash-only change SHALL be allowed); and SHALL run with a sandboxed renderer, as the connecting window already does.

#### Scenario: Navigation and new windows are denied

- **WHEN** content in the Doctor window attempts to navigate the window elsewhere or open a new window
- **THEN** the navigation SHALL be denied, and an `http`/`https` target SHALL be opened in the system browser instead

#### Scenario: Reload and hash change are allowed
- **WHEN** the Doctor window reloads or changes only the URL hash of its own page
- **THEN** the navigation SHALL be allowed

#### Scenario: New window with a non-http scheme is dropped

- **WHEN** content in the Doctor window calls `window.open("file:///etc/passwd")` or `window.open("javascript:alert(1)")`
- **THEN** no window SHALL open and nothing SHALL be opened externally

#### Scenario: Doctor renderer is sandboxed

- **WHEN** the Doctor window is created
- **THEN** its web preferences SHALL enable the renderer sandbox and keep context isolation on and Node integration off

### Requirement: Node version probe never uses a shell string

The app SHALL run the Node version probe (`--version`) of a detected Node binary by spawning the binary directly with an argument vector (`execFileSync(path, ["--version"])`), never by interpolating its path into a shell command line. Node is never a `.cmd` shim, so no shell wrapper SHALL be used.

#### Scenario: Path with shell metacharacters

- **GIVEN** a detected Node path containing a space, quote or `&`
- **WHEN** its version is probed
- **THEN** the path SHALL be executed as a single program and no part SHALL be interpreted by a shell

#### Scenario: Shim override is reported not usable

- **GIVEN** a Node override path pointing at a `.cmd` or `.ps1` shim
- **WHEN** its version is probed
- **THEN** the probe SHALL fail without any shell fallback and the dependency SHALL be reported as not usable

#### Scenario: Probe failure is reported

- **WHEN** the Node binary cannot be executed or exits non-zero
- **THEN** the dependency SHALL be reported as not usable, not as a crash
