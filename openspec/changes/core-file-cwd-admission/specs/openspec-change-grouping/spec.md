## MODIFIED Requirements

### Requirement: Authentication and cwd validation
All `/api/openspec/groups*` routes SHALL be auth-gated identical to other dashboard mutation routes. The `cwd` query parameter SHALL be admitted by the shared cwd admission guard (`core-cwd-admission`): a known folder (session cwd, pinned directory or workspace folder), or a subdirectory / linked worktree whose main checkout is a known folder. A cwd whose canonical `openspec/` directory is the global openspec directory SHALL be refused. A refused cwd SHALL return HTTP 403; an undecidable admission SHALL return the shared 503.

#### Scenario: Unauthenticated request rejected
- **WHEN** a GET / POST / PATCH / DELETE / PUT is issued without authentication
- **THEN** the response SHALL be HTTP 401

#### Scenario: cwd not in known-cwd set rejected
- **WHEN** an authenticated request targets a cwd unknown to the dashboard
- **THEN** the response SHALL be HTTP 403 with `{ success: false, error: "cwd not allowed", code: "cwd_unknown" }`

#### Scenario: Worktree of a pinned repository is accepted
- **WHEN** an authenticated `GET /api/openspec/groups` names a sessionless linked worktree of a pinned repository
- **THEN** the groups file of that worktree SHALL be returned
