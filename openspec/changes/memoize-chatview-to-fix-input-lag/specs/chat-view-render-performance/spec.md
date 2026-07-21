## ADDED Requirements

### Requirement: ChatView skips transcript re-render on unrelated parent renders

`ChatView` SHALL be memoized so that a re-render of its parent (`App`) does NOT re-render the `ChatView` transcript when none of `ChatView`'s props have changed by reference. In particular, typing in the command input (which updates per-session draft state held in `App`) SHALL NOT cause the chat transcript to re-render or the browser to run a layout pass over the message tree.

#### Scenario: Typing in command input does not re-render transcript
- **WHEN** the user types into the command input of a session whose transcript is already rendered, and typing only mutates `App`-level draft state
- **THEN** `ChatView` SHALL NOT re-render (React DevTools Profiler shows "Did not render") and no full-transcript layout pass SHALL be triggered by the keystroke

#### Scenario: Genuine state change still re-renders
- **WHEN** a prop that reflects real transcript state changes — a new event updates `state`, or `sessionId`/`toolContext`/`loadingHistory` changes on session switch
- **THEN** `ChatView` SHALL re-render so the displayed transcript stays correct

### Requirement: ChatView props are referentially stable across parent renders

The props passed to `ChatView` from `App` SHALL be referentially stable across `App` re-renders that do not change their underlying values, so that memoization is effective. Object/array/function props MUST NOT be recreated on every render.

#### Scenario: Empty steering list is a stable reference
- **WHEN** the selected session has no pending steering queue across successive `App` renders
- **THEN** the `pendingSteering` prop SHALL be the same array reference each render (a shared empty constant), not a freshly allocated `[]`

#### Scenario: Callback props keep identity while inputs are unchanged
- **WHEN** `App` re-renders during a typing burst (the selected session id unchanged)
- **THEN** the `onCollapseStreamingThinking`, `onForkFromMessage`, and `onCloseInlineTerminal` props SHALL retain their function identity (memoized callbacks), not be new inline closures each render

### Requirement: Ref API preserved under memoization

Memoizing `ChatView` SHALL preserve its imperative `ChatViewHandle` ref contract. The memo SHALL be applied around the `forwardRef` component so ref-based interactions continue to work.

#### Scenario: Ref handle remains functional
- **WHEN** the parent invokes the `ChatViewHandle` via its ref after `ChatView` is memoized
- **THEN** the imperative call SHALL behave exactly as before memoization (no broken or null ref)
