## MODIFIED Requirements

### Requirement: Delivery is observable without exposing values
The hub SHALL record the following events, each carrying the account id, binding name, session id and outcome, and no value:
- delivery, rotation and revocation;
- reconciliation;
- `local-override` skips;
- confirmation requests.

For each session, the dashboard SHALL show the bindings the session holds and their state, without values. The state SHALL be one of:
- `delivered`;
- `local-override`;
- `pending-confirmation`;
- `hub-unreachable`;
- `revoked`, with a note that processes already running may still hold the old value.
- `no-account`;
- a state that another vault capability defines.

Each state SHALL be shown as text with an icon and a one-line explanation, never by colour alone, at a text size of at least 12 px. When the session has a resolved project, the session view SHALL name it: its repository key or folder, its directory and its device. Otherwise it SHALL say that the vault does not deliver to the session and why.

When a binding is `pending-confirmation`, the session view SHALL present the confirmation as its primary action, stating how many bindings it delivers (those in `pending-confirmation`). It SHALL name the repository key, the directory and the device, say that any clone can claim a repository origin, and say that the confirmation applies to every session in that checkout. The session's entry point SHALL indicate that a confirmation is pending.

For a caller that may manage the vault, the session view SHALL also list the bindings not granted to the session's project, each with an action that grants it to that project (a repository grant when the session has a repository key, else a folder grant for its device and directory). A repository grant offered this way SHALL say the checkout still needs confirmation. A session with no resolved project (untrusted, refused transport, no project, or an unavailable vault) SHALL list none. The entry point SHALL be shown when the session holds a binding or such a caller has one to grant. Other callers SHALL NOT receive the names of ungranted bindings. While the vault is unavailable, the session view's grant and confirm actions SHALL be disabled.

#### Scenario: Session shows its bindings
- **WHEN** a user opens a session's details
- **THEN** the dashboard lists the bindings for that session, with their state and no values
- **AND** each state is shown as text with an icon and an explanation

#### Scenario: Pending confirmation is the primary action
- **WHEN** a session in an unconfirmed checkout of `github.com/robson/deck3d` has `GEMINI_API_KEY` pending confirmation
- **THEN** the session's entry point indicates a pending confirmation
- **AND** the session view names `github.com/robson/deck3d`, the directory and the device, warns that any clone can claim that origin, and offers "Confirm and deliver 1 key" as its primary action

#### Scenario: Operator grants a missing variable from the session
- **WHEN** a caller that may manage the vault opens the session view of a project that has `GEMINI_API_KEY` but not `OPENAI_API_KEY`
- **THEN** `OPENAI_API_KEY` is listed as not granted with a Grant action
- **AND** using it creates a grant of `OPENAI_API_KEY` to that session's project

#### Scenario: Ungranted names stay private
- **WHEN** an observe-tier caller requests a session's binding state
- **THEN** the response lists that session's bindings and states
- **AND** it contains no names of bindings that are not granted to the project

#### Scenario: Session without a resolved project offers nothing to grant
- **WHEN** a caller that may manage the vault opens the session view of a session refused as `transport-insecure`
- **THEN** no ungranted binding is listed
