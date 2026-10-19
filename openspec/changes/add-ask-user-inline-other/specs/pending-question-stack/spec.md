## MODIFIED Requirements

### Requirement: Questions are accessible through a REST API

The server SHALL expose, owner-scoped as above:

- `GET /api/questions` (`observe`) — rows: id, session id, session label, change
  name, preview, prompt type, origin, age, `briefStatus`; no context bodies.
- `GET /api/questions/:id` (`observe`) — full question, options, brief, snapshot,
  `briefStatus`, answerable flag; `404` when unknown, not pending, or not visible
  to the caller.
- `POST /api/questions/:id/answer` (`control`) — body either `{ answer: string }`
  or `{ cancelled: true }`; both or neither → `400`.

Question ids SHALL be opaque, URL-safe, unguessable, and stable for the lifetime
of the pending prompt including across bridge re-sends after reconnect (prompt ids
are unique per prompt, so a repeated prompt id is a re-send of the same prompt).

The `answer` string SHALL use the same encoding the dashboard chat sends for that
prompt type: `confirm` → `"true"`/`"false"`; `select` → one of the options;
`multiselect` → a JSON-encoded array of distinct options (empty array allowed,
distinct from cancel); `input` and `editor` → any string including empty;
`batch` → a JSON-encoded array with one entry per sub-question, each valid for
that sub-question's type. When the prompt (or batch sub-question) is opted into
the inline Other answer, a `select` answer MAY instead be one custom string, and
a `multiselect` array MAY contain at most one custom string beside distinct
options. Opted in means it carries `allowOther: true` and none of its options is
already an "Other" option, by the same definition the dashboard uses to show the
inline "Other" row. A custom string is one that is not exactly an option, is non-empty, and has no
leading or trailing whitespace (the shape the dashboard UI produces); a padded
non-option string is invalid. Duplicates remain invalid. The question
record and the question detail SHALL keep the prompt's opt-in, so validation and
the question dialog can apply it. A valid answer SHALL be transmitted exactly as
posted. Invalid → `400`, nothing transmitted. REST answers are
text-only: image attachments that the dashboard chat can add to `input` and
`batch` answers are not supported on this road.

At most one user answer SHALL ever be transmitted per question, regardless of
concurrent answers from any road (REST, dashboard chat, dialog, another device).
The claim SHALL be released if transmission fails, so the question can be answered
again. The route SHALL respond with `{ transmitted: boolean }` (not a delivery
guarantee). An answer for a question whose answer was transmitted within the last
10 minutes SHALL return `409` naming that disposition (this window is held in
server memory and does not survive a restart); otherwise an unknown id SHALL
return `404`. Transmitting an answer SHALL remove the entry from the stack at once
while the pending prompt itself stays registered until the session confirms it. Answers to file-access prompts SHALL return `403`. Answers to
prompts of chat-gateway sessions SHALL follow the same authorization as answering
them in the dashboard chat.

#### Scenario: Answer through the API

- **WHEN** a `control`-tier caller posts a valid answer for an open question it may see
- **THEN** the response SHALL be `{ transmitted: true }` and the question SHALL leave the stack

#### Scenario: Concurrent double answer

- **WHEN** two answers for the same question arrive concurrently from the API and the chat
- **THEN** exactly one SHALL be transmitted and the other SHALL be rejected (`409` on the API road)

#### Scenario: Transmission fails

- **GIVEN** the asking session's bridge is disconnected
- **WHEN** an answer is posted
- **THEN** the response SHALL be `{ transmitted: false }`, the question SHALL stay open, and a later answer SHALL be accepted

#### Scenario: Invalid option

- **WHEN** a select answer is not one of the options
- **AND** the prompt does not carry `allowOther: true`
- **THEN** the server SHALL return `400` and the question SHALL stay open

#### Scenario: Custom select answer accepted

- **WHEN** a select prompt carrying `allowOther: true` receives the answer `"something else"`
- **THEN** the answer SHALL be transmitted unchanged

#### Scenario: Blank custom answer rejected

- **WHEN** a select prompt carrying `allowOther: true` receives the answer `"   "` (not an option)
- **THEN** the server SHALL return `400` and the question SHALL stay open

#### Scenario: Multiselect with one custom value

- **WHEN** a multiselect prompt with options `["A","B"]` carrying `allowOther: true` receives `["A","D"]`
- **THEN** the answer SHALL be accepted
- **WHEN** it receives `["D","E"]` (two custom values)
- **THEN** the server SHALL return `400`

#### Scenario: Padded custom answer rejected

- **WHEN** a select prompt carrying `allowOther: true` with options `["A","B"]` receives `" A "`
- **THEN** the server SHALL return `400`

#### Scenario: Own Other option disables custom

- **WHEN** a select prompt carrying `allowOther: true` has options `["Approve","Other (describe)"]` and receives `"maybe"`
- **THEN** the server SHALL return `400`

#### Scenario: Duplicate custom value rejected

- **WHEN** a multiselect prompt carrying `allowOther: true` receives `["D","D"]`
- **THEN** the server SHALL return `400`

#### Scenario: Batch sub-question opt-out

- **WHEN** a batch answer gives a custom value to a select sub-question that does not carry `allowOther: true`
- **THEN** the server SHALL return `400`

#### Scenario: Both answer and cancel

- **WHEN** the body has both `answer` and `cancelled: true`
- **THEN** the server SHALL return `400`

#### Scenario: File-access prompt

- **WHEN** an answer is posted for an agent file-access prompt
- **THEN** the server SHALL return `403` and the prompt SHALL stay pending

#### Scenario: Insufficient tier

- **WHEN** an `observe`-tier caller posts an answer
- **THEN** the server SHALL reject it and the question SHALL stay open
