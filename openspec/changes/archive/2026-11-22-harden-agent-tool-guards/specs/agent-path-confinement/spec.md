## MODIFIED Requirements

### Requirement: Session roots

A session's roots SHALL be: its working directory and that directory's checkout root, resolved by the same rules file-read containment uses (the working directory alone when the checkout root cannot be determined within the bounded probe); the operating system temporary directory, for reads and writes; the pi agent directory (except the paths named by the requirement "Some agent-directory paths are asked about even for reads"), the directories of skills loaded into the session, and context files pi loaded for the session, for reads only; and every persisted directory grant in the path-grant store. A write whose target lies only within a read-only root SHALL be treated as outside the roots.

#### Scenario: Git checkout root is a root

- **GIVEN** a session whose working directory is `/w/repo/packages/a` inside a checkout rooted at `/w/repo`
- **WHEN** the agent reads `/w/repo/README.md`
- **THEN** the tool SHALL run without a prompt

#### Scenario: Temporary directory is writable without a prompt

- **WHEN** the agent writes a file under the operating system temporary directory
- **THEN** the tool SHALL run without a prompt

#### Scenario: Loaded skill files are readable but not writable

- **GIVEN** a skill loaded into the session from `/h/.pi/agent/skills/x/`
- **WHEN** the agent reads `/h/.pi/agent/skills/x/SKILL.md`
- **THEN** the tool SHALL run without a prompt
- **WHEN** the agent edits that same file
- **THEN** the operator SHALL be asked first

#### Scenario: A persisted grant admits its subtree

- **GIVEN** the path-grant store holds `/w/other`
- **WHEN** the agent reads `/w/other/docs/a.md`
- **THEN** the tool SHALL run without a prompt

#### Scenario: A revoked grant stops admitting on the next call

- **GIVEN** the operator revokes the grant `/w/other` in Settings ▸ Access
- **WHEN** the agent next reads `/w/other/docs/a.md`
- **THEN** the operator SHALL be asked first

### Requirement: Always allow requires a second deliberate step

`Always allow <directory>` SHALL be offered only when the gated path's containing directory is grantable under the path-grant store's forbidden-subject rules and the attached dashboard has proven that it writes the same grant store the gate reads. That proof SHALL NOT be inferred from the dashboard URL's hostname; when it is absent (an older dashboard, no dashboard, or a different store), the prompt SHALL say the answer cannot be remembered. Choosing it SHALL raise a second confirmation naming the exact directory to be persisted and stating that it can be revoked in Settings ▸ Access. Only an explicit confirmation SHALL persist the grant. The directory SHALL be the gated file's containing directory (or the gated path itself when it is a directory); an ancestor of it SHALL NOT be offered. Cancelling the confirmation SHALL be treated as `Deny`. It SHALL NOT be offered for a path of the requirement "Some agent-directory paths are asked about even for reads", wherever its containing directory lies.

#### Scenario: Confirmed always-allow persists and runs

- **WHEN** the operator chooses `Always allow /w/other/docs` and confirms
- **THEN** `/w/other/docs` SHALL be recorded in the path-grant store and the call SHALL run

#### Scenario: Cancelled confirmation denies

- **WHEN** the operator chooses `Always allow /w/other/docs` and cancels the confirmation
- **THEN** the call SHALL be blocked and no grant SHALL be recorded

#### Scenario: No ancestor is offered

- **WHEN** a read of `/w/other/docs/a.md` is gated
- **THEN** no option SHALL name `/w/other` or any other ancestor of `/w/other/docs`

#### Scenario: Not offered through a forwarded remote dashboard

- **GIVEN** the session reaches a dashboard on another machine through a loopback port forward
- **WHEN** an out-of-root read is gated
- **THEN** the prompt SHALL offer only `Allow once` and `Deny`

#### Scenario: Offered for a same-machine dashboard reached by a public URL

- **GIVEN** the session and the dashboard share one machine and the session reaches it through a public tunnel URL
- **WHEN** a grantable out-of-root read is gated
- **THEN** the prompt SHALL offer `Always allow <directory>`

#### Scenario: Not offered by a dashboard that cannot prove its store

- **GIVEN** the attached dashboard does not announce which grant store it writes
- **WHEN** a grantable out-of-root read is gated
- **THEN** the prompt SHALL offer only `Allow once` and `Deny` and say the answer cannot be remembered

#### Scenario: Not offered without a local dashboard

- **GIVEN** the session is attached to a dashboard on a different machine, or to none
- **WHEN** an out-of-root read is gated
- **THEN** the prompt SHALL offer only `Allow once` and `Deny`

#### Scenario: Grant write failure still honours the approval once

- **GIVEN** the operator confirms `Always allow` and the grant cannot be recorded
- **WHEN** the gate settles
- **THEN** the call SHALL run once and the operator SHALL be told the grant was not saved

#### Scenario: Not offered for the agent-directory carve-out

- **GIVEN** `PI_CODING_AGENT_DIR` is `/srv/pi-agent`, whose containing directory is grantable
- **WHEN** the agent reads `/srv/pi-agent/mcp.json`
- **THEN** the prompt SHALL offer only `Allow once` and `Deny`

## ADDED Requirements

### Requirement: Some agent-directory paths are asked about even for reads

A read of `<agentDir>/sessions` itself or `<agentDir>/sessions/**` (not the session's own session directory), `<agentDir>/models.json`, `<agentDir>/mcp.json` or a `<name>.*` sibling of either SHALL NOT be admitted by any root or grant. `<agentDir>` is each of `~/.pi/agent`, `PI_CODING_AGENT_DIR` (when set) and pi's reported agent directory (`path-gate/index.ts:132`). Such a read SHALL be asked about, marked sensitive wherever it lies, offering only `Allow once` and `Deny`.

#### Scenario: Another project's session transcript is asked about
- **GIVEN** a session whose working directory is `/w/repo`
- **WHEN** the agent reads `~/.pi/agent/sessions/--w-other--/2026-10-30_abc.jsonl`
- **THEN** the operator SHALL be asked first, with the location marked sensitive and no always-allow offered

#### Scenario: The sessions directory itself is asked about
- **WHEN** the agent lists or reads the directory `~/.pi/agent/sessions`
- **THEN** the operator SHALL be asked first, with the location marked sensitive and no always-allow offered

#### Scenario: The session's own session directory stays readable
- **WHEN** the agent reads a file inside the session directory of its own session
- **THEN** the tool SHALL run without a prompt

#### Scenario: Provider and MCP configuration is asked about
- **WHEN** the agent reads `~/.pi/agent/models.json` or `~/.pi/agent/mcp.json`
- **THEN** the operator SHALL be asked first, and a denial SHALL block the read

#### Scenario: Other agent-directory reads stay silent
- **WHEN** the agent reads `~/.pi/agent/settings.json` or a loaded skill under `~/.pi/agent/skills/`
- **THEN** the tool SHALL run without a prompt

#### Scenario: Override directory is treated alike
- **GIVEN** `PI_CODING_AGENT_DIR` is `/srv/pi-agent`
- **WHEN** the agent reads `/srv/pi-agent/mcp.json`
- **THEN** the operator SHALL be asked first and the prompt SHALL mark it sensitive

#### Scenario: Both agent directories are covered when they differ
- **GIVEN** `PI_CODING_AGENT_DIR` is `/srv/pi-agent` and pi reports a third agent directory
- **WHEN** the agent reads `~/.pi/agent/mcp.json`, `/srv/pi-agent/mcp.json` or that third directory's `models.json`
- **THEN** the operator SHALL be asked first for each

#### Scenario: A workspace root above the agent directory does not admit it
- **GIVEN** the session's working directory, or its checkout root, is `$HOME` or a dotfiles repository containing `~/.pi/agent`
- **WHEN** the agent reads `~/.pi/agent/sessions/--w-other--/a.jsonl` or `~/.pi/agent/mcp.json`
- **THEN** the operator SHALL be asked first, with the location marked sensitive

#### Scenario: A persisted grant does not admit it
- **GIVEN** the path-grant store holds a directory that contains `/srv/pi-agent`
- **WHEN** the agent reads `/srv/pi-agent/models.json`
- **THEN** the operator SHALL be asked first

#### Scenario: No grant can be created for it
- **WHEN** the operator is asked about `/srv/pi-agent/mcp.json` and the gate computes the offer
- **THEN** the grant subject SHALL be treated as not grantable and no grant admission SHALL be attempted
