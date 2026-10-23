## ADDED Requirements

### Requirement: Inbound command bounds

The bridge SHALL bound concurrent bash per session (`!`/`!!` and `exec` slash templates) and the combined rate, per server connection, of every turn-starting inbound command: `send_prompt`, `retry_session`, `git_commit_draft`, flow `run`, `plugin_emit_event`, follow-up promotion. Limits come from `PI_DASHBOARD_BRIDGE_MAX_BASH` and `PI_DASHBOARD_BRIDGE_PROMPT_RATE` (`"<burst>/<refillPerSec>"`), defaulting above normal use. Refusals SHALL emit a `command_feedback` error naming the limit.

#### Scenario: Bash command beyond the concurrency limit is refused

- **GIVEN** a session whose `!` commands in flight equal the configured concurrency limit
- **WHEN** another `!` or `!!` command arrives
- **THEN** the bridge SHALL NOT start it
- **AND** the session SHALL show a `command_feedback` error stating that the concurrency limit was reached

#### Scenario: Exec slash template counts toward the bash bound

- **GIVEN** a session whose bash commands in flight equal the concurrency limit
- **WHEN** an `exec` slash template that runs a bash command is invoked
- **THEN** the bridge SHALL NOT start it
- **AND** the session SHALL show a `command_feedback` error stating that the concurrency limit was reached

#### Scenario: Slot frees when a command finishes

- **GIVEN** a session at its bash concurrency limit with one further command refused
- **WHEN** one running command finishes
- **THEN** a new `!` command SHALL be accepted

#### Scenario: Prompt flood is refused visibly

- **GIVEN** a server connection sending `send_prompt` messages at a sustained rate far above any interactive rate and above the configured limit
- **WHEN** the bridge's prompt allowance for that connection is exhausted
- **THEN** each further `send_prompt` SHALL be refused with a `command_feedback` error reported to the sender, not discarded without notice
- **AND** prompts within the allowance SHALL still be handled
- **AND** the allowance SHALL replenish over time so that later prompts are accepted again

#### Scenario: Retry and commit draft share the prompt allowance

- **GIVEN** a connection whose prompt allowance is exhausted
- **WHEN** a `retry_session` or `git_commit_draft` message arrives on it
- **THEN** the bridge SHALL refuse it with a `command_feedback` error and SHALL NOT start a turn

#### Scenario: Flow run, plugin event and follow-up promotion share the prompt allowance

- **GIVEN** a connection whose prompt allowance is exhausted
- **WHEN** a flow `run`, a `plugin_emit_event` or a follow-up promotion message arrives on it
- **THEN** the bridge SHALL refuse it with a `command_feedback` error, SHALL NOT start a turn, and SHALL NOT emit the plugin event
- **AND** a flood of any mix of these commands SHALL consume the same single allowance as `send_prompt`

#### Scenario: Limits are configurable

- **WHEN** an operator sets `PI_DASHBOARD_BRIDGE_MAX_BASH` or `PI_DASHBOARD_BRIDGE_PROMPT_RATE` to a different value
- **THEN** the bridge SHALL enforce the configured limit

#### Scenario: Invalid limit value falls back to the default
- **WHEN** `PI_DASHBOARD_BRIDGE_MAX_BASH` is `abc` or `0` (it must be a positive integer), or `PI_DASHBOARD_BRIDGE_PROMPT_RATE` is `30` or `x/y`
- **THEN** the bridge SHALL enforce the default for that limit and log the fallback once

#### Scenario: Rate format is burst/refill
- **WHEN** `PI_DASHBOARD_BRIDGE_PROMPT_RATE` is `30/10`
- **THEN** the bridge SHALL allow a burst of 30 turn-starting commands and replenish 10 per second

#### Scenario: Reconnect does not refill the allowance
- **GIVEN** a connection whose prompt allowance is exhausted
- **WHEN** the connection to the server drops and is re-established
- **THEN** the allowance SHALL remain exhausted until it replenishes with time

#### Scenario: Normal use is not throttled

- **WHEN** a user types prompts interactively, an automation run sends one prompt, or a flow or `/reload` fan-out sends one prompt to each of many sessions
- **THEN** every prompt SHALL be accepted with no refusal, and the default limits SHALL be at least 3× the peak of that workload
- **AND** a user running a few `!` commands in parallel in one session SHALL see none refused

### Requirement: Remote URL credentials never leave the bridge

The bridge SHALL strip credentials from a git remote URL before building repository links and before sending the origin to the server, keeping scheme, host, port and path. For `http(s)` it SHALL strip all userinfo; for `ssh://` it SHALL strip the password and keep the user. Scp-style remotes (`git@host:owner/repo`) are unchanged. The origin sent SHALL be the raw remote so stripped, never a normalized form. An unparseable remote with userinfo yields no origin and no links.

#### Scenario: Credentialed HTTPS remote links to the host

- **GIVEN** a repository whose remote is `https://user:pass@github.com/o/r`
- **WHEN** the bridge builds git links
- **THEN** the links SHALL point at `github.com/o/r`
- **AND** no link SHALL contain `user` or `pass`

#### Scenario: Credentials are not sent in a vault sync origin

- **GIVEN** a repository whose remote is `https://user:pass@github.com/o/r`
- **WHEN** the bridge reports the repository origin to the server
- **THEN** the origin sent SHALL be `https://github.com/o/r`, containing no userinfo

#### Scenario: SSH and scp-style remotes without a password are unchanged

- **WHEN** the remote is `git@github.com:o/r.git` or `ssh://git@github.com/o/r`
- **THEN** the origin sent and the links built SHALL be the same as before this requirement

#### Scenario: SSH URL password is stripped, user kept

- **GIVEN** a repository whose remote is `ssh://git:secret@github.com/o/r`
- **WHEN** the bridge builds links or reports the repository origin
- **THEN** the origin sent SHALL be `ssh://git@github.com/o/r`
- **AND** neither the origin nor any link SHALL contain `secret`

#### Scenario: Unparseable remote with userinfo yields nothing
- **WHEN** the remote contains userinfo but cannot be parsed as a URL
- **THEN** the bridge SHALL send no origin and SHALL build no links

#### Scenario: Remote without userinfo is unchanged

- **WHEN** the remote is `https://github.com/o/r`
- **THEN** the links built and the origin sent SHALL be the same as before this requirement
