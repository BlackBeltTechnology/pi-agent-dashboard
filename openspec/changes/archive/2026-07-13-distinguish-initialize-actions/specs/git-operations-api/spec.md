## MODIFIED Requirements

### Requirement: Worktree init-status endpoint

The server SHALL expose `GET /api/git/worktree/init-status` (localhost-only) reporting whether a checkout needs initialization per its declared hook. Query/body carries `cwd`. The server SHALL validate `cwd`, resolve the repo root, and `readInitHook(repoRoot)`.

- When no hook is declared, respond `{ success: true, data: { hasHook: false, configured: boolean } }`, where `configured` distinguishes an unconfigured directory from a configured project that simply declares no `worktreeInit` hook:
  - `configured: false` when the resolved config root is `null` (no reachable `.pi/settings.json`) — the directory is not yet a pi project.
  - `configured: true` when a config root resolves and `<configRoot>/.pi/settings.json` exists but declares no (valid) `worktreeInit` hook — the directory is already a pi project.
- When a hook is declared but NOT trusted, respond `{ success: true, data: { hasHook: true, trusted: false } }` WITHOUT evaluating the gate (the gate is repo-declared bash and SHALL NOT run before TOFU trust).
- When a hook is declared AND trusted, evaluate the gate (using the cache) and respond `{ success: true, data: { hasHook: true, needsInit: boolean, trusted: true } }`.

The `configured` field SHALL be present only on `hasHook: false` responses; it SHALL be absent when `hasHook` is `true`.

#### Scenario: Unconfigured directory reports configured false

- **WHEN** `init-status` is requested for a directory with no reachable `.pi/settings.json` (config root is `null`)
- **THEN** the response SHALL be `{ success: true, data: { hasHook: false, configured: false } }`

#### Scenario: Configured project without a hook reports configured true

- **WHEN** `init-status` is requested for a checkout whose resolved config root has a `.pi/settings.json` that declares no valid `worktreeInit` hook
- **THEN** the response SHALL be `{ success: true, data: { hasHook: false, configured: true } }`

#### Scenario: Untrusted hook omits configured

- **WHEN** `init-status` is requested for a checkout whose hook is not yet trusted
- **THEN** the response SHALL be `{ hasHook: true, trusted: false }` with no `needsInit`
- **AND** the response SHALL NOT include a `configured` field
