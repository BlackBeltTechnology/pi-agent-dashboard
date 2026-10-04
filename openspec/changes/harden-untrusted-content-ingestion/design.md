# Design — Harden Untrusted Content Ingestion

## Context

The audit findings B11/B12/B13/B26 share one shape: a value the agent ingested
(a path, URL, archive entry, spreadsheet) reaches a privileged sink with no
validation. Every sink already uses argv + `shell:false`, so this change adds no
shell-quoting work. It adds **input validation at each sink**.

Existing code this design relies on (all claims cited):

- **document-converter**
  - `packages/document-converter/src/engine.ts:103-113` — `collectMountDirs`
    walks every top-level request field except `command`. Any string (or array
    element) starting with `/` adds `dirname(p)` to the mount set. Nested
    objects (`ocr`, `set`, `nano_banana`) are not walked.
  - `engine.ts:92-101` — `buildArgv` emits `-v m:m` (read-write) for every mount.
  - `engine.ts:49-60` — `EngineConfig` has a single `mounts` list.
  - `packages/document-converter/src/index.ts:43-47` — `engineCfg()` merges
    `config.stagingDir` + `config.mounts` into that one list.
  - `runEngine` is internal: `index.ts` does not re-export it.
  - **Engine write locations** (`packages/document-converter/engine/engine_cli.py`):
    - `renderDocx` with `nano_banana.enabled` writes `<input>.styled.md` **next
      to the input**, and defaults `cacheDir` to `<input dir>/.mermaid-cache`
      (`engine_cli.py:146-170, 233-241`).
    - `extractForEdit` writes `document_meta.xml` next to `output`
      (`engine_cli.py:270-275`).
    - `fillFrontmatter`/`profileTables` edit `paths` in place when `apply`
      (`engine_cli.py:292-323`).
    - `document_converter` helpers write sidecars next to the document they are
      handed (`document_converter/image_extractor.py:86`,
      `variable_manager.py:32`, `manifest_manager.py:18`).
    - `convertToMarkdown` (docling) returns markdown on stdout, and the TS side
      writes the output (`index.ts:66-75`).
  - `packages/server/src/lib/office-preview.ts:147-151` — the only in-repo facade
    caller. It passes `stagingDir: pdfCacheDir()` and
    `mounts: [dirname(docxPath)]`, where `docxPath` has passed `gateOfficeFile`.
    That gate contains only the session cwd (`file-routes.ts:300`), so the docx
    lies under the session cwd. That cwd may itself be under a denylisted dir,
    e.g. a session working in `~/.pi/agent`.
- **kb sources**
  - `packages/kb/src/sources.ts:43` — `classifyRef` sends `http://`, `https://`
    and `ssh://` refs to the `https` resolver.
  - `sources.ts:175-201` — `httpsResolver`:
    - calls global `fetch(url)` with no scheme/host check, no status check, no
      size cap and no timeout;
    - writes the archive **inside** `dest`, then extracts with `unzip -o` (zip)
      or `tar xzf` (everything else — a latent bug: `.tar.bz2` is extracted with
      the gzip flag);
    - names non-archive files with `url.split("/").pop()` (unsanitised).
  - `sources.ts:148-171` — `gitResolver` runs `git clone`/`fetch`/`pull` on
    `gitUrlOf(spec)` with no scheme/host restriction. `git:file:///…` is passed
    through as-is (`sources.ts:128-134`).
  - `sources.ts:81-87` — `ensureTrusted` (TOFU) runs before every remote fetch.
    The SSRF guard runs **after** it: trust says "user approved this source"; the
    guard says "even an approved source cannot reach an internal address".
- **Spreadsheet parsing**
  - `office-preview.ts:46` — `sheetSizeCap` = 50 MB already exists. The route
    returns **413** before reading, via `gateOfficeFile`
    (`packages/server/src/routes/file-routes.ts:310`, `:1196-1203`). Test:
    `packages/server/src/__tests__/file-raw-render-endpoints.test.ts:977`.
  - `office-preview.ts:350-372` — `parseSheet` calls `XLSX.read` in-process.
    `packages/server/package.json:101` pins `"xlsx": "^0.18.5"`.
- **Client previews**
  - The repo is pnpm-only (`pnpm-lock.yaml`; no `package-lock.json`), so
    `npm audit` fails `ENOLOCK`.
  - `packages/client/src/components/preview/SpreadsheetPreview.tsx:55-63` — any
    `success:false` body (including 413) renders the generic `FallbackPreview`.
    The client never inspects `res.status`.
  - `packages/client/src/components/editor-pane/TooLargePreview.tsx:24-42` —
    size-aware notice + "Open raw". Its limit text comes from `MAX_PREVIEW_BYTES`
    (10 MB, `packages/shared/src/file-kind.ts:87`). When `size` is absent it
    renders `editor.tooLargeToPreview` ("File too large to preview (limit X
    MB)").

## Goals / Non-goals

**Goals**
- No request-supplied path can mount a host dir outside the allowed roots or into
  a sensitive dir. Inputs mount read-only wherever the engine provably does not
  write next to them.
- No KB https fetch or git network operation reaches loopback / private /
  link-local / metadata addresses, including via IPv6 literal forms, redirects,
  or DNS rebinding (where the transport allows pinning).
- Archive extraction cannot write outside its destination (no `..`, no absolute
  paths, no link entries).
- The xlsx parse path no longer runs the CVE-affected SheetJS build.
- An oversized office preview says it is too large, shows the real office limit,
  and offers raw-open.

**Non-goals**
- The npm resolver (it reads an already-installed package; no network).
- Changing `classifyRef`. `ssh://` refs still classify as `https` and are now
  refused there; ssh git sources use `git@host:` or `git:ssh://…`.
- Sandboxing the pi-doc-engine container itself (seccomp, user namespaces).
- Changing any size cap value, or the 413 wire body (`file-read-containment`
  pins it to `{ success, error }`).
- Neutralising a user-configured HTTP proxy for git (see D3 trade-offs).

## Decisions

### D1 — Document-converter: confined roots + sensitive denylist + per-command `:ro` (B11)

**Config shape** (all fields optional; internal `EngineConfig` only):

- `EngineConfig` = `{ writable?: string[]; mounts?: string[]; workspaceRoot?: string; … }`
  - `writable` — always mounted rw. The facade puts `stagingDir` here.
  - `mounts` — caller-configured extra roots (ro, unless a write key resolves
    into them).
  - `workspaceRoot` — defaults to `process.cwd()`.
- `DocumentConverterConfig` gains an optional `workspaceRoot`.
- `roots = writable ∪ mounts ∪ {workspaceRoot}`.

**Roots are materialised first.** Writable roots are created (`mkdir -p`; the
facade creates `stagingDir` on demand anyway). Then every root is realpath'd,
using the nearest-existing-ancestor rule for a configured mount that does not
exist yet.

**Path check** — `planMounts(cfg, req) → Map<targetDir, { source: string; mode: "ro"|"rw" }>`, per **absolute**
path string. Relative strings stay unmounted, as today (`engine.ts:106`): the
engine has no host cwd, so relative paths never resolved to host files.

1. **Real path.** `realpath` the nearest existing ancestor (outputs may not exist
   yet), then re-append the remainder.
2. **Mount dir.**
   - Mount the path itself if it is an existing directory.
   - If the path contains glob characters (`*?[`), mount its deepest glob-free
     ancestor.
   - Otherwise mount the realpath'd parent.
   - The bind is `-v <real dir>:<lexical dir>`. The **source** is the resolved
     real directory, so confinement checks what is actually exposed. The
     **target** keeps the lexical path, because the engine receives the request
     paths unchanged. So an in-root symlinked input still resolves inside the
     container. Duplicate detection keys on the target.
3. **Confinement.** Reject with `DocConverterError` `PATH_NOT_ALLOWED` (a new
   code) unless **both** the real path **and** its mount dir are equal to or
   under some realpath'd root. This stops `dirname(<root>)` (the parent of a
   root) from being mounted.
4. **Denylist.**
   - Entries: `/etc`, `/root`, `/var/run`, `/proc`, `/sys`, `/dev`, `~/.ssh`,
     `~/.aws`, `~/.gnupg`, `~/.config`, `~/.pi`, `~/.docker`, `~/.kube`. `~`
     means `os.homedir()` at call time.
   - Each entry is compared both lexically and as its realpath (when it
     exists). This covers `/var/run` → `/run` and a symlinked `~/.pi`.
   - Reject when the mount dir is under a denylisted dir `D` — **unless a root
     that contains the mount dir is itself at or under `D`**. A caller that
     explicitly configured a root inside `D` has opted into that subtree. A root
     that does not contain the path never grants this exception. Examples:
     - `office-preview` for a session whose cwd is `~/.pi/agent` passes
       `dirname(docxPath)` under `~/.pi` → allowed.
     - cwd is `/root/app` → allowed.
     - `workspaceRoot = ~` and a request path under `~/.ssh` → rejected.
     - `workspaceRoot = ~` + mount `~/.pi/x`, path `~/.pi/agent/auth.json` →
       rejected (the only containing root is `~`).
   - `/` is checked by **exact match** only: a root equal to `/` is rejected, so
     confinement can't be turned off.
5. **Mode.** Write keys mount `rw`; other paths mount `ro` when the command is
   in the verified-read-only set, otherwise `rw`. When a dir is needed both
   ways, `rw` wins (Docker rejects a duplicate mount point).

   | command | write keys (rw) | other paths |
   |---|---|---|
   | `convertToMarkdown` | — | **ro** |
   | `renderPdf` | `output` | **ro** after verification task (falls back to rw if the integration run shows a write) |
   | `renderDocx` | `output`, `cacheDir` | rw (writes `<input>.styled.md` + default cache next to input) |
   | `extractForEdit` | `output` | rw (sidecar helpers write next to the document) |
   | `mergeBack` | `output` | rw |
   | `fillFrontmatter`/`profileTables` | `paths` (when `apply`) | ro when `apply === false`, else rw |

   An unknown command defaults to `rw` within confinement. Confinement and the
   denylist are the **primary control** for B11; `:ro` is a least-privilege
   layer.

`buildArgv` emits `-v d:d:ro` or `-v d:d`.

**Residual risk (accepted):** a swap between the realpath check and
`docker run` (a symlink race) needs write access inside a root. The requester
already runs with the host user's filesystem rights, so the race grants nothing
new. The control that matters is the hostile **request value**.

- **Rejected:** denylist-only (doesn't meet "workspace-confined").
- **Rejected:** blanket `:ro` on inputs (breaks `renderDocx`+nano and the sidecar
  writers).
- **Compatibility:** `office-preview` is unaffected. Skill users who convert
  files outside `cwd` must pass `mounts:[dir]`; the README and both SKILL.md
  examples are updated. These test fixtures put inputs/outputs outside the
  roots. They must **move their paths into a per-test `mkdtemp` root** passed as
  `workspaceRoot`. Paths such as `/in.md` (mount dir `/`) can never be admitted:
  - `src/__tests__/engine.test.ts`
  - `src/__tests__/facade.test.ts:62-75, 93-114` (`/in.md` → mount dir `/`)
  - `src/__tests__/integration.test.ts:66-92` (`work` is the parent of
    `stagingDir`)
- **Rollback:** revert the package; no persisted state.

### D2 — KB https SSRF guard (B12)

New module `packages/kb/src/net-guard.ts` (zero deps — kb stays
self-contained):

- **One canonical address classifier, `isNonPublicAddress(ip)`.** The name is
  deliberately different from server `webhook-url.ts`'s `isBlockedAddress`,
  which applies a different policy. It is built on Node's built-in
  `net.BlockList` (the precedent is `packages/server/src/push/push-transports/webhook-url.ts:32-50`;
  no deps):
  - It strips brackets and normalises with `new URL`/`net.isIP`, so
    `[::ffff:7f00:1]` and `::ffff:127.0.0.1` are the same value.
  - It extracts the embedded IPv4 from these forms, and the result is checked
    against the IPv4 list:
    - IPv4-mapped `::ffff:0:0/96` (low 32 bits)
    - IPv4-translated `::ffff:0:0:0/96` (low 32 bits)
    - IPv4-compatible `::/96` (low 32 bits)
    - NAT64 well-known prefix `64:ff9b::/96` (low 32 bits). The
      local-use `64:ff9b:1::/48` (RFC 8215) is **blocked whole**: its RFC 6052
      /48 layout splits the IPv4 around the `u` octet, so low-32-bit extraction
      would be wrong, and the prefix is never public-internet.
    - 6to4 `2002::/16` (bits 16–47)
    - Teredo `2001::/32`: both the server IPv4 (bits 32–63) and the client
      IPv4 (low 32 bits XOR `0xffffffff`)
  - Blocked IPv4: `0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`,
    `172.16/12`, `192.0.0/24`, `192.0.2/24`, `192.88.99/24`, `192.168/16`,
    `198.18/15`, `198.51.100/24`, `203.0.113/24`, `224/4`, `240/4`.
  - Blocked IPv6: `::/128`, `::1/128`, `100::/64`, `2001:2::/48`,
    `2001:10::/28`, `2001:20::/28`, `2001:db8::/32`, `fc00::/7`, `fe80::/10`,
    `fec0::/10`, `ff00::/8`.
  - A shared test-vector table pins each range, plus every embedded form.
- **IP-literal hosts** are checked by the same classifier **before** the request.
  Node does not call `lookup` for IP literals (verified by reviewer on Node 24),
  so this pre-check is the only control for them.
- **`guardedLookup(hostname, options, cb)`:**
  - forwards `options` to `dns.lookup`;
  - is typed as Node's `LookupFunction`; the array-callback overload needs a
    documented cast;
  - when `options.all` is true (Node's default with `autoSelectFamily`), it
    checks **every** returned address and calls back with the array;
  - otherwise it checks the single address and calls back `(err, address, family)`;
  - any blocked address → `cb(err)`.
  - Passed as the `lookup` option of `node:https.request`, so the check is on the
    address the socket uses (no TOCTOU / rebinding).
- **`guardedFetch(url, {maxBytes = 50 MB, timeoutMs = 60 s, maxRedirects = 3})`:**
  - `https:` only;
  - sends `Accept-Encoding: identity`. If the server still answers with
    `gzip`/`deflate`/`br`, the body is decompressed with built-in `zlib`
    streams, and the **byte cap applies to the decompressed output**
    (bomb-safe). For `deflate`, the first two bytes are sniffed: a valid zlib
    header (CMF/FLG, `(CMF*256+FLG) % 31 == 0`) means `createInflate`,
    otherwise `createInflateRaw`. Nothing is retried, so nothing is buffered.
    The compressed byte count is capped as well. Any other encoding → fail;
  - requires a 2xx status (today a 404 body is written as the source);
  - 3xx is followed manually:
    - the 3xx response is destroyed immediately after its headers are read
      (its body is never read, so it can't consume the budget). An `error`
      listener is attached first, so the destroy can't raise an unhandled
      event;
    - a relative `Location` is resolved against the current URL;
    - each hop goes back through the scheme check, literal check and
      `guardedLookup`;
  - one **cumulative** byte budget and one timeout cover the whole redirect
    chain;
  - the body is streamed to memory under the cap. Going over the cap or the
    timeout aborts and throws before anything is written to disk.
- `httpsResolver` uses `guardedFetch` for both archive and plain paths.
  `classifyRef` is unchanged, so `http://`/`ssh://` refs reach the https
  resolver and fail with `only https:// sources are allowed`.
- **Rejected:** a pre-resolve check before global `fetch` (two resolutions →
  rebinding window). Also rejected: an `undici` Agent (`undici` exists only in
  `packages/server/package.json:98`, not in kb).

### D3 — KB git resolver guard (B12, scope extended per Q3)

Before any git network command (`clone`, `fetch`, `pull`):

0. **Effective URL.** Every check below applies to `gitUrlOf(spec)`
   (`sources.ts:128-134`) — the URL git actually receives. The raw ref is not
   checked, so the supported bare form `git:github.com/org/repo` → `https://…`
   keeps working. A `ref`/`pin` that starts with `-` is rejected: it is passed
   positionally to `fetch`/`checkout` (`sources.ts:158-162`) and could inject
   options.
1. **Scheme allowlist.** Allow `https://`, `ssh://` (via `git:ssh://…` or
   `kind: git`), and scp-style `git@host:path`. Reject `file:`, `git://`,
   `http://`, `ext::`, and anything else, without running git.
2. **Refresh target.** Before `fetch`/`pull` on an existing clone, read
   `git -C <clone> remote get-url origin`. If it differs from the effective URL,
   the cache dir is discarded and re-cloned through the guarded path, so a
   poisoned or stale `origin` is never contacted.
3. **Host check.** Resolve the host with `dns.lookup({all:true})` and run every
   address through kb's `isNonPublicAddress` (D2), never the server's
   permissive `isBlockedAddress`. IP-literal hosts are checked directly.
4. **Hardening flags**, as global options **before the subcommand** (`git -c k=v
   … clone …`; after the subcommand, `git clone -c` only writes the new repo's
   config):
   - `protocol.allow=never`, `protocol.https.allow=always`,
     `protocol.ssh.allow=always`
   - `http.followRedirects=false`
   - `submodule.recurse=false` and `fetch.recurseSubmodules=false`, plus
     `--no-recurse-submodules` on `fetch`/`pull`. `.gitmodules` URLs are
     attacker-controlled and never host-checked. `clone` without
     `--recurse-submodules` does not recurse.
   - https only: `http.curloptResolve=<host>:<port>:<ip>`, where `<port>` is the
     URL port (default 443) and an IPv6 `<ip>` is bracketed. This pins curl to
     the address that was checked.

**Trust boundary.** The attacker-controlled value is the source **ref** (it can
come from a cloned repo's KB config, behind TOFU). The user's own git config and
environment are trusted: `url.*.insteadOf`, `core.sshCommand`/`GIT_SSH*`,
credential helpers, proxy. A user `insteadOf` to an internal mirror is a
deliberate choice, and the guard must not break it. So the guard validates the
effective URL (`gitUrlOf`) and does not scrub user config, except `submodule.recurse`,
whose URLs come from the attacker's repo.

**Trade-offs (documented, accepted):**
- **No redirects.** `followRedirects=false` breaks clones of renamed repos that
  rely on a redirect. The error tells the user to update the ref. Allowing
  redirects would let the first hop leave the pinned host.
- **ssh is not pinned.** ssh offers no pinning, so there is a residual
  resolve→connect window.
- **Proxy.** A user-configured `http.proxy`/`https_proxy` routes around the pin;
  the proxy decides reachability.
- **`curloptResolve` availability.** It is documented for git ≥ 2.37 (local git
  is 2.50.1). Feature-detect `git version`; on older git, run with the resolve
  check only and log that the pin is unavailable.

### D4 — Traversal-safe archive extraction (B13)

1. **Stage, then swap.** Create `stage = mkdtemp(join(cacheDir, ".stage-"))`.
   - The download goes to `stage/archive.<ext>`.
   - Extraction goes to `stage/out/`.
   - The `.fetched` staleness marker (today `join(dest, ".fetched")`,
     `sources.ts:174`) is written into `stage/out` **before** the swap, so it
     moves with the content.
   - **Recovery, at the start of every resolve:**
     - if `dest` is absent and `dest.old` exists → `rename(dest.old, dest)`;
     - otherwise any leftover `dest.old` → `rm -rf`.
   - Only after every check passes, swap with rollback:
     1. `rename(dest, dest.old)`, if `dest` exists;
     2. `rename(stage/out, dest)`. If this fails, `rename(dest.old, dest)` and
        throw;
     3. `rm(dest.old)`.
   - `stage` sits in `cacheDir`, the same filesystem as `dest` (no `EXDEV`).
     Every rename is atomic. Crash recovery (above) covers both a crash between
     steps 1 and 2 (`dest` missing) and one between steps 2 and 3 (stale
     `dest.old`).
   - `stage` is always removed.
   - A failed or blocked refresh therefore **keeps the previously good cache**.
     Today `sources.ts:185-186` wipes `dest` before fetching.
   - Plain (non-archive) files use the same stage → swap.
2. **List first, validate everything, fail closed.** Names and types come from
   two listings, matched by line index:
   - zip:
     - names from `unzip -Z1 <archive>`;
     - entry count from the `unzip -Z` header line
       `Zip file size: … number of entries: N`;
     - types from the first character of the N lines that follow the two header
       lines (`Archive:`, `Zip file size:`). The trailing `1 file` / `N files`
       summary is ignored;
     - the name-line count must equal N;
     - **empty zip:** when the header says `number of entries: 0`, the archive is
       accepted as empty without consulting `-Z1`. That listing prints
       `Empty zipfile.` and exits 1.
   - tar:
     - names from `tar -tf <archive>`;
     - types from the first character of each `tar -tvf <archive>` line. bsdtar
       renders a **hardlink** as `-…<name> link to <target>` (first char `-`),
       so any verbose line containing ` link to ` or ` ==> ` is also rejected
       (fail-closed: a regular file whose name contains ` link to ` is
       rejected too);
     - compression is auto-detected by GNU tar and bsdtar, which fixes the
       `.tar.bz2` bug.
   - Name and type line counts must match.
   - Names are never parsed out of the verbose line, so ` -> ` and spaces in
     names are harmless.
   - Reject the **whole archive** when any entry:
     - is absolute (leading `/`, or a drive letter);
     - has a `..` segment;
     - has a type other than a regular file (`-`) or a directory (`d`) —
       symlink `l`, hardlink (`h` on GNU tar; `-` + ` link to ` on bsdtar 3.5),
       device, fifo.
   - **Control characters.** Listings run under a fixed locale (`LC_ALL=C`).
     - Tar names are **decoded** (`\NNN` octal, `\t`, `\n`, `\\`) before
       validation. A decoded byte in `0x00–0x1F` or `0x7F` → reject. UTF-8 names,
       which C-locale tar prints as octal escapes, decode back to valid
       non-control bytes and are accepted.
     - Info-ZIP renders control characters as `^X`. A `^` followed by
       `@`–`_` in a `-Z1` name → reject (fail-closed for a literal `^A`).
       Info-ZIP renders DEL and non-ASCII as `?`, so DEL inside a zip is not
       detectable. That is accepted: DEL can't split a listing line or form a
       path separator.
     - `..`/absolute checks run on the decoded names.
     - The rendering on bsdtar, GNU tar and Info-ZIP is pinned by fixture tests,
       which CI runs on Linux (GNU tar) and dev runs on macOS (bsdtar).
   - Reject when any line fails to parse, when the counts mismatch, or when a
     listing tool exits non-zero.
   - Tar escapes newlines (`\n`), so an injected newline stays on one line and
     is caught after decoding. If some implementation printed it raw, the extra
     line would itself be validated, and it can't change the real entry's
     leading type character.
3. **Extract into the fresh, empty `stage/out`:**
   - zip: `unzip -o -q <archive> -d stage/out`. Keep `-o`: the dir is fresh,
     and it stops a duplicate entry from triggering a `replace?` prompt on a
     closed stdin.
   - tar: `tar -xf <archive> -C stage/out --no-same-owner`.
4. **Post-extraction walk (backstop, not a guarantee).** `lstat` every entry. A
   symlink, or a `realpath` that escapes `stage/out`, means: discard `stage`,
   leave `dest` untouched, throw.
   This cannot undo a write that already happened outside `dest`. The **listing
   gate (2) is the control**; GNU tar/bsdtar's built-in `..` refusal and
   Info-ZIP's `../` stripping are the second layer.
5. **Plain-file name.** `basename(new URL(url).pathname)`, falling back to
   `index.md` when the result is empty, `.` or `..`.

The `-tv` type markers on bsdtar (macOS) vs GNU tar (Linux CI) are pinned by
fixture tests on both.

### D5 — xlsx: replace with the SheetJS CDN build (B26, per Q2)

- **Change:** in `packages/server/package.json`, replace `"xlsx": "^0.18.5"` with
  `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"`. That is
  SheetJS's official distribution; npm stopped receiving releases after 0.18.5.
- **CVEs fixed:** CVE-2023-30533 (prototype pollution, fixed in 0.19.3) and
  CVE-2024-22363 (ReDoS, fixed in 0.20.2).
- **API:** the `XLSX.read` / `utils.sheet_to_json` calls at
  `office-preview.ts:356-372` are unchanged.
- **Install impact:** `pnpm install` fetches from `cdn.sheetjs.com`, and
  `pnpm-lock.yaml` records the tarball integrity. Three other paths also fetch
  from that host:
  - The Electron bundle installs external deps itself
    (`ci-electron-on-demand-build` "Bundle-server install mode"), so it fetches
    from the CDN too.
  - npm consumers of the published server package fetch the URL dep at install
    time. Air-gapped or mirror-only installs need `cdn.sheetjs.com` allowlisted
    (release note).
  - `ci-electron.yml` is `workflow_dispatch`-only, so verification is an explicit
    dispatch (test-plan E74).
- **Cap:** keep `sheetSizeCap` (50 MB) at the route gate. Size does not mitigate
  ReDoS; the upgrade does. The ADDED "refused before parse" scenario is already
  met by the gate. This change adds no cap.
- **Rollback:** restore `^0.18.5` and the lockfile.

### D6 — Office-cap-aware too-large notice (per Q4)

**Where a 413 actually reaches the user.**
- **Editor pane:** `CappedViewer` already swaps in `TooLargePreview` above
  `MAX_PREVIEW_BYTES` = 10 MB (`CappedViewer.tsx:69-70`). Every office cap is
  larger, so in the pane a 413 happens only when the size probe fails:
  `CappedViewer.tsx:52` then sets the size to 0 and mounts the viewer anyway.
- **Ungated surface:** the overlay route — `FilePreviewOverlay.tsx:48-50` (the
  chat file-link modal) and `PreviewOverlayView` via the shared `PreviewBody`
  dispatcher in `PreviewCard.tsx:137-141` (no longer an in-chat card surface).
  It mounts the office previews directly, so files between 10 MB and the office
  cap reach the server, and a 413 is visible there.

**No wire change.** `file-read-containment` pins gate-site bodies to
`{ success, error }`. So:

- **Shared constant.** Move the three size caps into
  `packages/shared/src/file-kind.ts` as
  `OFFICE_SIZE_CAPS = { docx, pptx, sheet }`. Server `OFFICE_CAPS` reads its
  defaults from it, so the values are unchanged.
- **Override coupling.** `deps.officeCaps` (`file-routes.ts:274`) is a
  test-only injection seam; production always uses `OFFICE_CAPS`. A unit test
  asserts that `OFFICE_CAPS` size fields equal `OFFICE_SIZE_CAPS`.
- **`TooLargePreview`** gains an optional `cap?: number`, defaulting to
  `MAX_PREVIEW_BYTES`, so current callers are unchanged.
- **Previews:** on `res.status === 413`, each renders
  `<TooLargePreview cwd path cap={OFFICE_SIZE_CAPS.<kind>} />` before the
  generic `success:false` branch. `size` is omitted, so the existing
  `editor.tooLargeToPreview` string shows the office limit, plus "Open raw".
  - `SpreadsheetPreview` and `DocxPreview` check this on mount.
  - `PptxPreview` (user-initiated render, states `idle|loading|pdf|failed`,
    `PptxPreview.tsx:23`) gains a `tooLarge` state that is entered when the
    render request returns 413.
- **Accessibility:** no new strings or i18n keys; the component already has an
  icon + text + a link with visible text.
- **Spec:** `file-and-url-preview` "DOCX and spreadsheet renderers mount in
  shared shells" says *any* `{success:false}` → `FallbackPreview`. It is
  MODIFIED to carve out 413. The `file-and-url-preview` "PPTX renders on demand
  via a rendering engine" requirement says conversion failure → `FallbackPreview`.
  It is also MODIFIED, to name the 413 → `TooLargePreview` path explicitly.

### D7 — Dependency audit triage record

`pnpm audit --prod` runs after D5. (npm audit cannot run here: there is no
`package-lock.json`.) Each remaining advisory gets a decision (fix / accept with
reason / not reachable) in a `## Audit triage` section appended to this
`design.md` during implementation. It is archived with the change, so no new
`docs/` file is needed.

The URL-tarball `xlsx` is not covered by registry advisory data. Its version is
asserted by a test instead (spec: "patched parser in use").

## Risks

| Risk | Mitigation |
|---|---|
| D1 breaks a skill user converting a file outside cwd | `PATH_NOT_ALLOWED` message names the path + configured roots; README/SKILL examples show `mounts`. |
| D1 `:ro` table wrong for a command → engine write fails | Only `convertToMarkdown` (+ `renderPdf` after verification) is ro; integration task exercises each ro command. |
| D2 compressed responses | Bounded zlib decompression; cap on decompressed bytes. |
| D2 blocks a source behind a private mirror | By design; documented. No allowlist knob (YAGNI). |
| D3 renamed-repo redirect fails | Clear error; user updates ref. |
| D4 listing format differs across tar implementations | Fixture tests on macOS + Linux; unparseable listing → fail closed. |
| D5 CDN unreachable during install | Lockfile integrity pin; CI + electron build verified; one-line rollback. |

## Migration / compatibility / rollback

- No persisted data or schema changes. No wire-format changes.
- `DocumentConverterConfig.workspaceRoot` is optional (default `cwd`).
- KB:
  - `http://`/`ssh://` refs in the https resolver now fail. They were already
    non-functional for `ssh://`; `http://` must move to `https://`.
  - Non-2xx responses now fail instead of caching the error body.
- Each decision reverts independently:
  - D1 — the document-converter package;
  - D2–D4 — the kb package;
  - D5 — one dependency line + the lockfile;
  - D6 — a shared constant + 4 client files.
