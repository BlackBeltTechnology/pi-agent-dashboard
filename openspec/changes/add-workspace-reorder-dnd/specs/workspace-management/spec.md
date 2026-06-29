## REMOVED Requirements

### Requirement: Workspace CRUD operations
**Reason**: The `workspace-management` capability described a "workspace =
single folder" model (REST API, `workspaces.json`, `sortOrder`, `workspace_updated`
broadcast) that was ripped out, never wired to any UI, and already declared
REMOVED by the `folder-workspaces` change. The standalone
`openspec/specs/workspace-management/spec.md` file was left behind as an orphan:
it is implemented nowhere in the server, is referenced by no active change, and
fails `openspec validate` (it carries `## MODIFIED Requirements` delta syntax in
a canonical spec). This delta removes the dead capability so the spec set
reflects actual system behavior. The live workspace model is `folder-workspaces`.

**Migration**: None. The legacy `workspaces.json` file and the
`workspace-management` `Workspace` type are not revived. Workspaces — as named
containers grouping multiple folders — exist under the `folder-workspaces`
capability and persist via `preferences.json`. The spec file
`openspec/specs/workspace-management/spec.md` SHALL be deleted.
