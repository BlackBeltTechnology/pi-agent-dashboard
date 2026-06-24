# coderabbit-review-gate Specification

## Purpose
TBD - created by archiving change add-coderabbit-review-gate. Update Purpose after archive.
## Requirements
### Requirement: Server-independent implementation-phase review gate

The project SHALL provide a script that reviews the current git working tree's
diff using the CodeRabbit CLI, without requiring a running dashboard server, a
build, or a server restart. The script SHALL operate correctly inside a git
worktree and alongside the Docker-isolated instance. By default it SHALL review
uncommitted changes; it SHALL accept passthrough CodeRabbit flags (e.g.
`-t committed --base main`) to retarget scope.

#### Scenario: Worktree review without server

- **WHEN** the gate runs in a git worktree with uncommitted changes and no dashboard server reachable
- **THEN** it SHALL review the working-tree diff and SHALL NOT attempt to build or restart any server.

#### Scenario: Decoupled from deploy

- **WHEN** `full-rebuild.ts` runs
- **THEN** it SHALL perform only build → restart → reload and SHALL NOT run a CodeRabbit review.

### Requirement: Advisory, non-blocking behavior

The review gate SHALL be advisory: it SHALL always exit 0 regardless of findings
or tool availability. On missing CLI, authentication failure, or a CodeRabbit
usage/rate limit, it SHALL print a "deferred to a later cycle" notice and exit 0.
It SHALL surface Critical/Warning findings in its summary so the agent can fix
them before commit, but SHALL NOT enforce a hard gate.

#### Scenario: Usage limit deferral

- **WHEN** the CodeRabbit CLI returns a rate/usage-limit error
- **THEN** the gate SHALL print a deferral notice and exit 0, not blocking the implementation.

#### Scenario: CLI absent

- **WHEN** the CodeRabbit CLI is not installed
- **THEN** the gate SHALL warn and exit 0.

#### Scenario: Skip flag

- **WHEN** the gate runs with `--no-review` or `SKIP_CR_REVIEW=1`
- **THEN** it SHALL print a skip message and exit 0 without invoking CodeRabbit.

### Requirement: Agent-output parsing and severity triage

The gate SHALL consume `coderabbit review --agent` newline-delimited JSON,
collecting only `finding` events and ignoring `review_context`, `status`,
`heartbeat`, and `complete` events as well as non-JSON lines. It SHALL bucket
findings into Critical/Warning versus Info by severity and report the counts plus
the first line of each Critical/Warning finding.

#### Scenario: Mixed stream parsing

- **WHEN** the `--agent` stream contains progress events, heartbeats, two findings (one critical, one minor), and a malformed line
- **THEN** the gate SHALL report two findings with one Critical/Warning and SHALL NOT error on the malformed line.

### Requirement: code-review skill documents the gate workflow

The `code-review` skill SHALL document severity triage with a nit cap, the
`--agent` output contract, the development inner-loop fix cycle, diff scoping
using only CLI flags that exist in the installed version, and the cloud
rate-limit fallback (no local model).

#### Scenario: Flags match the installed CLI

- **WHEN** the skill's diff-scoping commands are compared to `coderabbit review --help`
- **THEN** every documented flag SHALL exist in the installed CLI version.

