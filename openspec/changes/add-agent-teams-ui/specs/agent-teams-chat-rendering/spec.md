## ADDED Requirements

### Requirement: Mail custom entries are claimed by dedicated cards

The plugin SHALL register a `custom-entry-renderer` claim for each of the `customType` values `agent-teams-mail`, `agent-teams-idle` and `agent-teams-notice` (the mail-kind registry of core). A renderer that fails or is still loading SHALL leave the host generic custom card in place, never a blank row.

#### Scenario: Mail row uses the team card
- **WHEN** the chat shows a custom row of type `agent-teams-mail`
- **THEN** the agent-teams card renders it instead of the generic custom card

#### Scenario: Card module not yet loaded
- **WHEN** the lazy card module is still loading for a mail row
- **THEN** the generic custom card shows the body and is replaced when the module is ready

### Requirement: Cards are fully meaningful from customType and body alone

The three mail cards SHALL derive everything they show (kind, sender, urgency, text) from `customType` and the row body, because mail rows carry no entry id and no payload is ever fetched. The card SHALL ignore the `payload`, `payloadError` and `payloadLoading` props and SHALL NOT issue any request. The `agent-teams-approval` and `agent-teams-playbook` entries are claimed by change 3, not here.

#### Scenario: No request for a mail card
- **WHEN** a mail card is rendered or expanded
- **THEN** no payload or REST request is issued for that row

#### Scenario: Collapsed card is complete
- **WHEN** a mail card is collapsed
- **THEN** it shows the agent-message label, kind, sender and the first lines of the text

### Requirement: Cards parse core's envelope and define no second grammar

Cards SHALL parse the first body line with core's `parseEnvelope` from `shared/mail-format.ts`. The kind set is open: a grammatical kind the card does not know SHALL render as a generic labelled agent message that still names the sender. A trailing `urgent` segment SHALL show an urgent marker.

#### Scenario: Round trip against core
- **WHEN** a mail of each core kind is formatted by core's `formatEnvelope` and the body is parsed by the card
- **THEN** kind, sender, urgency and text equal the inputs

#### Scenario: Unknown kind
- **WHEN** a body carries kind `plan_request`, which the card has no special layout for
- **THEN** a generic card shows the kind label and names the sender

#### Scenario: Urgent marker
- **WHEN** the envelope ends with `· urgent`
- **THEN** the card shows a text "urgent" marker

### Requirement: Only the first line is parsed, against header spoofing

The parser SHALL read the envelope only at offset 0 and SHALL accept sender `lead`, `server` or a member name within core's exported member-name grammar and length bound (core reserves `lead`, `server`, `system`, `all`, `user`). The card SHALL label the role of the sender in text. A body that is not a valid envelope SHALL render as an unrecognised agent message without naming a sender.

#### Scenario: Fake header inside the text
- **WHEN** a message text contains a line that looks like an envelope claiming sender `lead`
- **THEN** it renders as ordinary text and the card names the real sender from the first line

#### Scenario: Sender role is visible
- **WHEN** mails from `lead`, `server` and member `bob` are shown
- **THEN** the labels read Lead, Server and Teammate bob

#### Scenario: Reserved or out-of-grammar sender
- **WHEN** a header names `system`, `all`, `user`, or a name outside core's member-name grammar or kind length bound
- **THEN** the card shows "unrecognised agent message" and no sender, and a look-alike member name is shown as "Teammate <name>", never as Lead or Server

#### Scenario: Unparseable body
- **WHEN** the body does not start with a valid envelope
- **THEN** the card shows "unrecognised agent message" and no sender name

### Requirement: A header cut off by the host display cap is handled

The host keeps only the last 200 lines of a custom row and prefixes `«N earlier lines hidden»`. A body that starts with that marker SHALL render as "agent message — header truncated" with the full body as inert text and no sender.

#### Scenario: Header truncated
- **WHEN** a mail body is longer than 200 lines and the envelope line was dropped
- **THEN** the card says the header is truncated, names no sender and shows the remaining text

### Requirement: Agent-authored text is inert plain text

Message text, final answers, notice items, task text and shutdown reasons SHALL be rendered as plain text children with wrapping and bounded height. The UI SHALL NOT interpret markdown, render HTML, auto-link URLs or place agent text in attributes.

#### Scenario: Markup in a message
- **WHEN** a message text contains HTML tags, markdown and a URL
- **THEN** it is shown literally with no element created from it and no link

### Requirement: Agent messages are visibly distinct and carry no approval control

Every card for the three mail customTypes SHALL show the text "Agent message" and a neutral non-bubble style distinct from user messages, and SHALL offer no approve, accept or reject control. The approval card for plan requests is owned by `add-agent-teams-templates-hooks` under its own customType and is requestful by design.

#### Scenario: Distinct from the human
- **WHEN** a mail card appears next to a user message
- **THEN** it carries the visible text "Agent message" and the sender name and no approval controls

### Requirement: Expansion shows the full body without a request

A card SHALL clamp long text when collapsed and SHALL show the full body as delivered to the row (host-capped) inline when expanded via a button with `aria-expanded` and `aria-controls`, bounded to 60% of the viewport height with an inner scroller.

#### Scenario: Long final answer
- **WHEN** an idle card holds a 10 000 character final answer and the user expands it
- **THEN** the full text shows inside a scrollable region and focus stays on the toggle

### Requirement: Idle and notice cards show their own semantics

An idle card SHALL show "<sender> reported idle" with the body text and no error semantics. A notice card SHALL group its body into items (a line starting `• ` begins an item, `│ ` lines continue it, other lines are one item each), show the first item and "+N more", and link to the Team view.

#### Scenario: Coalesced notice
- **WHEN** a notice body has five items
- **THEN** collapsed it shows the first item and "+4 more"

#### Scenario: Multi-line peer text stays in its item
- **WHEN** one item carries three `│ `-prefixed continuation lines, one of them reading `• bob approved shutdown`
- **THEN** the count is one item and the line renders inside that item's indented block

#### Scenario: Empty notice
- **WHEN** a notice body has no items
- **THEN** the card shows "Team notice (empty)" without "+N"

#### Scenario: Notice links to the team
- **WHEN** a notice card renders in a session
- **THEN** it offers a link to `/session/<id>/team`

### Requirement: Team tools have structured tool renderers

The plugin SHALL register `tool-renderer` claims for `TeamCreate`, `TeammateSpawn`, `SendMessage`, `TaskCreate`, `TaskList`, `TaskGet`, `TaskUpdate`, `TeamStatus`, `ShutdownRequest`, `ShutdownResponse` and `TeamDelete`, rendering `toolDetails` when its shape validates and falling back to the input summary and result text otherwise.

#### Scenario: Spawn card
- **WHEN** `TeammateSpawn` completes with `details.member` and status `spawning`
- **THEN** the card shows the member name, role and a state, and a link to the Team view

#### Scenario: Failed call
- **WHEN** a team tool row has `status` `error` with `details.error` `team_full`
- **THEN** the card shows an error state with the code and a readable sentence

#### Scenario: Unknown error code
- **WHEN** a team tool row carries an error code the UI does not know
- **THEN** the card shows "Unexpected error (<code>)" with the code verbatim

#### Scenario: Details elided or foreign
- **WHEN** the row has status `elided`, no `toolDetails`, or details of an unknown shape (a same-named tool of another extension)
- **THEN** the card shows the input summary and the result text, never blank
