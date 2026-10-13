## ADDED Requirements

### Requirement: `ServerPluginContext` exposes resolved pi resources

`ServerPluginContext` SHALL expose an optional `getPiResources?(cwd?: string, opts?: { fresh?: boolean }): Promise<PiResourcesResult>`. It returns the resolved resources from the same cache `GET /api/pi-resources` uses, without the per-session provenance join that route adds:
- a cached result SHALL be returned at once, and a stale one SHALL also trigger one background rescan;
- a cold miss SHALL await a scan;
- an omitted `cwd` SHALL scan relative to the server's working directory, as the route does;
- with `fresh: true` the call SHALL resolve with a scan that started after the call; a scan already running when the call arrives SHALL NOT satisfy it.

The capability SHALL be optional on the type, so contexts built without it remain valid.

#### Scenario: Cached result reused
- **WHEN** a plugin calls `getPiResources("/repo")` twice and the cache entry is fresh
- **THEN** both calls SHALL resolve without a rescan

#### Scenario: Fresh read after invalidation
- **WHEN** the entry for `/repo` was just invalidated and a plugin calls `getPiResources("/repo", { fresh: true })`
- **THEN** the call SHALL resolve only after a rescan and SHALL include a skill added before the invalidation

#### Scenario: In-flight scan does not satisfy a fresh read
- **WHEN** a scan of `/repo` is running, a skill is then added, and a plugin calls `getPiResources("/repo", { fresh: true })`
- **THEN** the call SHALL resolve with a result that includes the added skill

#### Scenario: Stale entry served and refreshed
- **WHEN** the cache entry for `/repo` is stale
- **THEN** the call SHALL resolve with the stale result and exactly one background rescan SHALL start

### Requirement: `ServerPluginContext` signals pi resource invalidation

`ServerPluginContext` SHALL expose an optional `onPiResourcesInvalidated?(handler: (cwd: string | undefined) => void): () => void`. The host SHALL invoke handlers:
- when the pi-resources watcher invalidates a folder (`cwd` set) or the global scope (`cwd` undefined);
- when any session reports its command list, with that session's working directory (nothing is emitted for a session the host does not know).

A throwing handler SHALL NOT affect other handlers or the host. The returned function SHALL unsubscribe.

#### Scenario: Watcher invalidation
- **WHEN** a skill directory is added under `/repo/.pi/skills`
- **THEN** subscribed handlers SHALL be called with `"/repo"`

#### Scenario: Command list arrival
- **WHEN** a session whose cwd is `/repo` sends its command list after a reload
- **THEN** subscribed handlers SHALL be called with `"/repo"`

#### Scenario: Global change
- **WHEN** `~/.pi/agent/settings.json` changes
- **THEN** subscribed handlers SHALL be called with `undefined`

#### Scenario: Unsubscribe
- **WHEN** a plugin calls the function returned by `onPiResourcesInvalidated`
- **THEN** its handler SHALL NOT be called again
