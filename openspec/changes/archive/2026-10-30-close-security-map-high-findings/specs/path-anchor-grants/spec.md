## MODIFIED Requirements

### Requirement: A grant admits its own subtree and nothing more

A persisted grant SHALL be evaluated by a dedicated subtree check — the resolved path is the granted directory or lies under it — applied only after the existing containment layers have already refused.

A grant SHALL NOT be supplied to `isAllowed` as an additional anchor. That function performs a bound-checkout-root widening pass over every anchor it receives (`thisCheckout` and `mainCheckout`, per `git-checkout-root-resolution`), so supplying a granted subdirectory as an anchor would silently admit the entire checkout containing it. The grant check SHALL perform no checkout-root resolution and no widening of any kind.

The grant check SHALL resolve symlinks on the **requested path** before comparing, and SHALL compare against the stored subject verbatim. A lexical-only comparison of the requested path would allow a symlink inside a granted directory to reach a target outside it.

A path refused by the credential-and-state refusal of `trust-and-credential-boundaries` (the dashboard state directory and the pi-agent credential files) SHALL NOT be admitted by a grant: that refusal runs before the grant layer, a grant covering a refused file's directory (or any ancestor) never admits it, and bytes served through a grant are re-checked against the opened handle.

The check SHALL be evaluated **after** every pre-existing admission at the site, including the image-only artifact-root admission at `file-routes.ts:746` (`isImageUnderArtifactRoot`, labelled "Layer ③" in source). This capability refers to its own check as the **grant layer** rather than a layer number, so it does not collide with that existing numbering.

The check SHALL read the grant set from memory, never with a synchronous file read on the containment path, and SHALL short-circuit when the grant set is empty without performing any filesystem syscall. The containment module is asynchronous by deliberate design; a synchronous read would stall unrelated requests. The empty-store short-circuit matters because `grep-routes.ts:60` evaluates containment once per grep match, so any per-check cost is multiplied by the match count.

#### Scenario: Empty store preserves current behaviour

- **GIVEN** the grant store holds no entries
- **WHEN** any path is checked for containment
- **THEN** the outcome SHALL be identical to containment without the grant check

#### Scenario: Granted directory admits its subtree

- **GIVEN** `/a/b` is granted
- **WHEN** a path under `/a/b` is checked
- **THEN** it SHALL be allowed

#### Scenario: A granted subdirectory does NOT admit its repository

- **GIVEN** `/repo/sub` is granted and `/repo` is a git repository whose checkout root is `/repo`
- **WHEN** `/repo/other/secret.txt` is checked, outside every derived anchor
- **THEN** it SHALL be refused — the grant SHALL NOT widen to the checkout root

#### Scenario: A granted directory does not admit its parent

- **GIVEN** `/a/b` is granted
- **WHEN** `/a/sibling` is checked
- **THEN** it SHALL be refused

#### Scenario: Retargeting the granted directory does not move the grant

- **GIVEN** `/a/b` was granted and its stored subject is `/a/b`
- **WHEN** `/a/b` is replaced by a symlink to `/etc` and a read of `/a/b/passwd` is checked
- **THEN** it SHALL be refused — the check SHALL NOT re-resolve the stored subject

#### Scenario: An empty grant set costs nothing

- **GIVEN** no grant is in effect
- **WHEN** a containment check misses every pre-existing layer
- **THEN** the grant layer SHALL perform no filesystem syscall before refusing

#### Scenario: A symlink escaping a granted directory is refused

- **GIVEN** `/a/b` is granted and contains a symlink whose real target is `/elsewhere/secret`
- **WHEN** a read resolves through that symlink
- **THEN** it SHALL be refused — the grant check SHALL compare real paths, not lexical ones

#### Scenario: A symlink within a granted directory is allowed

- **GIVEN** `/a/b` is granted and contains a symlink whose real target is also under `/a/b`
- **WHEN** a read resolves through that symlink
- **THEN** it SHALL be allowed

#### Scenario: The existing containment predicate is unchanged

- **WHEN** the grant feature is present but the store is empty
- **THEN** every pre-existing file-read-containment behaviour SHALL be unchanged, including the bound-checkout-root widening of derived anchors

#### Scenario: A grant never admits a credential or state file
- **GIVEN** an operator grant covers `~/.pi/agent` (or `$HOME`)
- **WHEN** `~/.pi/agent/auth.json` or `~/.pi/dashboard/local/token` is checked
- **THEN** it SHALL be refused, because the credential-and-state refusal runs before the grant layer

#### Scenario: A grant read of a swapped-in credential file is refused after open
- **GIVEN** a grant admits a directory
- **WHEN** a path inside it is replaced by a link to `~/.pi/agent/auth.json` after the check and read through a grant-admitted site
- **THEN** the read SHALL be refused because the opened handle matches the credential file
