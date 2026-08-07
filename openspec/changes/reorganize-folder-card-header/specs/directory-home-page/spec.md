## REMOVED Requirements

### Requirement: Sidebar open affordance

**Reason**: Superseded by "Requirement: Whole-row open affordance". The dedicated
`mdiOpenInNew` icon duplicated the destination of the header-row click, and it rendered only
on pinned or workspace-owned rows — present where the gesture is already learned, absent on
plain folder rows where it might have taught it. Sidebar navigation to `/folder/:encodedCwd`
remains fully specified by the whole-row requirement, which already mandates that child
controls stop propagation and that navigation does not toggle the collapsed state.

**Migration**: The `folder-open-home-<cwd>` test id is removed. Automation navigating to a
directory home page from the sidebar SHALL activate the header row
(`folder-home-row-<cwd>`) instead. The folder name gains a hover underline so the row reads
as a link.
