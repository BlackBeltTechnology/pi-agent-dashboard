# Spec Delta

## MODIFIED Requirements

### Requirement: Source-kind classification and resolution

The resolver SHALL determine each source's kind from an explicit `kind` field or, when absent, by classifying its `ref`, and SHALL resolve the source to an absolute local directory (optionally narrowed by a `subdir`). Classification SHALL route a GitHub repository reference to `git` and a direct file or archive URL to `https`.

#### Scenario: Explicit kind honored

- **WHEN** a source spec sets `kind` to `filesystem`, `npm`, `git`, or `https`
- **THEN** the matching resolver is used, even when the `ref` would classify differently

#### Scenario: Kind inferred from ref prefix

- **WHEN** a source has no explicit `kind` and its ref is not a GitHub repository reference
- **THEN** a `ref` starting with `npm:` classifies as `npm`, `git:` or `git@` as `git`, an `ssh://` URL as `git`, an `https://`/`http://` URL as `https`, and anything else as `filesystem`

#### Scenario: GitHub repository URL classifies as git

- **WHEN** a source has no explicit `kind` and its ref is `https://github.com/<owner>/<repo>`, `https://github.com/<owner>/<repo>.git`, `https://github.com/<owner>/<repo>@<ref>`, `https://github.com/<owner>/<repo>/tree/<ref>`, or `github.com/<owner>/<repo>`
- **THEN** it classifies as `git` and resolves by cloning `https://github.com/<owner>/<repo>`

#### Scenario: GitHub file and archive URLs stay https

- **WHEN** a source has no explicit `kind` and its ref is a `raw.githubusercontent.com` URL, a `github.com/<owner>/<repo>/blob/...` URL, or a `github.com/<owner>/<repo>/archive/...` archive URL
- **THEN** a raw or archive URL classifies as `https` and is fetched as a file or archive
- **AND** a `/blob/` URL SHALL fail resolution with an error naming the equivalent raw URL, because its body is an HTML page

#### Scenario: Non-repository GitHub paths are not cloned

- **WHEN** a source has no explicit `kind` and its ref is a `github.com/<owner>/<repo>` URL whose path continues with a non-repository segment (`/issues`, `/pull`, `/wiki`, `/actions`, `/settings`, `/releases`)
- **THEN** it SHALL NOT classify as `git`; it classifies as `https` and is rejected by the indexable-content check rather than cloned from an unclonable URL

#### Scenario: Subdir narrows the indexed directory

- **WHEN** a resolved source spec has a `subdir`
- **THEN** the returned directory is the resolved base joined with that subdir

#### Scenario: Resolving all configured sources

- **WHEN** the KB resolves its configured source list
- **THEN** each source is resolved to a `ResolvedSource` carrying its id, absolute directory, priority, and dedup identity

### Requirement: git source resolution with revision pinning

The git resolver SHALL clone the repository into a cache directory, check out the requested revision, and report the resolved commit, without ever passing user-controlled refs through a shell.

#### Scenario: First-time clone

- **WHEN** the cache has no existing clone for the source
- **THEN** the resolver performs a shallow clone of the derived git URL into the cache, using the pinned ref as the clone branch when one is specified

#### Scenario: Revision pinning

- **WHEN** the source specifies a `pin`, or the `ref` carries a trailing branch/tag suffix (`@<ref>` or a GitHub `/tree/<ref>` segment)
- **THEN** that revision is used as the checkout target, with an explicit `pin` taking precedence

#### Scenario: GitHub tree URL selects the revision only

- **WHEN** the ref is `https://github.com/<owner>/<repo>/tree/<ref>`
- **THEN** the segment after `tree/` is the checkout revision and the clone URL is `https://github.com/<owner>/<repo>`
- **AND** a path deeper than `/tree/<ref>` SHALL require an explicit `subdir`, and a revision whose name contains `/` SHALL be supplied via `pin`

#### Scenario: ssh URL clones over ssh

- **WHEN** the ref is `ssh://git@<host>/<owner>/<repo>`
- **THEN** the resolver clones that URL over ssh under the same host and argv hardening as `git@host:path` refs

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

The https resolver SHALL fetch a remote `https:` URL into a cache directory through the SSRF-guarded fetch (see `untrusted-content-ingestion`), extracting recognized archives traversal-safely and writing plain files directly, and SHALL record a fetch marker for staleness tracking. A non-`https:` URL (including an `http://` ref, or an `ssh://` ref given an explicit `kind: "https"`), a non-2xx response, or a guard refusal SHALL fail resolution without writing a fetch marker and SHALL leave any previously cached content in place.

#### Scenario: Archive fetched and extracted

- **WHEN** the URL ends in `.tar.gz`, `.tgz`, `.tar.bz2`, or `.zip`
- **THEN** the archive is downloaded into a staging directory outside the destination, its entry listing is validated, it is extracted (unzip for `.zip`, tar with compression auto-detection otherwise), and the result replaces the destination only after every check passes

#### Scenario: Plain file fetched

- **WHEN** the URL is not an archive and the body passes the indexable-content check
- **THEN** its body is fetched and written into the cache under the basename of the URL path (or `index.md` when that basename is empty, `.`, or `..`)

#### Scenario: Non-https ref refused

- **WHEN** a source resolved as `https` has an `http://` ref, or an `ssh://` ref with explicit `kind: "https"`
- **THEN** resolution fails with an https-only error and nothing is fetched

#### Scenario: Non-2xx response refused

- **WHEN** the remote responds with a non-2xx status after redirects
- **THEN** resolution fails and the response body is not written to the cache

#### Scenario: Staleness-based re-fetch

- **WHEN** a fetch marker exists and the source has a TTL that has elapsed, or refresh is requested, or the source is `refresh: on-index`
- **THEN** the cache is cleared and the content is re-fetched; otherwise a fresh cache is reused without re-fetching

## ADDED Requirements

### Requirement: An https plain fetch that yields nothing indexable fails resolution
When an `https` source URL is not a recognized archive, the resolver SHALL fail resolution if the fetched body is an HTML document, or if the saved file name lacks a configured indexable extension. The error SHALL name the URL and suggest `kind: "git"` for a repository page or a raw file URL for a single document. The resolver SHALL NOT write a fetch marker and SHALL leave previously cached content in place.

#### Scenario: Repository page fetched as https
- **WHEN** a source with explicit `kind: "https"` and ref `https://github.com/o/r` returns an HTML page
- **THEN** resolution SHALL fail with an error suggesting `kind: "git"`, and no file named `r` SHALL be cached

#### Scenario: Extensionless plain file
- **WHEN** a non-archive https URL returns a non-HTML body and its path basename has no indexable extension
- **THEN** resolution SHALL fail with an error naming the URL

#### Scenario: Markdown file fetched normally
- **WHEN** a non-archive https URL ends in `.md` and returns markdown text
- **THEN** the file SHALL be cached and indexed as before

#### Scenario: Previous cache survives a refused fetch
- **WHEN** a refresh of a previously cached https source is refused by this rule
- **THEN** the earlier cached content and its fetch marker SHALL remain unchanged
