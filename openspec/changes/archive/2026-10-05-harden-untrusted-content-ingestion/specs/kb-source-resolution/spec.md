## MODIFIED Requirements

### Requirement: https source resolution and archive extraction

The https resolver SHALL fetch a remote `https:` URL into a cache directory through the SSRF-guarded fetch (see `untrusted-content-ingestion`), extracting recognized archives traversal-safely and writing plain files directly, and SHALL record a fetch marker for staleness tracking. A non-`https:` URL (including `http://` and `ssh://` refs classified as `https`), a non-2xx response, or a guard refusal SHALL fail resolution without writing a fetch marker and SHALL leave any previously cached content in place.

#### Scenario: Archive fetched and extracted

- **WHEN** the URL ends in `.tar.gz`, `.tgz`, `.tar.bz2`, or `.zip`
- **THEN** the archive is downloaded into a staging directory outside the destination, its entry listing is validated, it is extracted (unzip for `.zip`, tar with compression auto-detection otherwise), and the result replaces the destination only after every check passes

#### Scenario: Plain file fetched

- **WHEN** the URL is not an archive
- **THEN** its body is fetched and written into the cache under the basename of the URL path (or `index.md` when that basename is empty, `.`, or `..`)

#### Scenario: Non-https ref refused

- **WHEN** a source classified as `https` has an `http://` or `ssh://` ref
- **THEN** resolution fails with an https-only error and nothing is fetched

#### Scenario: Non-2xx response refused

- **WHEN** the remote responds with a non-2xx status after redirects
- **THEN** resolution fails and the response body is not written to the cache

#### Scenario: Staleness-based re-fetch

- **WHEN** a fetch marker exists and the source has a TTL that has elapsed, or refresh is requested, or the source is `refresh: on-index`
- **THEN** the cache is cleared and the content is re-fetched; otherwise a fresh cache is reused without re-fetching
