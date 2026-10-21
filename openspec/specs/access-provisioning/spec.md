# access-provisioning Specification

## Purpose
Let the operator approve, once and ahead of time, the folders a project's agents need, turning a declared project profile into ordinary persisted folder grants without a per-denial prompt, while keeping the agent that asks from being the one that approves.

## Requirements

### Requirement: A provisioning request proposes and never writes

The dashboard SHALL accept a provisioning request naming a project root, up to 32 folder lines (each a path and a reason) and optional remote-access goals. Accepting it SHALL record one pending request and send the provisioning dialog only to operate-tier connections that hold a prompt capability. It SHALL NOT create any grant, change any configuration, or alter remote-access state.

#### Scenario: Submitting a request writes nothing

- **GIVEN** an empty grant store
- **WHEN** a provisioning request with two grantable folders is accepted
- **THEN** the grant store SHALL still be empty
- **AND** the response SHALL carry the request identifier and each line's classification

#### Scenario: Too many lines are refused

- **WHEN** a request carries 33 folder lines, even if some resolve to the same folder
- **THEN** it SHALL be refused and no pending request SHALL be recorded

#### Scenario: An empty request is refused

- **WHEN** a request carries no folder lines and no remote goals
- **THEN** it SHALL be refused with reason `empty`

#### Scenario: Remote goals alone are accepted

- **WHEN** a request carries no folder lines and the remote goal `lan`
- **THEN** it SHALL be accepted and the dialog SHALL show only the hand-off action

#### Scenario: A connection without a capability is not sent the dialog

- **GIVEN** one browser connection holding a prompt capability and one without
- **WHEN** a request is accepted
- **THEN** only the capability-holding connection SHALL receive the provisioning dialog

#### Scenario: An observe-tier connection is not an operator

- **GIVEN** the only connected browser holds a prompt capability but is observe tier
- **WHEN** a request is submitted
- **THEN** it SHALL be refused with reason `no-operator`

### Requirement: Each line is resolved and classified before the operator sees it

Each folder path SHALL be resolved (absolute, home-rooted, or relative to the project root) to its real path and classified by the first matching rule: `invalid` (unresolvable input), `missing` (not an existing directory), `forbidden` (an ungrantable subject), `sensitive` (at or below a credential folder), `in-root` (at or below the project root), `covered` (an existing persisted grant admits it), else `grantable`. Lines with the same real path SHALL collapse into one.

#### Scenario: A relative path resolves against the project root

- **GIVEN** project root `/w/app` and an existing directory `/w/lib`
- **WHEN** a line names `../lib`
- **THEN** it SHALL be shown as `/w/lib`, classified `grantable`

#### Scenario: A forbidden folder is shown but not approvable

- **WHEN** a line names the home directory
- **THEN** it SHALL be classified `forbidden`
- **AND** the dialog SHALL offer no approve control for it

#### Scenario: A symlinked line is shown as its real path

- **GIVEN** `/w/link` is a symlink to `/w/real`
- **WHEN** a line names `/w/link`
- **THEN** the dialog SHALL show `/w/real`

#### Scenario: A missing folder is not grantable

- **WHEN** a line names a path that does not exist, or names a file
- **THEN** it SHALL be classified `missing` and SHALL NOT be approvable

#### Scenario: A folder inside the project root needs no grant

- **GIVEN** project root `/w/app` and an existing grant covering `/w`
- **WHEN** a line names `/w/app/docs`
- **THEN** it SHALL be classified `in-root`, not `covered`

### Requirement: Credential folders are not provisionable

A line at or below, or an ancestor of, `~/.ssh`, `~/.pi`, `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.docker`, or on macOS `~/Library/Keychains`, compared after real-path resolution, SHALL be classified `sensitive` (or `forbidden` where the grant store already refuses it) and SHALL NOT be approvable through provisioning.

#### Scenario: Cloud credentials are refused

- **WHEN** a line names `~/.aws`
- **THEN** it SHALL be classified `sensitive` and the dialog SHALL offer no approve control for it

#### Scenario: An ancestor of a credential folder is refused

- **WHEN** a line names `~/Library` on macOS
- **THEN** it SHALL be classified `sensitive`, because approving it would admit `~/Library/Keychains`

#### Scenario: A symlink into a credential folder is refused

- **GIVEN** `/w/creds` is a symlink to `~/.gnupg`
- **WHEN** a line names `/w/creds`
- **THEN** it SHALL be classified `sensitive`

### Requirement: The project root is validated

A request SHALL be refused unless its project root is an absolute path to an existing directory that holds an entry named `.git` or `.pi` and is not an ungrantable subject. The project root's real path SHALL be the key for per-project bounds and the origin recorded on every grant the request produces.

#### Scenario: A non-project directory is refused

- **WHEN** a request names a directory with neither `.git` nor `.pi`
- **THEN** it SHALL be refused and no pending request SHALL be recorded

#### Scenario: The home directory as project root is refused

- **WHEN** a request names the home directory as its project root
- **THEN** it SHALL be refused

#### Scenario: Aliases of one project root share one key

- **GIVEN** a pending request for `/w/app`
- **WHEN** a request names `/w/app/` or a symlink to `/w/app`
- **THEN** it SHALL be refused as a duplicate of the pending request

### Requirement: Provisioning requests are bounded, rate limited and expire

At most one request SHALL be pending per project root and at most 4 in total. A project root SHALL NOT create more than one request per 60 seconds, nor any within 5 minutes after its previous request ended with no approved line; the dashboard SHALL NOT create more than 3 requests per 10 minutes. A pending request SHALL expire 10 minutes after creation and SHALL then grant nothing.

#### Scenario: A duplicate request returns the pending one

- **GIVEN** a pending request for `/w/app`
- **WHEN** another request for `/w/app` is submitted
- **THEN** it SHALL be refused with the existing request's identifier

#### Scenario: A rejected request starts a cooldown

- **GIVEN** the operator dismissed a request for `/w/app`
- **WHEN** a new request for `/w/app` is submitted 1 minute later
- **THEN** it SHALL be refused with reason `cooldown` and no dialog SHALL be raised

#### Scenario: An expired request grants nothing

- **GIVEN** a pending request no one answers
- **WHEN** 10 minutes pass
- **THEN** its status SHALL be `expired` and no grant SHALL be recorded

### Requirement: A request is accepted only when an operator can be asked

A request SHALL be refused when the grant-prompt kill switch is set, when prompting is disabled in configuration, when host admission is in report mode, or when no connection holding a prompt capability is open. The same conditions SHALL be re-checked when an answer arrives; an answer that fails them SHALL be refused and the request SHALL stay pending. YOLO SHALL never answer a provisioning line.

#### Scenario: No operator browser is open

- **GIVEN** no dashboard browser connection holds a prompt capability
- **WHEN** a request is submitted
- **THEN** it SHALL be refused with reason `no-operator`

#### Scenario: Prompting disabled refuses provisioning

- **GIVEN** prompting is set to `false` in configuration and an operator browser is connected
- **WHEN** a valid request is submitted
- **THEN** it SHALL be refused with reason `prompting-disabled` and no dialog SHALL be raised

#### Scenario: Report mode at answer time refuses the answer

- **GIVEN** a pending request created while Host admission was enforced
- **WHEN** Host admission switches to report mode and the operator then approves a line
- **THEN** the answer SHALL be refused, no grant SHALL be recorded, and the request SHALL stay pending

#### Scenario: A live unscoped YOLO session does not approve

- **GIVEN** an unscoped YOLO session is active
- **WHEN** a valid request is submitted
- **THEN** it SHALL stay pending until a capability-holding connection answers it

### Requirement: Only a capability-holding connection can settle a request

A request SHALL be settled only by a response sent over an operate-tier connection that itself holds a live prompt capability, or by an operate-tier HTTP request that presents one. A capability SHALL authorise only the connection it was issued to. Any other response SHALL be dropped and counted. The first terminal transition (settled, dismissed or expired) SHALL win; later answers SHALL be refused as already settled.

#### Scenario: A capability-less local request cannot approve

- **GIVEN** a pending request
- **WHEN** a loopback HTTP request without a prompt capability tries to approve it
- **THEN** it SHALL be refused and the request SHALL stay pending

#### Scenario: A response on a socket without a capability is dropped

- **GIVEN** a pending request
- **WHEN** an approval arrives over a connection the dashboard issued no capability
- **THEN** it SHALL be dropped, counted, and the request SHALL stay pending

#### Scenario: The first answer wins

- **GIVEN** two operator browsers showing the same request
- **WHEN** both answer
- **THEN** only the first answer SHALL be applied and the second browser's dialog SHALL be dismissed

### Requirement: The provisioning dialog asks per line and preselects nothing

The dialog SHALL list every line with its real path, reason and classification, and SHALL state that approved folders become readable and writable by every session on this machine until revoked, and that the project name is the requester's claim. Each grantable line SHALL carry its own approve control; none SHALL be preselected. Dismissing the dialog SHALL reject every line.

#### Scenario: Nothing is preselected

- **WHEN** the dialog opens with three grantable lines
- **THEN** no line SHALL be selected for approval

#### Scenario: Dismissal rejects all

- **WHEN** the operator dismisses the dialog
- **THEN** the request SHALL end `dismissed` with every line rejected and no grant recorded

#### Scenario: Reach and limits are stated

- **WHEN** the dialog opens
- **THEN** it SHALL state that approved folders apply to every session on this machine
- **AND** it SHALL state that approval is consent, not protection against a program on this machine that changes access by other means

### Requirement: Approved lines are re-verified and become ordinary grants

On settlement the project root SHALL be re-validated and each approved line re-resolved; a changed, no-longer-grantable or root-invalid line SHALL NOT be granted. The rest SHALL be written as persisted grants marked provisioned, origin = project root. If net-new subjects exceed free capacity, every approved line SHALL be refused; provisioning SHALL never evict.

#### Scenario: A line swapped for a symlink after display is not granted

- **GIVEN** a dialog showing `/w/lib`
- **WHEN** `/w/lib` is replaced by a symlink to `/w/secret` before the operator approves
- **THEN** that line SHALL end `changed` and no grant for it SHALL be recorded

#### Scenario: A project root that lost its marker grants nothing

- **GIVEN** a pending request for `/w/app`
- **WHEN** `/w/app/.git` and `/w/app/.pi` are removed before the operator approves
- **THEN** every approved line SHALL end `refused` and no grant SHALL be recorded

#### Scenario: Approval records a provisioned grant

- **WHEN** the operator approves `/w/lib` for project `/w/app`
- **THEN** the grant store SHALL hold `/w/lib` marked provisioned with origin `/w/app`
- **AND** an agent session in any directory SHALL read under `/w/lib` without a prompt

#### Scenario: No eviction on a full store

- **GIVEN** a grant store with 199 grants
- **WHEN** the operator approves two net-new lines
- **THEN** both lines SHALL end `refused` with reason `capacity` and the store SHALL be unchanged

### Requirement: A project-root line offers the pi-trust choice

A grantable line whose real-path directory holds an entry named `.git` or `.pi` SHALL offer the "also trust this folder in pi" choice with the consequence statement the trust mirror requires, pre-set from the access-grant source default. The choice SHALL be stored, explicitly and only, for a line that ends `granted`; an approval that omits it SHALL store "not trusted". Other lines SHALL offer no such choice.

#### Scenario: Trust choice on a project-root line

- **GIVEN** a grantable line `/w/lib` that contains `.git` and default trust-mirror settings
- **WHEN** the dialog opens
- **THEN** that line SHALL show the pi-trust choice, unchecked

#### Scenario: A rejected line stores no trust choice

- **WHEN** the operator checks the pi-trust choice on a line and then rejects that line
- **THEN** no trust choice SHALL be stored for it

### Requirement: Remote-access goals are handed off to the remote-access wizard

Remote goals (`lan`, `internet`, `device`) SHALL be shown as actions that open the Remote access dialog on its landing and name the task to choose there. Provisioning SHALL NOT write trusted networks, allowed origins or pairing state. Each goal's outcome SHALL be `handed-off`.

#### Scenario: A LAN goal opens Remote access

- **WHEN** the operator activates the `lan` goal's action
- **THEN** the Remote access dialog SHALL open on its landing and the provisioning dialog SHALL name "Allow devices on my network" as the task to choose
- **AND** the trusted-network configuration SHALL be unchanged by provisioning

### Requirement: Reasons are bounded and inert

A reason MAY be empty or absent; the dialog SHALL then show "no reason given". Each line's reason SHALL be capped at 200 characters with control characters removed, a cut SHALL be marked, and the reason SHALL be shown as plain text and quoted in log records, never interpreted as markup or as a log field.

#### Scenario: A missing reason is shown as such

- **WHEN** a line has no reason
- **THEN** the dialog SHALL show "no reason given" for it and the line SHALL stay approvable when grantable

#### Scenario: An oversized reason is cut and marked

- **WHEN** a line's reason is 500 characters long
- **THEN** the dialog SHALL show its first 200 characters followed by a cut marker

#### Scenario: A reason cannot forge a log line

- **WHEN** a line's reason contains a newline followed by `[access-provision] settled`
- **THEN** the log SHALL contain no line beginning with that text other than real transitions

### Requirement: Request status is observable

The dashboard SHALL report each request's status (`pending`, `settled`, `dismissed`, `expired`) and each line's classification and, once ended, outcome (`granted`, `rejected`, `changed`, `refused`, `failed`, `handed-off`). Each transition SHALL emit one log record naming the request, the project root and line counts. Health output SHALL carry cumulative counts of created, approved, rejected, dismissed, expired and refused requests and of dropped responses, and the pending count.

#### Scenario: A settled request reports per-line outcomes

- **WHEN** a request with lines A and B settles with A approved and B rejected
- **THEN** its status SHALL report A `granted` and B `rejected`

#### Scenario: Pending requests are lost on restart

- **GIVEN** a pending request
- **WHEN** the dashboard server restarts
- **THEN** the request SHALL no longer be reported and no grant SHALL have been recorded for it

### Requirement: A project access profile is a proposal only

A project MAY carry `.pi/access.json` (version 1: folder lines with path and reason, optional remote goals). The dashboard server SHALL NOT read it. Its contents SHALL take effect only through a provisioning request the operator approves line by line. A file with an unknown version SHALL be refused by the skill.

#### Scenario: The profile alone grants nothing

- **GIVEN** a repository whose `.pi/access.json` lists `/w/lib`
- **WHEN** a session starts in that repository
- **THEN** reading under `/w/lib` SHALL still prompt until a provisioning request for it is approved

### Requirement: The project-access skill maps, suggests and provisions

The dashboard SHALL ship a `project-access` skill with three modes: `map` reports, read-only, a project's effective access (session roots, covering grants with how each was created, YOLO state, pi trust, path-gate state, and that `bash` is not gated); `suggest` drafts `.pi/access.json` from grants this project's sessions created, reports which grants it could not attribute, and writes it only after the user confirms; `provision` submits a request and reports each line's outcome.

#### Scenario: Map writes nothing

- **WHEN** the skill runs in `map` mode
- **THEN** no file, grant or configuration SHALL change

#### Scenario: Suggest reports what it could not attribute

- **GIVEN** three grants with an unknown origin and the sessions API unreachable
- **WHEN** the skill runs in `suggest` mode
- **THEN** it SHALL state that three grants were skipped and that the list may be partial, before asking to write

#### Scenario: Provision reports outcomes

- **WHEN** the skill's request ends
- **THEN** the skill SHALL report each line's outcome to the user

#### Scenario: Provision explains a missing operator

- **WHEN** the request is refused with `no-operator`
- **THEN** the skill SHALL tell the user to open the dashboard and retry
