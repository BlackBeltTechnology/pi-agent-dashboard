## MODIFIED Requirements

### Requirement: Composer liveness is reconciled with the server session status

The composer SHALL derive its liveness from a single reconciled value. When the server holds a status for the session, that status is authoritative: `ended` yields `ended`, `streaming` yields `streaming`, and `idle` or `active` yield `idle`, regardless of the event-derived chat status. When the server holds no status for the session (it is not in the live session map), the event-derived chat status is used unchanged. Every composer surface that presents run liveness — the Stop / Force-Stop control, the stop-after-turn affordance, the session-actions strip above the input, the activity line above the composer, the composer status line's working label (`StatusBar`, shown on desktop and mobile), and the liveness value handed to composer plugin panels — SHALL read that one reconciled value, so they can never disagree with each other or with the session card.

Composer controls that gate on "the agent is working" — the Stop / Force-Stop control, the stop-after-turn affordance, and the session-actions strip's working state — SHALL share one working condition: the reconciled value is `streaming`, OR an LLM-provider retry is recorded AND the reconciled value is not `ended`. A recorded retry SHALL NOT make any of them read as working on a session whose reconciled value is `ended`. The session card's working state SHALL apply the same condition to its server-held status, so card and strip agree.

The reconciliation SHALL be a derivation only. The chat transcript SHALL remain a function of real events: no run-start event is fabricated, no streaming assistant bubble appears, and no pending-prompt state is cleared as a result of the server-side signal.

#### Scenario: Card and composer agree after a reload mid-run
- **GIVEN** a session whose agent is running
- **WHEN** the user reloads the dashboard and opens that session, and the replayed events do not re-establish the run start
- **THEN** the session card shows the session as running
- **AND** the composer shows the Stop control
- **AND** the activity line above the composer presents the session as working

#### Scenario: Reconciled liveness reaches composer plugin panels
- **GIVEN** the reconciled liveness reads `streaming` only because of the server-held status
- **WHEN** a plugin-contributed composer panel reads the session status it is given
- **THEN** it receives `streaming`, the same value the Stop control acts on

#### Scenario: No fabricated transcript activity
- **GIVEN** the reconciled liveness reads `streaming` only because of the server-held status
- **WHEN** the chat transcript is rendered
- **THEN** no streaming assistant bubble is shown for a message the client never received
- **AND** any pending prompt the client is holding remains untouched

#### Scenario: Turn end hides the Stop control without lingering
- **GIVEN** a session that is running and whose composer shows the Stop control
- **WHEN** the run reaches its end and both the server-held status and the chat status leave `streaming`
- **THEN** the composer returns to its Send control
- **AND** no Stop control remains visible after the chat status settles to idle

#### Scenario: Ended session never shows a Stop control
- **GIVEN** a session whose server-held status is `ended`
- **WHEN** the session is opened after a reload
- **THEN** the composer shows no Stop or Force-Stop control
- **AND** this holds even when the event-derived chat status still reads `streaming` or a provider retry is still recorded

#### Scenario: Session-actions strip agrees with the Stop control on a killed retrying session
- **GIVEN** `SessionState.retryState` is still set because the session was killed during a retry sleep
- **WHEN** the server-held status for the session is `ended`
- **THEN** the session-actions strip does not present the session as working
- **AND** no Stop or Force-Stop control is shown

#### Scenario: Stop-after-turn follows the same reconciled liveness
- **GIVEN** the reconciled liveness reads `streaming` only because of the server-held status
- **WHEN** the composer is rendered
- **THEN** the stop-after-turn affordance is offered alongside the Stop control, exactly as it is for a chat-derived `streaming` state

#### Scenario: Mobile info strip agrees with the composer
- **GIVEN** a mobile viewport and a session whose chat status reads "idle" after a reload
- **WHEN** the server-held status for the session is "streaming"
- **THEN** the composer status line (`StatusBar`, for example "Thinking..." or "Running <tool>...") presents the session as working
