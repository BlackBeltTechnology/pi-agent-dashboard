# tool-output-linkification — delta

## ADDED Requirements

### Requirement: Worktree link-origin re-rooting

The link resolution SHALL re-root an **absolute** file-link token whose path is rooted in the parent checkout onto the worktree's own tree when the session `cwd` is a dashboard worktree (`<parentRoot>/.worktrees/<slug>`). The re-root SHALL apply before the path is used for the tooltip, the preview overlay target, and the open-in-editor target, and SHALL replace the leading `<parentRoot>` segment of the path with the session `cwd` (the worktree root).

`<parentRoot>` SHALL be derived from `cwd` alone by stripping a trailing
`/.worktrees/<slug>` (or `\.worktrees\<slug>` on Windows) segment — a pure string
operation, no server round-trip and no git invocation. Separator style and
drive-letter case SHALL be normalized before the prefix compare so a forward-slash
path and a native-separator cwd still match on Windows.

Re-rooting SHALL apply ONLY when all hold; otherwise the path SHALL pass through
unchanged (fail-open, never widening the target set beyond today's behavior):

- the token is absolute, AND
- `cwd` matches the `<parentRoot>/.worktrees/<slug>` shape, AND
- the absolute path is under `<parentRoot>` but NOT already under `cwd`.

Relative tokens SHALL continue to resolve against `cwd` unchanged.

#### Scenario: parent-rooted absolute path re-rooted to the worktree
- **GIVEN** session `cwd` is `/repo/.worktrees/x`
- **WHEN** an absolute token `path="/repo/node_modules/vitest/package.json"` is clicked
- **THEN** the resolved/opened target SHALL be `/repo/.worktrees/x/node_modules/vitest/package.json`
- **AND** the tooltip SHALL show the worktree-rooted path

#### Scenario: path already under the worktree is unchanged
- **GIVEN** session `cwd` is `/repo/.worktrees/x`
- **WHEN** an absolute token `path="/repo/.worktrees/x/src/foo.ts"` is clicked
- **THEN** the target SHALL remain `/repo/.worktrees/x/src/foo.ts` (no double-rooting)

#### Scenario: foreign absolute path is unchanged
- **GIVEN** session `cwd` is `/repo/.worktrees/x`
- **WHEN** an absolute token `path="/etc/hosts"` (not under `<parentRoot>`) is clicked
- **THEN** the target SHALL remain `/etc/hosts` verbatim

#### Scenario: non-worktree session is unchanged
- **GIVEN** session `cwd` is `/repo` (no `.worktrees/<slug>` segment)
- **WHEN** an absolute token `path="/repo/node_modules/vitest/package.json"` is clicked
- **THEN** the target SHALL remain `/repo/node_modules/vitest/package.json` verbatim

#### Scenario: re-root applies to the open target, not only the tooltip
- **GIVEN** session `cwd` is `/repo/.worktrees/x` and a localhost editor is detected
- **WHEN** an absolute token `path="/repo/node_modules/vitest/package.json"` is clicked
- **THEN** the `POST /api/open-editor` request SHALL target `/repo/.worktrees/x/node_modules/vitest/package.json`

#### Scenario: relative token still resolves against cwd
- **GIVEN** session `cwd` is `/repo/.worktrees/x`
- **WHEN** a relative token `path="node_modules/vitest/package.json"` is clicked
- **THEN** the target SHALL resolve to `/repo/.worktrees/x/node_modules/vitest/package.json` as today

## MODIFIED Requirements

### Requirement: Click routing — localhost editor

When the dashboard is running on localhost AND at least one editor is detected in `ToolContext.editors`, clicking a file link SHALL invoke the existing `openEditor(cwd, editors[0].id, path, line)` call. The `cwd` MUST come from `ToolContext.cwd`. Relative paths MUST be resolved against `cwd` at click time. Absolute paths (POSIX `/`, decoded `file://`, Windows drive) MUST be passed through unchanged and MUST NOT be re-rooted under `cwd`, EXCEPT when the worktree link-origin re-rooting applies (session `cwd` is a `<parentRoot>/.worktrees/<slug>` worktree and the absolute path is rooted under `<parentRoot>`): in that case the path SHALL be re-rooted onto the worktree before the open-editor request, per the "Worktree link-origin re-rooting" requirement.

#### Scenario: localhost with editor
- **GIVEN** the dashboard is loaded from `http://localhost:8000` and `ToolContext.editors = [{id:"code", name:"VS Code"}]`
- **WHEN** the user clicks a file link with `path="src/foo.ts"` and `line=42`
- **THEN** the client SHALL `POST /api/open-editor` with body containing `editor: "code"`, `file: "src/foo.ts"`, `line: 42`, and `path` set to the session cwd

#### Scenario: localhost editor with foreign absolute path
- **GIVEN** the dashboard is loaded from `http://localhost:8000` with a detected editor
- **WHEN** the user clicks a file link with absolute `path="/Users/me/app.ts"` not under the session worktree's parent root
- **THEN** the open-editor request SHALL target `/Users/me/app.ts` verbatim
- **AND** the path SHALL NOT be joined to the session cwd

#### Scenario: localhost editor with parent-rooted absolute path in a worktree
- **GIVEN** the dashboard is on localhost with a detected editor and session `cwd` is `/repo/.worktrees/x`
- **WHEN** the user clicks a file link with absolute `path="/repo/vitest.config.ts"`
- **THEN** the open-editor request SHALL target `/repo/.worktrees/x/vitest.config.ts`
