## Purpose

Make agents in any project that uses the mockup loop produce faithful live mocks every
time, show them through the package's own tools, and talk about them with precise
links, without the package knowing anything about its host.

## ADDED Requirements

### Requirement: Live-component mock is the mandatory default
The `frontend-mockup-loop` skill SHALL require a live-component mock for any
mock, mockup, UI-option, variant or redesign request in a project whose components
the mock site can build. A static HTML board SHALL be allowed only for a pure
geometry repro, or in a project with no buildable components. The agent SHALL state
which exception applies whenever it builds one.

#### Scenario: Casual request
- **WHEN** a user asks "mock me some options" in a project the mock site supports
- **THEN** the skill directs the agent to live-component mock pages, not static HTML

#### Scenario: Stretched exception
- **WHEN** the surface to mock is composed of existing app components
- **THEN** the "no components yet" exception does not apply

### Requirement: Fidelity rules
The skill SHALL require four fidelity rules:
- (R1) both panes share the same surroundings
- (R2) Current renders today's shipped components, not redraws
- (R3) only ringed parts differ between Current and Proposed
- (R4) data follows real record shapes, and real product nouns replace placeholder names

Behaviour that a reviewer must judge SHALL be shown with a scripted frame, not
described in prose.

#### Scenario: Redrawn current
- **WHEN** an agent following the skill is about to build a Current pane by copying a shipped component's markup
- **THEN** the skill's checklist directs it to render the shipped component instead, and lists R1-R4 as items to confirm before showing the mock

### Requirement: Show mocks through the package tools with reference links
The skill SHALL direct the agent to serve mocks with the package's own serve tool and
show the result to the user. It SHALL NOT name any host-specific display tool. Every
question to the user about a mock SHALL carry the clickable reference URL of the
page, frame, side or ring it concerns.

#### Scenario: Asking about one ring
- **WHEN** the agent asks the user to choose between two proposed variants of one element
- **THEN** the question includes the full reference URLs of both rings

### Requirement: Package text is host-agnostic
The package's skill, references, README and tool descriptions and result texts SHALL
NOT name a specific host application, a host-specific tool, or a host-specific
helper command. Where the package must avoid a host's port, it SHALL describe it as
a reserved port.

#### Scenario: Host names absent
- **WHEN** the package's skill, references, README and source tool strings are searched for host-specific names (the host product name, a host canvas tool, a host install helper)
- **THEN** none are found, and the serve tools tell the agent to show the served URL to the user

### Requirement: Decisions are recorded by the agent
The skill SHALL direct the agent to record a mock decision with the decide CLI, after
the user's verdict in conversation or after the agent's own scored review. A reject
SHALL always carry a reason.

#### Scenario: User approves in chat
- **WHEN** the user says a mock page is good
- **THEN** the agent runs the CLI accept for that page reference and reports the recorded decision
