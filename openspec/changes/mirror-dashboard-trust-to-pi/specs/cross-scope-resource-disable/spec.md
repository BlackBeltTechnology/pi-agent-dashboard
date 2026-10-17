## MODIFIED Requirements

### Requirement: An untrusted folder SHALL prompt for a trust decision instead of reporting success

The toggle SHALL guarantee that an explicit trust decision is recorded for the folder once the write completes, unless the configured default is `always`, which proceeds without recording so that folders the user merely toggled are not enrolled permanently. Suppressing the `projectTrusted` argument is not sufficient, because it defaults to true; an explicit check SHALL be performed.

The toggle SHALL NOT skip recording on the grounds that the folder currently has no trust-requiring resources, because writing `.pi/settings.json` is itself what makes a folder trust-requiring. A write performed against an implicitly-trusted folder leaves the next session facing a trust-requiring folder with no recorded decision, which resolves to untrusted when headless or declined — silently discarding the setting just written.

The order SHALL be: a recorded decision decides; otherwise the configured default decides, where `always` proceeds **without recording**, `never` refuses without prompting, and `ask` prompts and records the choice.

When the outcome is a prompt, the toggle SHALL NOT write, and SHALL return a `trust_required` result carrying the offered options. A refusal recorded for the folder itself SHALL refuse as today; an inherited ancestor refusal SHALL prompt as today. When durable dashboard trust (`pi-trust-mirror`) covers the folder and nothing is recorded for it or an ancestor, the prompt SHALL also be returned when the configured default is `never`, SHALL pre-select the option that trusts the folder, SHALL name the dashboard source, and SHALL state that approving writes a lasting pi decision that terminal pi also honours and that unpinning does not remove; nothing SHALL be recorded until the operator chooses. On approval the decision SHALL be persisted through the dashboard's `persistTrustDecision` wrapper over pi's trust store and the toggle retried.

#### Scenario: A folder with no trust-requiring resources still records a decision
- **GIVEN** a cwd with no `.pi` directory, which pi currently loads as trusted
- **WHEN** a `local`-scope toggle is requested and no decision is recorded
- **THEN** the user is prompted rather than silently proceeding
- **AND** after approval a trust decision is recorded for that folder
- **AND** a session newly started in that folder afterwards reports the resource disabled

#### Scenario: The prompt explains why it appeared for an implicitly-trusted folder
- **GIVEN** the folder above
- **WHEN** the trust prompt is returned
- **THEN** it states that the folder is trusted implicitly today and that saving this setting will require an explicit decision from now on

#### Scenario: A recorded decision is honoured without prompting
- **GIVEN** a cwd with a recorded trust decision of trusted
- **WHEN** a `local`-scope toggle is requested
- **THEN** that decision is applied and no prompt is returned

#### Scenario: A recorded refusal blocks the write
- **GIVEN** a cwd with a recorded trust decision of not trusted
- **WHEN** a `local`-scope toggle is requested
- **THEN** the toggle is refused with an explanatory error
- **AND** no settings file is written

#### Scenario: The configured default decides when nothing is recorded
- **GIVEN** a cwd with no recorded decision
- **WHEN** the configured default is `always`
- **THEN** the toggle proceeds **without** recording a trust decision, so folders the user merely toggled are not enrolled permanently
- **AND** when the configured default is `never` and no dashboard trust covers the cwd, the toggle is refused with an explanatory error and no prompt
- **AND** when the configured default is `ask`, a trust prompt is returned

#### Scenario: Tightening the default later stops applying prior disables
- **GIVEN** a folder disabled while the default was `always`, with no recorded decision
- **WHEN** the default is later changed to `ask` and a headless session starts in that folder
- **THEN** the folder resolves untrusted and the disable does not apply
- **AND** this consequence is documented rather than silently absorbed

#### Scenario: Untrusted folder returns trust options rather than writing
- **GIVEN** a cwd with no recorded decision and the default set to `ask`
- **WHEN** a `local`-scope toggle is requested
- **THEN** the response indicates trust is required
- **AND** it offers trusting the folder, trusting its parent folder, and declining
- **AND** `<cwd>/.pi/settings.json` is not modified

#### Scenario: Session-only trust is not offered
- **GIVEN** the trust options returned for a toggle
- **WHEN** they are inspected
- **THEN** no session-scoped option is present, because the setting being written outlives any session

#### Scenario: Approving trust persists the decision and applies the toggle
- **GIVEN** a `trust_required` response
- **WHEN** the user chooses one of the offered options
- **THEN** that option's updates are persisted through pi's trust store
- **AND** the original toggle is applied
- **AND** the resource reports the requested state

#### Scenario: Declining trust leaves everything unchanged
- **GIVEN** a `trust_required` response
- **WHEN** the user declines
- **THEN** no trust decision is recorded
- **AND** no settings file is written
- **AND** the control returns to its previous state

#### Scenario: A trusted folder is unaffected
- **GIVEN** a cwd already trusted
- **WHEN** a `local`-scope toggle is requested
- **THEN** no trust prompt is returned and the toggle is applied directly

#### Scenario: Dashboard-trusted folder pre-selects trust in the prompt
- **GIVEN** a pinned cwd with no recorded decision and the default set to `ask`
- **WHEN** a `local`-scope toggle is requested
- **THEN** the response indicates trust is required, pre-selects trusting the folder, and names "pinned folder" as the reason
- **AND** nothing is recorded and `<cwd>/.pi/settings.json` is not modified until the operator chooses
