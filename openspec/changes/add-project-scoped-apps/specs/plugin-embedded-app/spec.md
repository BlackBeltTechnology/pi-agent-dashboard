## ADDED Requirements

### Requirement: Project-scoped embedded apps
`<EmbeddedApp>` SHALL accept an optional `projectScope: { type?: string; id?: string }` with at least one field set. Without `projectScope`, behaviour SHALL be unchanged.

When `projectScope` is set:
- `<EmbeddedApp>` SHALL resolve the folder's project through the runtime project cache before mounting the app.
- While the entry is `loading`, it SHALL show the loading state.
- The folder matches only when the entry is `ready` and every field set in `projectScope` matches: `type` is among the folder's `types`, and `id` equals the folder's `id`.
- On a mismatch or an `error` entry, it SHALL NOT mount the app. It SHALL render a *Not available for this folder* state naming the app and the folder, below the usual top bar with Back.
- Without `folderParam`, it SHALL NOT mount the app. It SHALL render *Not available here* naming only the app, with Back.
- Back SHALL invoke the claim's `onBack`.
- Without `projectScope`, `<EmbeddedApp>` SHALL NOT request any folder project.

#### Scenario: Deep link to a non-matching folder
- **GIVEN** the JUDO app embeds with `projectScope={{ type: "judo" }}` and claims `/folder/:encodedCwd/judo/*?`
- **WHEN** the user opens `/folder/<docs-site>/judo` and `docs-site` resolves to `types: []`
- **THEN** the app is not mounted, *Not available for this folder* shows the app title and `docs-site`, and Back returns to `/folder/<docs-site>`

#### Scenario: Matching folder
- **WHEN** the user opens `/folder/<billing>/judo` and `billing` resolves to `types: ["judo"]`
- **THEN** the app mounts as an ordinary embedded app

#### Scenario: Project id mismatch
- **GIVEN** an app embedded with `projectScope={{ id: "acme-erp" }}`
- **WHEN** the user opens it under folder `billing`, whose project id is `null`
- **THEN** *Not available for this folder* renders and the app is not mounted
