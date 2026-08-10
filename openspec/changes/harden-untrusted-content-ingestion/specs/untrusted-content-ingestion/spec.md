## ADDED Requirements

### Requirement: Document-converter mounts are read-only and workspace-confined
The document-converter SHALL mount input paths read-only and SHALL confine every
bind-mount under a configured workspace root, rejecting any request-supplied path
that resolves outside that root or into a sensitive system directory. Output
mounts SHALL be limited to the workspace root.

#### Scenario: sensitive path rejected
- **WHEN** a conversion request contains `{ "output": "/root/.ssh/authorized_keys" }`
- **THEN** the converter SHALL reject the request and mount nothing outside the workspace root

#### Scenario: input mounted read-only
- **WHEN** a conversion references a legitimate input file under the workspace root
- **THEN** its directory SHALL be mounted read-only (`:ro`)

#### Scenario: legitimate conversion succeeds
- **WHEN** input and output paths are within the workspace root
- **THEN** the conversion SHALL run as before

### Requirement: KB remote source fetches are SSRF-guarded
KB remote source fetches SHALL restrict the URL scheme to `https`, SHALL resolve
the host and reject targets in loopback, private (RFC1918), or link-local ranges,
and SHALL cap the number of followed redirects. A blocked target SHALL fail the
fetch without connecting.

#### Scenario: cloud-metadata source blocked
- **WHEN** a KB source `ref` is `http://169.254.169.254/latest/meta-data/`
- **THEN** the fetch SHALL be refused (non-https and link-local)

#### Scenario: private-host source blocked
- **WHEN** a KB source `ref` resolves to `10.0.0.5`
- **THEN** the fetch SHALL be refused

#### Scenario: public https source allowed
- **WHEN** a KB source `ref` is a public `https://` URL
- **THEN** the fetch SHALL proceed (subject to the existing trust gate)

### Requirement: KB archive extraction is traversal-safe
KB archive extraction SHALL reject archive entries whose paths contain `..` or are
absolute, so extraction cannot write outside the destination directory. Existing
files outside the destination SHALL NOT be overwritten by extraction.

#### Scenario: zip-slip entry rejected
- **WHEN** a fetched archive contains an entry `../../etc/cron.d/evil`
- **THEN** extraction SHALL reject that entry and write nothing outside the destination

#### Scenario: normal archive extracts
- **WHEN** a fetched archive contains only in-tree relative entries
- **THEN** extraction SHALL succeed into the destination

### Requirement: Spreadsheet parsing is bounded and its vulnerable path isolated
Spreadsheet parsing of untrusted `.xlsx` files SHALL enforce an input-size cap
before parsing and SHALL mitigate the known `xlsx`/SheetJS vulnerability (prototype
pollution + ReDoS) by isolating, pinning, or replacing the vulnerable parse path.
Remaining `npm audit` advisories SHALL each carry a documented triage decision.

#### Scenario: oversized spreadsheet rejected
- **WHEN** an `.xlsx` file exceeds the configured size cap
- **THEN** parsing SHALL be refused before the SheetJS parse runs

#### Scenario: audit advisories triaged
- **WHEN** `npm audit --omit=dev` reports the `xlsx` high advisory
- **THEN** the repository SHALL record a triage decision (isolate/pin/replace) rather than leaving it unaddressed
