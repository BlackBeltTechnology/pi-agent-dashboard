# untrusted-content-ingestion Specification

## Purpose
Keep untrusted inputs an agent ingests — file paths, source URLs, archives, spreadsheets — from reaching dangerous sinks unvalidated. Covers document-converter bind-mount confinement, SSRF guards for KB https and git sources (connect-time address checks, redirects, rebinding, origin integrity), traversal-safe KB archive extraction with an atomic cache swap, and the patched spreadsheet parser. Established by change harden-untrusted-content-ingestion.

## Requirements

### Requirement: Document-converter mounts are workspace-confined and least-privilege
The document-converter SHALL confine every bind-mount derived from an absolute
request path to the configured roots (writable staging dirs, configured mounts,
and a workspace root defaulting to the process cwd), comparing real paths of both
the request path and the directory actually mounted, and mounting the resolved
directory. It SHALL reject with `PATH_NOT_ALLOWED` any request whose path or
mount directory resolves outside every root, or into a sensitive directory (`/etc`, `/root`, `/var/run`, `/proc`, `/sys`, `/dev`,
`~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config`, `~/.pi`, `~/.docker`, `~/.kube`)
unless a root containing that mount directory itself lies inside the sensitive
directory. A root equal
to `/` SHALL be rejected. Write targets (`output`, `cacheDir`, and `paths` when
applying) SHALL mount read-write. Other paths SHALL mount read-only for commands
verified not to write beside their inputs. A directory needed both read-only and
read-write SHALL be mounted once, read-write.

#### Scenario: sensitive output path rejected
- **WHEN** a conversion request contains `{ "output": "/root/.ssh/authorized_keys" }` and no configured root lies under `/root`
- **THEN** the converter SHALL reject the request with `PATH_NOT_ALLOWED` and SHALL NOT start the engine

#### Scenario: path outside every root rejected
- **WHEN** a request `input` resolves outside the workspace root, staging dir, and configured mounts
- **THEN** the converter SHALL reject the request with `PATH_NOT_ALLOWED`

#### Scenario: symlink escape rejected
- **WHEN** a request path lies under the workspace root lexically but its real path resolves outside every root
- **THEN** the converter SHALL reject the request with `PATH_NOT_ALLOWED`

#### Scenario: explicitly configured sensitive-area root honored
- **WHEN** a caller configures a mount inside `~/.pi` and a request path lies under that mount
- **THEN** the request SHALL be accepted

#### Scenario: parent of a root never mounted
- **WHEN** a request path equals the workspace root itself
- **THEN** the mounted directory SHALL be the workspace root, not its parent

#### Scenario: unrelated root grants no sensitive-area exception
- **WHEN** roots are `~` and a mount under `~/.pi/x`, and a request path is `~/.pi/agent/auth.json`
- **THEN** the request SHALL be rejected with `PATH_NOT_ALLOWED`

#### Scenario: filesystem root refused as a root
- **WHEN** the workspace root or a configured mount resolves to `/`
- **THEN** every request SHALL be rejected with `PATH_NOT_ALLOWED`

#### Scenario: read-only command input mounted read-only
- **WHEN** a `convertToMarkdown` request references an input under the workspace root
- **THEN** the input's directory SHALL be mounted with `:ro`

#### Scenario: shared input/output directory mounted once read-write
- **WHEN** a request's `output` lies in the same directory as its `input`
- **THEN** that directory SHALL appear exactly once in the mount list, read-write

#### Scenario: legitimate conversion succeeds
- **WHEN** input and output paths are within the configured roots
- **THEN** the conversion SHALL run as before

### Requirement: KB https sources are SSRF-guarded
KB https source fetches SHALL accept only `https:` URLs. They SHALL reject any
target whose address (literal or every DNS-resolved address, checked at connect
time) is loopback, private, link-local, CGNAT, multicast, reserved, or an IPv6
form embedding such an IPv4 address (IPv4-mapped, IPv4-compatible, NAT64, 6to4,
Teredo). They SHALL re-validate every redirect hop, cap redirects, response bytes
and time (cumulatively across redirects, with the byte cap applied after any
content decoding), and require a 2xx status. A blocked or failed fetch SHALL leave
the previously cached content unchanged.

#### Scenario: cloud-metadata source blocked
- **WHEN** a KB source `ref` is `https://169.254.169.254/latest/meta-data/`
- **THEN** the fetch SHALL be refused without connecting

#### Scenario: non-https source refused
- **WHEN** a KB source `ref` is `http://example.com/doc.md`
- **THEN** the fetch SHALL be refused

#### Scenario: private-host source blocked
- **WHEN** a KB source host resolves to `10.0.0.5`
- **THEN** the fetch SHALL be refused

#### Scenario: IPv6-embedded loopback literal blocked
- **WHEN** a KB source `ref` host is `[::ffff:7f00:1]` or `[::ffff:127.0.0.1]`
- **THEN** the fetch SHALL be refused without connecting

#### Scenario: redirect to private host blocked
- **WHEN** a public `https://` source responds with a redirect to a loopback or private address
- **THEN** the fetch SHALL be refused without connecting to the redirect target

#### Scenario: oversized response aborted
- **WHEN** a remote source body exceeds the byte cap
- **THEN** the fetch SHALL abort and fail without writing a partial source

#### Scenario: compression bomb aborted
- **WHEN** a gzip-encoded response decompresses beyond the byte cap
- **THEN** the fetch SHALL abort and fail

#### Scenario: failed refresh keeps the previous cache
- **WHEN** a previously cached https source is refreshed and the refresh is blocked or fails
- **THEN** the previously cached content SHALL remain in place

#### Scenario: public https source allowed
- **WHEN** a KB source `ref` is a public `https://` URL returning 200
- **THEN** the fetch SHALL proceed (subject to the existing trust gate)

### Requirement: KB git sources are SSRF-guarded
Before any git network command, the KB git resolver SHALL accept only `https://`,
`ssh://`, and scp-style `git@host:path` effective URLs (the URL derived from the
source ref and passed to git), SHALL reject a source whose host is or resolves to
a non-public address, SHALL reject a ref or pin beginning with `-`, and, before
refreshing an existing clone, SHALL refuse — without contacting that origin and
without modifying the cache entry — unless the clone's configured `origin`
has exactly one URL and it equals the effective URL, naming the entry and how
to recover (the comparison reads all raw `remote.origin.url` values, because
fetch uses the first URL of a multi-URL remote; a user's `url.*.insteadOf`
rewrite is not a mismatch). It SHALL pass, as global
options before the subcommand, a transport allowlist of https and ssh, disabled
HTTP redirects, disabled submodule recursion, and (for https, when supported by
the installed git) a curl resolve pin to the checked address. The user's own git
configuration and environment are trusted and not rewritten beyond these options.

#### Scenario: file-transport git source blocked
- **WHEN** a KB source `ref` is `git:file:///etc`
- **THEN** the resolver SHALL refuse it without running a git network command

#### Scenario: private-host git source blocked
- **WHEN** a git source host resolves to `127.0.0.1` or `10.0.0.5`
- **THEN** the resolver SHALL refuse it without running a git network command

#### Scenario: hardening options precede the subcommand
- **WHEN** the resolver runs `git clone` for an allowed source
- **THEN** the argv SHALL carry `-c protocol.allow=never`, `-c protocol.https.allow=always`, `-c protocol.ssh.allow=always`, and `-c http.followRedirects=false`, `-c submodule.recurse=false`, and `-c fetch.recurseSubmodules=false` before `clone`

#### Scenario: option-like pin rejected
- **WHEN** a git source `pin` is `--upload-pack=touch /tmp/x`
- **THEN** the resolver SHALL refuse it without running git

#### Scenario: public git source allowed
- **WHEN** a git source is a public `https://` repository
- **THEN** clone SHALL proceed (subject to the existing trust gate)

### Requirement: KB archive extraction is traversal-safe
KB archive extraction SHALL list the archive before extracting and SHALL reject
the whole archive when any entry is absolute, contains a `..` segment, or is
anything other than a regular file or directory (including symlinks and
hardlinks), whose name contains a control character, or when the listing cannot
be parsed. The archive SHALL be downloaded and extracted into a staging directory
outside the destination and moved into place only after every check passes.
After extraction, a symlink or an entry whose real path escapes the staging
output SHALL discard the staging directory and fail resolution, leaving the
destination unchanged.

#### Scenario: zip-slip entry rejected
- **WHEN** a fetched archive contains an entry `../../etc/cron.d/evil`
- **THEN** extraction SHALL reject the archive and write nothing outside the destination

#### Scenario: absolute entry rejected
- **WHEN** a fetched archive contains an entry `/tmp/evil`
- **THEN** extraction SHALL reject the archive

#### Scenario: link entry rejected
- **WHEN** a fetched archive contains a symlink or hardlink entry
- **THEN** extraction SHALL reject the archive and leave nothing in the destination

#### Scenario: normal archive extracts
- **WHEN** a fetched archive contains only in-tree relative regular files and directories
- **THEN** extraction SHALL succeed into the destination

#### Scenario: entry name with arrow and spaces handled
- **WHEN** an archive contains a regular file named `a -> b.md` and one named `with space.md`
- **THEN** both SHALL be classified as regular files and extracted

#### Scenario: non-ASCII names accepted
- **WHEN** an archive contains regular files named `café.md` and `文.md`
- **THEN** both SHALL be extracted

#### Scenario: empty zip accepted
- **WHEN** a fetched `.zip` has zero entries
- **THEN** resolution SHALL succeed with an empty source

#### Scenario: bzip2 tarball extracts
- **WHEN** a fetched source is a valid `.tar.bz2`
- **THEN** extraction SHALL succeed

### Requirement: Spreadsheet parsing uses a patched parser behind the size gate
Over-cap spreadsheet files SHALL be refused by the existing size gate before any
SheetJS parse runs. Spreadsheet parsing SHALL NOT use an `xlsx`/SheetJS
build affected by the prototype-pollution (CVE-2023-30533) or ReDoS
(CVE-2024-22363) advisories. Every production dependency advisory remaining after
the upgrade SHALL carry a recorded triage decision.

#### Scenario: oversized spreadsheet rejected before parse
- **WHEN** an `.xlsx` file exceeds `sheetSizeCap`
- **THEN** the sheet endpoint SHALL respond 413 and the SheetJS parse SHALL NOT run

#### Scenario: patched parser in use
- **WHEN** the server's resolved `xlsx` dependency is inspected
- **THEN** its version SHALL be 0.20.2 or later

#### Scenario: audit advisories triaged
- **WHEN** `pnpm audit --prod` runs after the upgrade
- **THEN** every reported advisory SHALL have a recorded triage decision in the change's design

### Requirement: Oversized office previews show an office-cap notice
When an office preview request (`.xlsx`/`.csv` sheet, `.docx` render, `.pptx`
render) is refused with HTTP 413, the client preview SHALL render the too-large
notice stating that preview's office size cap, with an open-raw affordance,
instead of the generic cannot-preview fallback. The office size caps SHALL be
defined once in shared code; the server's production caps SHALL equal them. The
413 wire body SHALL be unchanged.

#### Scenario: oversized spreadsheet in the overlay
- **WHEN** a user opens, through the file-link overlay, an `.xlsx` larger than the sheet cap
- **THEN** the preview SHALL show the too-large notice with the sheet cap in MB and an open-raw link

#### Scenario: oversized deck render
- **WHEN** a user activates "Render slides" on a `.pptx` larger than the pptx cap
- **THEN** the preview SHALL show the too-large notice with the pptx cap

#### Scenario: other failures unchanged
- **WHEN** a preview fails for a non-size reason (corrupt file, engine unavailable)
- **THEN** the existing fallback preview SHALL render as before
