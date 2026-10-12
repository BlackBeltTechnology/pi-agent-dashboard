## ADDED Requirements

### Requirement: Executable from a shell
The `pi-nano-banana` bin SHALL start from a plain shell — including an agent's bash tool inside a pi session, with no TypeScript loader configured — both from the monorepo checkout and from an npm install (including pi's `~/.pi/agent/npm` prefix). Arguments, stdout, stderr and the exit code SHALL pass through the launcher unchanged.

#### Scenario: npm-installed bin runs without a TypeScript loader
- **WHEN** the packed package is installed with npm into a fresh prefix and `pi-nano-banana` is run with no arguments and an empty `NODE_OPTIONS`
- **THEN** the usage line `usage: pi-nano-banana "<prompt>" …` is printed to stderr and the exit code is `1` (the existing missing-prompt behaviour), not a module-loading error

#### Scenario: Workspace bin runs from the checkout
- **WHEN** `node_modules/.bin/pi-nano-banana` is run with no arguments in the monorepo
- **THEN** the same usage line is printed and the exit code is `1`

#### Scenario: Exit code passes through the launcher
- **WHEN** generation fails inside the CLI with exit code `1`
- **THEN** the launcher exits `1` and the CLI's error text appears on stderr
