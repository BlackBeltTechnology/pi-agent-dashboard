## ADDED Requirements

### Requirement: The context manager is inert unless enabled
The context manager SHALL resolve `enabled` from, in order of precedence:
1. the env var `PI_CONTEXT_MANAGER` (`1` on, `0` off; any other value ignored);
2. `<cwd>/.pi/dashboard/context_manager.json`;
3. `~/.pi/dashboard/context_manager.json`;
4. a built-in default of `false`.

A layer holding invalid JSON SHALL be treated as absent. Ignored env values and malformed layers SHALL each produce one `[context-manager]` `console.warn` per process at load. When the flag resolves off for the process cwd at load, the package SHALL register no tools, no event handlers and no commands.

#### Scenario: Default is off
- **WHEN** no env var and no config file set `enabled`
- **THEN** the session's system prompt, active tool set, tool results and messages are identical to a session without the package installed

#### Scenario: Env overrides config
- **WHEN** the project config sets `enabled: true` and `PI_CONTEXT_MANAGER=0`
- **THEN** the package registers nothing

#### Scenario: Unrecognised env value
- **WHEN** `PI_CONTEXT_MANAGER=yes`
- **THEN** the value is ignored and the config layers decide
- **AND** one `[context-manager]` warning naming the ignored value is written at load

#### Scenario: Malformed project config
- **WHEN** the project `context_manager.json` is invalid JSON and the global file sets `enabled: true`
- **THEN** the context manager is enabled
- **AND** exactly one `[context-manager]` warning naming the project file is written at load

### Requirement: Activation state is computed per session and only degrades
When the context manager is registered, the session's state (`disabled`, `refused` or `active`) SHALL be computed for the session cwd by the kernel's `session_start` handler. If that handler did not run for the session, the state SHALL be computed lazily on the session's first event. `context_search` and `context_get` SHALL be registered in `session_start` only when the state is `active`, and SHALL then be added to the active tool set if missing (e.g. after pi restores a resumed session's tools from its transcript). On a later transition to `refused` they SHALL be removed from the active set. No consumer SHALL be dispatched unless the state is `active`. The state SHALL NOT become `active` from any other state within a session. It SHALL change from `active` to `refused` only through overlap detection. Flag edits SHALL take effect at the next session start or reload.

#### Scenario: Flag flipped mid-session
- **WHEN** the project config changes from `enabled: false` to `enabled: true` during a session
- **THEN** the current session's state is unchanged
- **AND** the next session evaluates the new value

#### Scenario: Resumed session gets the tools
- **WHEN** a session started with the flag off is resumed with the context manager `active`
- **THEN** `context_search` and `context_get` are in the active tool set

#### Scenario: Inactive session hides the tools
- **WHEN** the state is `refused` or `disabled` at `session_start`
- **THEN** neither `context_search` nor `context_get` is registered or active
- **AND** the transcript carries no tool-loadout change for them

### Requirement: The context manager refuses to run beside the old context packages by package identity
The context manager SHALL identify pi-hermes-memory, pi-blackhole and context-mode only by package identity, never by tool name and never by settings entries. A shared `resolveState(sessionId)` SHALL inspect the registered tools once per turn epoch. A turn epoch is bumped at `before_agent_start` and at `turn_start`, and the check SHALL run before the context manager's or kb-extension's first handler of that epoch acts. A tool SHALL belong to an old package when its `sourceInfo.source` is `npm:<name>` (any version), or its `sourceInfo` path resolves upward to a package.json whose `name` is one of the three. On a match the state SHALL become `refused`.

When refused, the context manager SHALL:
- notify once per session, naming the package and the tool source;
- remove its tools from the active set;
- dispatch nothing.

From the refusing epoch on, the existing extensions SHALL behave as they do without the context manager.

#### Scenario: hermes installed
- **WHEN** a tool with `sourceInfo.source` `npm:pi-hermes-memory` is registered at `session_start`
- **THEN** the state is `refused` before the first turn
- **AND** kb-extension's doctrine injection, guard and reindex behave exactly as when the context manager is not installed

#### Scenario: Package loaded between prompts
- **WHEN** the state is `active` and a tool whose `sourceInfo` path lies inside the installed context-mode package is registered before the next prompt
- **THEN** that prompt's epoch sets the state to `refused` before the context manager or kb-extension acts
- **AND** that prompt's doctrine is delivered by kb-extension exactly as without the context manager

#### Scenario: Identity check budget
- **WHEN** 1,000 turn epochs run with 150 registered tools and a warm resolution cache
- **THEN** the check's p95 is below 2 ms
- **AND** the first (cold) check of the session completes in under 50 ms

#### Scenario: Name collision is not a refusal
- **WHEN** a tool named `memory_search` is registered by a package whose identity is not pi-hermes-memory
- **THEN** the state stays `active`

#### Scenario: Look-alike package name
- **WHEN** a tool's `sourceInfo.source` is `npm:my-context-mode-ext`
- **THEN** it does not match

### Requirement: One hook subscription dispatches to ordered, fault-isolated consumers
The context manager SHALL subscribe once to each of `session_start`, `turn_start`, `tool_call`, `tool_result`, `before_agent_start` and `session_shutdown`. While `active`, it SHALL dispatch each event to the session's registered consumers in ascending `order`.

- Registering consumers for an owner SHALL replace all of that owner's previous entries in that session.
- The context manager SHALL dispatch only entries bound before the current event began; an owner that binds during an event SHALL handle that event itself, so every event is handled exactly once.
- `tool_result` consumers SHALL follow pi's result semantics: each returned field (`content`, `details`, `isError`, `usage`) replaces the previous value, and the next consumer receives the updated result.
- `tool_call` dispatch SHALL stop at the first consumer that returns a block.
- A consumer that throws SHALL be skipped for that event (fail-open) without altering the result or the other consumers, and SHALL produce one `[context-manager]` warning per consumer per session.
- On `session_shutdown`, the context manager SHALL close the stores it opened.

#### Scenario: Composition order
- **WHEN** two `tool_result` consumers with orders 10 and 20 each append a line to the content they receive
- **THEN** the returned content ends with the order-10 line followed by the order-20 line

#### Scenario: Faulty consumer
- **WHEN** a `tool_result` consumer throws on every event
- **THEN** the tool result equals the result the remaining consumers produce
- **AND** exactly one warning for that consumer appears in the session

#### Scenario: Reload does not stack consumers
- **WHEN** the session is reloaded twice with the context manager active
- **THEN** each hook has exactly one entry per registered consumer
- **AND** a markdown write triggers exactly one reindex

#### Scenario: Dispatch overhead budget
- **WHEN** 1,000 synthetic `tool_call` and `tool_result` events are dispatched to five no-op consumers
- **THEN** the p95 dispatch overhead per event is below 1 ms

### Requirement: kb-extension's hook bodies run exactly once per event, per session
kb-extension SHALL bind, into its own session's slot of the process-global registry `Symbol.for("pi-dashboard.context-manager.v1")`:
- its hook bodies (`tool_call`, `tool_result`, `turn_start`) as chassis consumers;
- its docs search, get and neighbours providers;
- its doctrine pinned and message providers.

It SHALL bind them at its `session_start` and lazily on any event whose slot lacks them. The slot SHALL be keyed by the session's session-manager object (weakly held, so a disposed in-process session leaves nothing reachable) and deleted on `session_shutdown`.

On every event, kb-extension's own subscriptions SHALL call `resolveState` for their session and SHALL skip their work when it returns `active`. While `active`, the context manager SHALL dispatch that session's bodies and use that session's providers. In any other state, or when the registry version differs, kb-extension SHALL behave exactly as it does without the context manager.

#### Scenario: Either load order
- **WHEN** the context manager is active and kb-extension loads before it, or after it
- **THEN** in both cases a markdown write triggers exactly one reindex
- **AND** a search chain triggers the guard exactly once per threshold crossing
- **AND** the system prompt contains exactly one doctrine fragment

#### Scenario: Guard pause still works
- **WHEN** the context manager is active and the agent calls `kb_guard_pause` for 3 turns
- **THEN** the guard dispatched by the context manager stays silent for those 3 turns

#### Scenario: In-process child session
- **WHEN** an active session creates an in-process child session with `createAgentSession` (as `commit-draft-agent` does), and the child is later disposed without `session_shutdown`
- **THEN** the parent's consumers, providers and docs store are unaffected
- **AND** the parent's guard and `kb_guard_pause` keep working
- **AND** the registry holds no strong reference to the child's slot

#### Scenario: First event, kernel handler first
- **WHEN** the context manager's handler runs before kb-extension's on an event whose slot has no kb-extension entries yet
- **THEN** kb-extension binds and handles that event itself, and the context manager dispatches kb-extension's entries from the next event on

#### Scenario: Registry version skew
- **WHEN** kb-extension binds into a different registry version than the context manager reads
- **THEN** kb-extension runs its own hooks
- **AND** `/context status` reports `docs` as `unavailable`

### Requirement: The pinned tier is byte-stable on both prompt paths
The context manager SHALL build the pinned block from its providers, prefixed by the sentinel line `── context-manager pinned ──`. When every provider returns an empty string, there SHALL be no block, no sentinel and no section.

- When the system prompt is not forced, the context manager SHALL set the block as the `context` entry of `systemPromptOptions.sections`.
- When an earlier handler has forced the system prompt, it SHALL return the prompt with the block, wrapped exactly as pi renders a section (`<context>` … `</context>`), inserted into the part after the last `</cwd>`: before the `── pi-dashboard session context ──` delimiter when present there, and appended otherwise. A forced prompt with no `</cwd>` SHALL receive the block appended.
- The forced-path insertion SHALL be idempotent on the sentinel, searched only after the last `</cwd>`.

For unchanged inputs (doctrine config, doctrine file bytes, legacy-seed verdict), the block SHALL be byte-identical on every turn.

#### Scenario: Stable across turns
- **WHEN** 100 consecutive turns run with unchanged inputs, on each prompt path
- **THEN** the pinned block is byte-identical on all 100 turns

#### Scenario: Coexists with the bridge injector in either order
- **WHEN** the real `spliceContextFragment` bridge injector runs before, or after, the context manager on a pi-0.87-shaped prompt with a `<cwd>` section and no `Current working directory:` line
- **THEN** the final system prompt contains the pinned block exactly once and the bridge fragment exactly once
- **AND** it is byte-identical across two turns in that order

#### Scenario: Literals quoted in project files
- **WHEN** a loaded AGENTS.md contains the sentinel line, the bridge delimiter and `<context>` verbatim
- **THEN** the pinned block is still inserted exactly once, after the last `</cwd>`

#### Scenario: Nothing to pin
- **WHEN** `doctrine.inject` is `off` and no other provider contributes
- **THEN** the system prompt contains no pinned block, no sentinel and no `context` section

### Requirement: Per-turn items are delivered in one message with two budgets
The context manager SHALL emit at most one `before_agent_start` message per turn, with `customType` `context-manager`.
- `onboarding` items (the doctrine first-contact and migration nudges) SHALL be delivered whole, with `display: true`, at most once per session each, where "already delivered" is determined from the session's entries so `/reload` and resume do not repeat them.
- `cue` items SHALL be capped at 2 items and 600 characters, chosen by priority.
- No message SHALL be emitted when there are no items.

#### Scenario: Long cwd keeps the nudge whole
- **WHEN** the first-contact nudge fires in a cwd 120 characters long
- **THEN** the message contains the complete nudge, including its non-interactive clause

#### Scenario: Reload does not repeat the nudge
- **WHEN** the first-contact nudge was delivered and the session is reloaded
- **THEN** no further first-contact message is emitted in that session

#### Scenario: Cue budget enforced
- **WHEN** three `cue` items of 300 characters each are contributed in one turn
- **THEN** the message carries the two highest-priority cue items

#### Scenario: Nothing to say
- **WHEN** no item is contributed
- **THEN** no message is emitted

### Requirement: The context manager's state is inspectable
The context manager SHALL log its state and the reason or evidence once per session with a `[context-manager]` prefix. It SHALL provide a `/context status` command reporting:
- the state;
- each scope as configured with a chunk count, `empty`, or `unavailable`;
- the consumers per hook with their owners;
- the active abstention floors with their normalisation and a drift indicator;
- the registry version.

#### Scenario: Status while refused at runtime
- **WHEN** the user runs `/context status` in a session refused through `sourceInfo`
- **THEN** the output shows `refused`, the detected package and the tool source that matched
