# ai-pr-description — delta

## ADDED Requirements

### Requirement: Suggest endpoint drafts PR title and body
The server SHALL expose `POST /api/git/worktree/pr/suggest` accepting `{ cwd }`. It SHALL
resolve the PR base/head, gather the branch's commit log (subjects and short bodies) and
`git diff --stat <base>..<head>`, and return `{ title, body }` drafted by a model called via
the model-proxy. The request SHALL carry only commit metadata and the diffstat — never file
contents — and SHALL cap the number of commits and diffstat lines so the prompt stays bounded.

#### Scenario: Suggestion from a branch with commits
- **WHEN** the endpoint is called for a cwd whose branch is ahead of its base
- **THEN** the response SHALL contain a non-empty `title` and `body` derived from the commits
  and diffstat

#### Scenario: No file contents are sent to the model
- **WHEN** a suggestion is generated
- **THEN** the model prompt SHALL include commit subjects/bodies and the diffstat only
- **AND** SHALL NOT include file contents

#### Scenario: Bounded input on a large branch
- **WHEN** the branch has more commits or diffstat lines than the caps
- **THEN** the prompt SHALL be truncated to the caps

### Requirement: Suggestion is a prefill, never an auto-submit
The suggestion SHALL only populate the editable PR title/body fields. Pull-request creation
SHALL remain the operator-confirmed `POST /api/git/worktree/pr` call, unchanged.

#### Scenario: Operator edits before creating
- **WHEN** the operator accepts a suggestion and edits the body
- **THEN** the created PR SHALL use the edited text via the existing PR endpoint

### Requirement: Graceful degradation when suggestion is unavailable
The suggest endpoint SHALL degrade gracefully: when no model is configured, the model call
fails or times out, or git/gh is unavailable, it SHALL return a well-formed no-suggestion
result and SHALL NOT break or block the PR dialog or PR creation.

#### Scenario: No model configured
- **WHEN** no model is available to the model-proxy
- **THEN** the endpoint SHALL return a no-suggestion result
- **AND** the PR dialog SHALL remain usable for manual entry

#### Scenario: Model error does not break PR creation
- **WHEN** the model call errors or times out
- **THEN** the PR dialog SHALL still allow manual title/body entry and PR creation

### Requirement: Suggest endpoint is authenticated
The suggest route SHALL be subject to the same authentication as the dashboard's other git
routes, so it is not reachable unauthenticated when the dashboard is exposed remotely.

#### Scenario: Unauthenticated request rejected
- **WHEN** the suggest endpoint is called without a valid credential on a gated deployment
- **THEN** the server SHALL reject the request
