## ADDED Requirements

### Requirement: Activity detector rejects non-slug change names
`detectOpenSpecActivity` SHALL only return a `DetectedActivity` with a `changeName` when the captured token matches the OpenSpec change-slug shape: lowercase, must start with a letter, kebab-case allowed, max 64 characters (regex `^[a-z][a-z0-9-]{0,63}$`). When a path-based regex (`openspec/changes/<name>/...`) or a CLI regex (`openspec archive`, `openspec new change`, `--change`) captures a token failing this shape, the function SHALL return `null` (for path/CLI captures whose only useful output is `changeName`) or omit `changeName` from the result.

This subsumes the existing `-`-prefix guard: a leading `-` already fails the `[a-z]` first-character rule. The shape predicate SHALL be exposed as `isValidOpenSpecChangeSlug(name: string): boolean` from the same module so other server code can reuse it.

#### Scenario: UUID-shaped path is ignored
- **WHEN** `detectOpenSpecActivity` is called with tool `"write"` and `path: "openspec/changes/019df0aa-1234-5678-9abc-def012345678/proposal.md"`
- **THEN** the result SHALL be `null`

#### Scenario: UUID-shaped CLI argument is ignored
- **WHEN** `detectOpenSpecActivity` is called with tool `"bash"` and command `'openspec archive 019df0aa-1234-5678-9abc-def012345678'`
- **THEN** the result SHALL be `null`

#### Scenario: Uppercase change name is ignored
- **WHEN** `detectOpenSpecActivity` is called with tool `"read"` and `path: "openspec/changes/AddAuth/proposal.md"`
- **THEN** the result SHALL be `null`

#### Scenario: Underscore-containing token is ignored
- **WHEN** `detectOpenSpecActivity` is called with tool `"bash"` and command `'openspec archive add_auth'`
- **THEN** the result SHALL be `null`

#### Scenario: Digit-prefixed token is ignored
- **WHEN** `detectOpenSpecActivity` is called with tool `"bash"` and command `'openspec archive 1bad'`
- **THEN** the result SHALL be `null`

#### Scenario: Token exceeding length cap is ignored
- **WHEN** `detectOpenSpecActivity` is called with a `changeName` candidate longer than 64 characters
- **THEN** the result SHALL be `null`

#### Scenario: Valid kebab-case slug is still extracted
- **WHEN** `detectOpenSpecActivity` is called with tool `"bash"` and command `'openspec archive add-auth'`
- **THEN** the result SHALL be `{ changeName: "add-auth", isActive: true }`

#### Scenario: Valid slug with digits is still extracted
- **WHEN** `detectOpenSpecActivity` is called with tool `"bash"` and command `'openspec archive valid-name-123'`
- **THEN** the result SHALL be `{ changeName: "valid-name-123", isActive: true }`

### Requirement: Auto-attach branch re-validates change-name shape
The server's auto-attach branch in `event-wiring.ts` SHALL re-validate `detected.changeName` against `isValidOpenSpecChangeSlug` before stamping `session.openspecChange`, setting `session.attachedProposal`, or sending `rename_session`. When the predicate returns `false`, the auto-attach branch SHALL skip all three mutations for that event. This is intentional defense-in-depth so a future detector regression cannot rename a session to junk.

User-initiated attach paths (`handleAttachProposal`, REST `POST /api/session/:id/attach-proposal`) operate on names from a server-curated list and SHALL NOT add this re-validation.

#### Scenario: Detector returns valid slug — auto-attach proceeds
- **WHEN** `detectOpenSpecActivity` returns `{ changeName: "add-auth", isActive: true }` for a session with `attachedProposal = null` and `name` empty
- **THEN** the server SHALL set `session.openspecChange = "add-auth"`, `session.attachedProposal = "add-auth"`, send `rename_session{ name: "add-auth" }`, and broadcast `session_updated`

#### Scenario: Future detector regression returns junk — rename site refuses
- **WHEN** `detectOpenSpecActivity` returns `{ changeName: "019df0aa-1234-5678-9abc-def012345678", isActive: true }` for a session with `attachedProposal = null` and `name` empty (simulating a detector bug)
- **THEN** the server SHALL NOT mutate `session.openspecChange`, `session.attachedProposal`, or `session.name`, and SHALL NOT send `rename_session`

#### Scenario: Manual attach via browser is unaffected
- **WHEN** the browser sends `{ type: "attach_proposal", sessionId: "s1", changeName: "AnyShape" }`
- **THEN** the server SHALL set `session.attachedProposal = "AnyShape"` exactly as today, with no slug-shape validation

## MODIFIED Requirements

### Requirement: Activity detector rejects flag-shaped change names
`detectOpenSpecActivity` SHALL NOT return a `changeName` whose first character is `-`. This requirement is now implemented as a strict subset of the slug-shape rule (`^[a-z][a-z0-9-]{0,63}$`): a leading `-` fails the `[a-z]` first-character class. The implementation SHALL collapse both checks into a single call to `isValidOpenSpecChangeSlug`. The behavior described below remains binding for compatibility with prior fixtures.

#### Scenario: openspec archive --help is ignored
- **WHEN** `detectOpenSpecActivity` is called with tool `"bash"` and command `"openspec archive --help"`
- **THEN** the result SHALL be `null`

#### Scenario: openspec new change --help is ignored
- **WHEN** `detectOpenSpecActivity` is called with tool `"bash"` and command `"openspec new change --help"`
- **THEN** the result SHALL be `null`

#### Scenario: --change flag followed by another flag is ignored
- **WHEN** `detectOpenSpecActivity` is called with tool `"bash"` and command `"openspec foo --change --help"`
- **THEN** the result SHALL be `null`

#### Scenario: Real change names are still extracted
- **WHEN** `detectOpenSpecActivity` is called with tool `"bash"` and command `"openspec archive add-auth"`
- **THEN** the result SHALL be `{ changeName: "add-auth", isActive: true }`

#### Scenario: Quoted change names are still extracted
- **WHEN** `detectOpenSpecActivity` is called with tool `"bash"` and command `'openspec archive "add-auth"'`
- **THEN** the result SHALL be `{ changeName: "add-auth", isActive: true }`
