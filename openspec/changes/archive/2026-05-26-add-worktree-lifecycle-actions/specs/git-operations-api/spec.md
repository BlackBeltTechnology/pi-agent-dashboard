## ADDED Requirements

### Requirement: Four worktree-lifecycle endpoints registered
The server SHALL register the four new endpoints under `/api/git/worktree/*` defined in the `worktree-lifecycle` capability:

- `POST /api/git/worktree/remove`
- `POST /api/git/worktree/merge`
- `POST /api/git/worktree/push`
- `POST /api/git/worktree/pr`
- `GET /api/git/worktree/diff-stat`

Every route SHALL apply the existing `validateCwd` (realpath check via `safeRealpathSync`) and SHALL be gated on loopback / trusted-bypass like the existing `POST /api/git/worktree` (create) route.

#### Scenario: All routes accept POST/GET shape from existing dialog
- **WHEN** any of the four routes is called with a valid cwd
- **THEN** the request body shape SHALL match what `git-api.ts` client helpers send

#### Scenario: Non-loopback origin rejected
- **WHEN** the request originates from a non-loopback address and is not in the trusted bypass set
- **THEN** the response SHALL be the standard auth-block envelope
