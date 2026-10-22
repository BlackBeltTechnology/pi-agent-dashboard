## MODIFIED Requirements

### Requirement: Folder project endpoint
The server SHALL expose `GET /api/folder/project?cwd=<abs>`, behind the same network guard as the other localhost file routes. It SHALL return `200 { id: string|null, types: string[], source: "declared"|"detected"|"none", truncated?: true }`.

| Condition | Response |
|---|---|
| `cwd` missing or not absolute | `400` |
| `cwd` not admitted | `403` |
| Admission indeterminate | `503` with `Retry-After` and the body `{ "error": "cwd-admission-unavailable", "message": <string>, "retryAfterMs": <number> }` |
| `cwd` admitted but not an existing directory | `404` |

- A `cwd` is admitted when the dashboard already knows it (a session cwd, a pinned directory or a workspace folder) or the shared cwd guard admits it.
- Admission SHALL run before any existence check. A missing path that is not known is refused (`403`), so `404` occurs only for an admitted path that no longer exists.
- The route SHALL be classified in the route tier map at the `observe` tier, like `GET /api/file/exists`.
- On a refused or indeterminate admission, the server SHALL read nothing under the `cwd`.
- The endpoint SHALL NEVER raise an operator access prompt.
- It SHALL be read-only and SHALL NOT create or modify any file.

#### Scenario: Unknown folder refused silently
- **WHEN** a client requests the project of a cwd that is neither known nor admitted by the guard
- **THEN** the server returns `403`, reads nothing under that cwd, and no access prompt is raised

#### Scenario: Plain folder
- **WHEN** a client requests the project of an admitted folder with no declaration and no matching marker
- **THEN** the server returns `200 { id: null, types: [], source: "none" }`
