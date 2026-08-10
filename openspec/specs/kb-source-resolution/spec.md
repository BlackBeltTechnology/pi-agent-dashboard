# kb-source-resolution Specification

## Purpose

Resolve each configured knowledge-base source spec into a local directory the indexer can read. Source kinds are `filesystem`, `npm`, `git`, and `https`; local kinds resolve directly, remote kinds fetch into a cache under trust-on-first-use (TOFU) gating with revision pinning and staleness-based refresh.

## Requirements

### Requirement: Source-kind classification and resolution

The resolver SHALL determine each source's kind from an explicit `kind` field or, when absent, by classifying its `ref`, and SHALL resolve the source to an absolute local directory (optionally narrowed by a `subdir`).

#### Scenario: Explicit kind honored

- **WHEN** a source spec sets `kind` to `filesystem`, `npm`, `git`, or `https`
- **THEN** the matching resolver is used

#### Scenario: Kind inferred from ref prefix

- **WHEN** a source has no explicit `kind`
- **THEN** a `ref` starting with `npm:` classifies as `npm`, `git:` or `git@` as `git`, an `https://`/`http://`/`ssh://` URL as `https`, and anything else as `filesystem`

#### Scenario: Subdir narrows the indexed directory

- **WHEN** a resolved source spec has a `subdir`
- **THEN** the returned directory is the resolved base joined with that subdir

#### Scenario: Resolving all configured sources

- **WHEN** the KB resolves its configured source list
- **THEN** each source is resolved to a `ResolvedSource` carrying its id, absolute directory, priority, and dedup identity

### Requirement: Filesystem source resolution

The filesystem resolver SHALL resolve a source's `ref` to an absolute local directory without any trust prompt or network access.

#### Scenario: Absolute path used directly

- **WHEN** a filesystem source `ref` is an absolute path
- **THEN** it is used as-is as the base directory

#### Scenario: Relative path resolved against cwd

- **WHEN** a filesystem source `ref` is a relative path
- **THEN** it is resolved against the resolve context's current working directory

### Requirement: npm source resolution

The npm resolver SHALL locate an already-installed npm package on disk by its bare name and index its directory, and SHALL NOT install the package itself.

#### Scenario: Package located in a known install location

- **WHEN** an npm source is resolved
- **THEN** the resolver searches the global pi npm modules, the project `.pi/npm` modules, and the project `node_modules`, and returns the first existing package directory

#### Scenario: Package not installed

- **WHEN** the npm package is not found in any candidate location
- **THEN** resolution fails with an error listing the searched locations and instructing to install it first

#### Scenario: Bare name extracted from ref

- **WHEN** the npm `ref` includes a version suffix (e.g. `npm:@scope/pkg@1.2.3`)
- **THEN** the package is located by its bare name (`@scope/pkg`), ignoring the version

### Requirement: git source resolution with revision pinning

The git resolver SHALL clone the repository into a cache directory, check out the requested revision, and report the resolved commit, without ever passing user-controlled refs through a shell.

#### Scenario: First-time clone

- **WHEN** the cache has no existing clone for the source
- **THEN** the resolver performs a shallow clone of the derived git URL into the cache, using the pinned ref as the clone branch when one is specified

#### Scenario: Revision pinning

- **WHEN** the source specifies a `pin`, or the `ref` carries a trailing branch/tag suffix
- **THEN** that revision is used as the checkout target

#### Scenario: Refresh of an existing clone

- **WHEN** an existing clone is present and refresh is requested or the source is configured `refresh: on-index`
- **THEN** the resolver fetches and checks out the pinned ref, or fast-forward pulls when no ref is pinned

#### Scenario: Resolved commit reported

- **WHEN** a git source finishes resolving
- **THEN** the returned source includes the short HEAD commit as its revision

#### Scenario: Refs never shell-interpolated

- **WHEN** git commands run with a URL, ref, or pin
- **THEN** they are invoked with an argument vector and no shell, so hostile refs cannot inject commands

### Requirement: https source resolution and archive extraction

The https resolver SHALL fetch a remote URL into a cache directory, extracting recognized archives and writing plain files directly, and SHALL record a fetch marker for staleness tracking.

#### Scenario: Archive fetched and extracted

- **WHEN** the URL ends in `.tar.gz`, `.tgz`, `.tar.bz2`, or `.zip`
- **THEN** the archive is downloaded into the cache and extracted (unzip for `.zip`, tar otherwise)

#### Scenario: Plain file fetched

- **WHEN** the URL is not an archive
- **THEN** its text is fetched and written into the cache under the URL's filename (or `index.md` when none)

#### Scenario: Staleness-based re-fetch

- **WHEN** a fetch marker exists and the source has a TTL that has elapsed, or refresh is requested, or the source is `refresh: on-index`
- **THEN** the cache is cleared and the content is re-fetched; otherwise a fresh cache is reused without re-fetching

### Requirement: Trust-on-first-use gating for remote sources

The resolver SHALL require trust confirmation before any npm, git, or https fetch, SHALL persist granted trust keyed by a canonical hash of the source spec, and SHALL reject untrusted sources when confirmation is unavailable. Filesystem sources SHALL skip trust entirely.

#### Scenario: Trusted source proceeds

- **WHEN** a remote source's canonical hash is already recorded as trusted
- **THEN** resolution proceeds without prompting

#### Scenario: First-use confirmation grants and records trust

- **WHEN** a remote source is not yet trusted and the trust prompt returns approval
- **THEN** the fetch proceeds and the source's hash is recorded as trusted so future resolutions skip the prompt

#### Scenario: Untrusted source rejected

- **WHEN** a remote source is not trusted and no prompt is available or the prompt is declined
- **THEN** resolution fails with an error that the remote source is not trusted

#### Scenario: Editing a spec re-prompts

- **WHEN** a source spec's kind, ref, subdir, or pin changes
- **THEN** its trust hash changes, so a previously trusted variant no longer counts as trusted

#### Scenario: Filesystem sources bypass trust

- **WHEN** a filesystem source is resolved
- **THEN** no trust check or prompt occurs
