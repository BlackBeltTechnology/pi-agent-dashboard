## Purpose

Let a vault binding reach every project on the user's own devices without per-project grants. The reach is chosen once, when an account is added. A session that lacks a model credential is offered a matching vault account where it runs.

## ADDED Requirements

### Requirement: Reach "All my projects"
A binding (`env` or `llm`) SHALL have a reach of either "Only projects I choose" (the default when unset) or "All my projects". With "All my projects", the binding SHALL be delivered to every session that passes the vault's delivery trust gate (see `credential-delivery`), in any working directory, including directories first opened after the reach was set, unless an exception applies. A paired device SHALL be reached only when that gate admits remote sessions; until then the reach applies to sessions on the hub only. The account used SHALL be the binding's default; a pool SHALL use its member order. The reach SHALL apply the same delivery checks as a grant: reserved env names are never delivered, an `llm` binding delivers only the account kinds its delivery mode allows (see `vault-llm-credentials`), and any per-account check another vault capability defines (such as `too-short` from `absorb-service-secrets-into-vault`) applies unchanged. The reach SHALL NOT change a binding's delivery mode, pool order or failover setting. Local credentials SHALL keep precedence (`local-override`) as for any delivery, including the `llm` precedence rules of `vault-llm-delivery`. The reach SHALL NOT apply to reads by `service:<id>` subjects, and SHALL NOT change plugin reads of declared bindings. Deleting a binding SHALL delete its reach and its exclusions. A reach grant SHALL NOT name an account. When the binding's default account is revoked, every project reached through it SHALL be `no-account` until a new default is chosen.

A session that fails the trust gate (untrusted device, insecure transport) SHALL receive nothing through the reach.

#### Scenario: First new folder on the hub
- **WHEN** binding `anthropic-work` has the reach "All my projects", and the user starts a session on the hub in a folder that has never been seen
- **THEN** the session receives `anthropic-work` within the delivery propagation bound, with no grant and no confirmation step

#### Scenario: Paired device receives through the reach once remote delivery is admitted
- **WHEN** binding `anthropic` has the reach "All my projects", the trust gate admits remote sessions, and a session on paired device mac-mini-iroda starts in a new folder
- **THEN** the session receives `anthropic`

#### Scenario: Paired device while remote delivery is off
- **WHEN** binding `anthropic` has the reach "All my projects", and the trust gate does not admit remote sessions
- **THEN** a session on paired device mac-mini-iroda receives nothing, and its session view says that remote delivery is off

#### Scenario: Revoked default reaches nothing
- **WHEN** `anthropic` has the reach "All my projects" and its default account is revoked
- **THEN** every session reached through it shows `anthropic` as `no-account`, and no other account is used

#### Scenario: Untrusted device receives nothing
- **WHEN** binding `anthropic` has the reach "All my projects", and a session connects from a device that is not paired
- **THEN** the session receives nothing through the reach

#### Scenario: Local login still wins
- **WHEN** binding `anthropic` has the reach "All my projects", and the session's machine has its own `anthropic` entry in `auth.json`
- **THEN** the binding is reported `local-override`, and the local login is used

### Requirement: Reach exceptions
For a binding with the reach "All my projects", the user SHALL be able to set, per project key, an exception that either:
- names another account of the binding's provider and kind (a project-key grant with that account), allowed only on `single` bindings, or
- turns the binding off for that project (an exclusion), allowed on every binding.

An exclusion SHALL be stored apart from grants, so that a dashboard version without reach support never reads it as a grant. An exclusion names a directory key or a repository key. It SHALL apply when it equals the session's directory key on its device, or the session's repository key. "Turn off here" SHALL store the session's directory key only, so it affects that checkout alone and survives adding, changing or removing a git remote. An exclusion by repository key, which covers every checkout of that repository, SHALL be created only from the binding card, and the UI SHALL say it covers all checkouts. A folder moved to another path is a different project. A project-key grant SHALL take precedence over the reach in every state: while it waits for a checkout confirmation, or names a revoked account, the project receives nothing from that binding, and the session view shows the grant's state. An exclusion SHALL make the project receive nothing from that binding. Removing an exception SHALL return the project to the reach. Changing the reach from "All my projects" to "Only projects I choose" SHALL keep every project-key grant and every exclusion; the exclusions apply again if the reach is widened later. Adding an account exception SHALL state that the project receives nothing from the binding until that exception can deliver (for a repository key, until the checkout is confirmed).

#### Scenario: Exception picks another account
- **WHEN** `anthropic` has the reach "All my projects" with default account "personal", and project deck3d has an exception naming account "work"
- **THEN** sessions in deck3d receive "work", and every other project receives "personal"

#### Scenario: Turned off for one project
- **WHEN** `anthropic` has the reach "All my projects", and the folder `/Users/robson/scratch` on the hub has an exclusion
- **THEN** a session there receives nothing from `anthropic`, and its session view shows "Turned off for this project"

#### Scenario: Exception waiting for confirmation delivers nothing
- **WHEN** `anthropic` has the reach "All my projects", repository `github.com/robson/deck3d` has an exception naming account "work", and a session starts in an unconfirmed checkout of it
- **THEN** the session receives nothing from `anthropic`, and shows a pending confirmation

#### Scenario: A new git remote does not lift an exclusion
- **WHEN** folder `/Users/robson/scratch` on the hub has an exclusion for `anthropic`, and the user adds an `origin` remote there
- **THEN** a session there still receives nothing from `anthropic`

#### Scenario: Removing the git remote does not lift an exclusion
- **WHEN** the user chose "Turn off here" for `anthropic` in a checkout of `github.com/robson/deck3d`, and later removes its `origin` remote
- **THEN** a session in that folder still receives nothing from `anthropic`

#### Scenario: Exclusion is not a grant on an older dashboard
- **WHEN** the vault file holds a reach and an exclusion, and is read by a dashboard version without reach support
- **THEN** no binding is delivered through the reach, and the exclusion delivers nothing

### Requirement: Reach is chosen when an account is added
Every place that creates an account together with a new binding SHALL ask "Who can use it" with the two reaches, and SHALL preselect "All my projects". When the binding already exists, its reach SHALL stay unchanged, and widening goes through the confirmation below. The places are: Providers "Another account for a connected provider", Providers "Link to vault", and Vault "Add key" with its variable. The choice SHALL state that a repository cloned from someone else is a project too. Bindings created by Import SHALL get the reach "Only projects I choose"; the import done step SHALL offer to widen them through the confirmation below. The management API SHALL take the reach explicitly and SHALL treat an omitted reach as "Only projects I choose"; only the UI preselects "All my projects", and the API documentation SHALL say so.

Widening a binding to "All my projects" afterwards SHALL require a confirmation that lists the devices it reaches and the cloned-repository risk; the missing-credential offer satisfies this by stating both before its action. Narrowing SHALL NOT require one.

#### Scenario: Default in the add flow
- **WHEN** the user opens Providers → "Another account" for `anthropic`
- **THEN** "All my projects" is selected, and the clone-repository note is shown next to it

#### Scenario: Imported variables stay narrow
- **WHEN** the user imports `GEMINI_API_KEY` and `SONIOX_API_KEY` with "create variables" selected
- **THEN** both bindings have the reach "Only projects I choose"

#### Scenario: API default stays narrow
- **WHEN** a client creates a binding through the management API without a reach
- **THEN** the binding has the reach "Only projects I choose"

#### Scenario: Widening asks first
- **WHEN** the user chooses "Make it available to all my projects" on a binding with project grants
- **THEN** a confirmation lists the reached devices and the cloned-repository risk, and the reach changes only after the user confirms

### Requirement: Variable cards show the reach
A binding card SHALL show its reach. For "All my projects" it SHALL show the reached devices, the number of projects with an open session receiving it now, and only the exceptions, each with an action to remove it, plus an action to add an exception. For "Only projects I choose" it SHALL show the project grants as before and an action to widen the reach.

#### Scenario: Card lists only exceptions
- **WHEN** `anthropic-work` has the reach "All my projects" with one account exception and one exclusion
- **THEN** its card shows "All my projects" and exactly those two exception rows

### Requirement: Missing-credential offer in the session
When a session has a selected model whose provider has no credential configured on that machine, so that pi would refuse a prompt with "No API key found", the bridge SHALL report the provider id, and only the provider id, to the hub at session start, on every model change, and after each vault snapshot it applies, whether or not that snapshot changed anything. It SHALL report the end of the condition the same way. An expired or rejected login is not this condition; pi's own re-login message applies. If delivery is enabled, the session passes the delivery trust gate, and the vault holds an account usable for that provider id, the session view SHALL offer the following while the condition lasts. When a project-key grant or an exclusion of this project already claims the binding for that provider id, the session view SHALL instead show that state with its repair action (confirm the checkout, choose an account, or remove the exclusion), and SHALL NOT offer to widen the reach.
- "Use in all my projects" (primary), which sets the reach of the binding for that provider id to "All my projects". The offer SHALL state, before this action, the devices it reaches, that devices paired later get it too once remote delivery is on, that code run in any reached project, including cloned repositories, can use it, and, for a `key` account, that the key itself is copied into every reached session;
- "Only in <project>", which creates a project-key grant for the session's project. For a repository key, the result SHALL say that the checkout still needs confirming;
- "Not now", which hides the offer for that session and provider until the session reports a different provider.

When a binding for that provider id exists, the offer SHALL use its default account, or for a pool its member order, and SHALL NOT change it; the offer names the pool instead of one account. When none exists, the offer SHALL create it with the chosen account as default and the delivery `add-vault-llm-delivery` prescribes; with more than one usable account, the user SHALL choose one, identified by label and masked identity. With no usable account, the session view SHALL, for a viewer with the vault's management authority, say that there is no login on the device or in the vault, and offer to add one. The actions SHALL require the vault's management authority. A viewer without it SHALL see that the session has no credential for that provider and that an operator can share one, with no action. The viewer SHALL receive nothing derived from the vault, so the message does not reveal whether the vault holds an account. After an action, the session view SHALL confirm the result with an Undo action that reverses exactly that change, until the hub restarts or 10 minutes pass, and SHALL refuse the Undo when the same entries changed since. "Not now" hides the offer only; it does not affect delivery. The offer SHALL NOT be shown when the provider has a local credential on that machine. No account value, token or key SHALL appear in the report, the offer or any response.

#### Scenario: New folder without a login
- **WHEN** a session on the hub selects `anthropic/claude-sonnet-4-5`, the hub has no Anthropic credential, and the vault holds account "work" for `anthropic`
- **THEN** the session view offers "Use in all my projects", "Only in new-landing" and "Not now", naming "anthropic / work"

#### Scenario: Accepting makes it available everywhere
- **WHEN** the user chooses "Use in all my projects" in that offer
- **THEN** binding `anthropic` has the reach "All my projects" with default "work", the session receives it within the delivery propagation bound, and the offer is replaced by a confirmation with Undo

#### Scenario: Undo restores the previous state
- **WHEN** the user chooses Undo right after accepting
- **THEN** the binding's reach and default are as they were before, and the binding is removed if the offer created it

#### Scenario: Viewer cannot share
- **WHEN** the session lacks an Anthropic credential, and the browser lacks the vault's management authority
- **THEN** the session view says that an operator can share a login, shows no action, and its response carries no vault account information

#### Scenario: Existing exception is shown instead of the offer
- **WHEN** the session lacks an Anthropic credential, and its project has an exclusion for `anthropic`
- **THEN** the session view says that `anthropic` is turned off for this project, offers to remove the exclusion, and does not offer "Use in all my projects"

#### Scenario: Existing binding keeps its default
- **WHEN** binding `anthropic` exists with default "personal" and the reach "Only projects I choose", and the user accepts "Use in all my projects" from the offer
- **THEN** `anthropic` has the reach "All my projects" and its default is still "personal"

#### Scenario: Pool binding is offered as-is
- **WHEN** binding `anthropic` is a pool of "work" and "personal" with the reach "Only projects I choose", and the session lacks an Anthropic credential
- **THEN** the offer names the pool `anthropic`, and accepting it sets the reach to "All my projects" with member order and failover unchanged

#### Scenario: Delivery disabled shows no offer
- **WHEN** vault delivery is disabled, and a session lacks an Anthropic credential
- **THEN** no offer is shown

#### Scenario: Local credential suppresses the offer
- **WHEN** the session's machine has its own `anthropic` login
- **THEN** no offer is shown for `anthropic`

### Requirement: Session view names where access comes from
Each delivered binding in the per-session binding view SHALL say whether it comes from "All my projects" or from a grant to this project. A binding delivered through the reach SHALL offer "Turn off here", which creates an exclusion for the session's project key and requires the vault's management authority. A binding delivered through a project-key grant SHALL NOT offer it.

#### Scenario: Turn off from the session
- **WHEN** `anthropic` reaches the session through "All my projects", and the user chooses "Turn off here"
- **THEN** an exclusion is stored for the session's project key, and the session stops using `anthropic` within the delivery propagation bound

### Requirement: Reach changes are recorded
The hub SHALL record an event, alongside the events of `credential-delivery` "Delivery is observable without exposing values", for each reach change, exception added or removed, and offer accepted, declined or undone. The event SHALL carry the time, kind, binding name, the subject kind (`all`, `repo` or `dir`), the session id when one applies, and outcome. It SHALL carry no value and no directory path.

#### Scenario: Offer acceptance recorded
- **WHEN** the user accepts a missing-credential offer for `anthropic`
- **THEN** an event names `anthropic`, the reach change and the session id, and contains no token and no directory path

### Requirement: Pairing discloses the reach
The pairing approval dialog SHALL list, by name only, the bindings whose reach is "All my projects", with a link to change their reach. While the trust gate does not admit remote sessions it SHALL say the device will receive them once remote delivery is on; otherwise, that it will receive them. When the vault cannot be read, the dialog SHALL say "Vault unavailable — can't list what this device will get", and approval SHALL remain possible. With no such binding it SHALL show nothing extra.

#### Scenario: Unreadable vault does not block approval
- **WHEN** the vault file is corrupt, and the operator opens the approval dialog for a pending device
- **THEN** the dialog says "Vault unavailable — can't list what this device will get", and Approve is enabled

#### Scenario: Approving a device names what it will get
- **WHEN** bindings `anthropic` and `GEMINI_API_KEY` have the reach "All my projects", and the operator opens the approval dialog for a pending device
- **THEN** the dialog lists `anthropic` and `GEMINI_API_KEY` under "This device will get", and no value

### Requirement: Impact lists include the reach
When deleting a binding or revoking an account, the impact shown before the second step SHALL include, for a binding with the reach "All my projects", that every reached project loses it, the number of projects with an open session receiving it now, and its exceptions.

#### Scenario: Revoking the default of a reached binding
- **WHEN** the user starts revoking account "work", the default of `anthropic-work`, which has the reach "All my projects" and 4 projects receiving it now
- **THEN** the impact says all projects lose `anthropic-work`, names the 4 open projects, and offers to pick another default instead
