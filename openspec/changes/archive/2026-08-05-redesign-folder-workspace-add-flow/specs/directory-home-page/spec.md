## REMOVED Requirements

### Requirement: Directory-eligibility guard

**Reason**: The guard contradicts the navigation affordances that surround it. `directory-card-clickable-select`
made the whole folder row navigate to `/folder/<encodedCwd>`, and the row renders for any cwd the sidebar can
group — including cwds that are neither pinned nor workspace members. The guard therefore refuses to draw a page
the UI actively steers users to, producing a dead end whose only escape was a single "Pin this folder" CTA. Since
a groupable cwd always has enough state to render its home page (its session list and a spawn prompt), the
eligibility question is not worth asking: organising a folder becomes an opt-in choice rather than a toll gate.
Removing the guard also removes the two-message cold-load race (`pinned_dirs_updated` + `workspaces_updated`)
that the guard existed to arbitrate.

**Migration**: No user action is required. Cwds that previously rendered the home page continue to render it
unchanged; cwds that previously rendered the "not available" notice now render the normal home page. The
`directoryHome.notPinnedTitle`, `directoryHome.notPinnedBody`, and `directoryHome.pinCta` i18n keys and the
`directory-home-not-pinned` test id are retired. Callers no longer need to thread `pinnedDirectoriesLoaded` or
`workspacesLoaded` into `DirectoryHomeView` for eligibility purposes; the component's loading state is now
governed solely by whether its own session data has arrived. Pinning and workspace assignment remain available
from the folder row's icon cluster and from the Add Folders dialog.
