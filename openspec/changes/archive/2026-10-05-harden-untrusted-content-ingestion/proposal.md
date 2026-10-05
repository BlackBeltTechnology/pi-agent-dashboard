# Harden Untrusted Content Ingestion

## Why

The auxiliary tools are shell-injection-free by construction (argv + `shell:false`
everywhere), but the audit found that untrusted inputs an agent ingested — file
paths, source URLs, archives, spreadsheets — reach dangerous sinks without
validation.

- **B11 — Writable host bind-mounts from agent paths (`document-converter/src/engine.ts`).**
  `runEngine` walks every string field of the request; any value starting with
  `/` gets `dirname(p)` mounted `-v dir:dir` **read-write**. A hostile conversion
  request (`{output:"/root/.ssh/authorized_keys"}`) bind-mounts sensitive host
  dirs into the engine container to read or overwrite them.
- **B12 — SSRF on agent-supplied source URL (`kb/src/sources.ts`).**
  `fetch(spec.ref)` has no scheme/host validation; a source pointed at
  `http://169.254.169.254/…` or an internal host performs SSRF from the host.
  The `git` resolver has the same gap: `git clone` runs on any URL, including
  `file://` and internal hosts.
- **B13 — Archive zip-slip (`kb/src/sources.ts`).** `unzip -o` / `tar xzf` on a
  fetched archive; entries with `../` or absolute paths write outside the
  destination, overwriting host files.
- **B26 — Vulnerable spreadsheet parser (`xlsx`/SheetJS, via office preview).**
  The dependency audit flags `xlsx` high (prototype pollution + ReDoS, no npm fix
  available); it parses untrusted `.xlsx` files reached through the preview path.
  A 50 MB `sheetSizeCap` (413) already exists, but size does not stop ReDoS.
- **Opaque oversize UX.** When an office preview hits a size cap (413), the
  client shows the generic "We can't preview this file" fallback, which does not
  give the size or the limit.

## What Changes

- **Confine document-converter mounts (design D1).**
  - Every request path must lie under a configured root: writable `stagingDir`,
    `mounts`, or the new optional `workspaceRoot` (default `cwd`).
    Comparison uses real paths.
  - Sensitive dirs (`/etc`, `/root`, `~/.ssh`, `~/.pi` …) are rejected with
    `PATH_NOT_ALLOWED`, unless the caller configured a root inside them.
    A root of `/` is refused.
  - Write keys mount read-write. Inputs mount `:ro` for commands verified not
    to write beside them.
- **SSRF-guard KB remote sources (D2, D3).**
  - https: `https:` only. Every address is checked at connect time, including
    IPv6-embedded IPv4 forms, so DNS rebinding is closed. Each redirect hop is
    re-validated. Response size and time are capped (the size cap applies after
    bounded decompression). Only 2xx is accepted.
  - git: only https/ssh/`git@` URLs (checked on the URL git receives; refresh refuses when the clone's configured `origin` differs; `-`-prefixed refs rejected). The user's own
    git config (`insteadOf`, proxy, credentials) is trusted. git gets
    transport-allowlist, no-redirect and no-submodule-recursion `-c` options
    before the subcommand, plus a curl resolve pin for https.
- **Make KB archive extraction traversal-safe (D4).**
  - The archive is listed and validated first. Absolute, `..` and link entries
    reject the whole archive.
  - The download is stored outside `dest`.
  - A post-extraction backstop walk checks nothing escaped.
  - Fixes the `.tar.bz2` extract flag and sanitises plain-file names.
- **Replace the vulnerable spreadsheet parser (D5, D7).**
  - Move `xlsx` from npm `0.18.5` to the official SheetJS CDN build `0.20.3`.
  - Keep the existing 50 MB size gate.
  - Record a `pnpm audit --prod` triage decision for every remaining advisory.
- **Office-cap-aware oversize preview (UI, D6).**
  - Office size caps move to a shared constant.
  - On 413, `SpreadsheetPreview`/`DocxPreview`/`PptxPreview` render the
    existing `TooLargePreview` with that cap and an open-raw link, instead of
    the generic fallback.
  - The 413 wire body does not change.

## Impact

- **Closes:** B11 host bind-mount read/overwrite, B12 KB SSRF (https + git),
  B13 zip-slip, B26 xlsx exposure.
- **Affected specs:**
  - new capability `untrusted-content-ingestion`;
  - MODIFIED `kb-source-resolution` (https resolution) and
    `file-and-url-preview` (413 carve-out from the generic fallback).
- **Compatibility:**
  - document-converter callers converting files outside `cwd` must pass
    `mounts:[dir]` (README/SKILL examples updated).
  - KB `http://`/`ssh://` refs in the https resolver now fail.
  - Non-2xx responses no longer cache the error body.
  - git sources that rely on redirects (renamed repos) fail with a clear error.
  - `pnpm install` fetches `xlsx` from `cdn.sheetjs.com`.
  - No wire-format change.
- **Risk:**
  - Confinement must still allow conversions the user actually referenced.
  - The SSRF guard must not block legitimate public sources.
  - Both are covered by real-usage checks.
- **Rollback:** each item reverts independently; no persisted state.
- **Affected code:**
  - `packages/document-converter/src/{engine,index,errors}.ts` + README/SKILL.md
  - `packages/kb/src/sources.ts` + new `packages/kb/src/net-guard.ts`
  - `packages/server/package.json` + `pnpm-lock.yaml` (xlsx)
  - `packages/server/src/lib/office-preview.ts` + `packages/shared/src/file-kind.ts` (caps)
  - `packages/client/src/components/{preview/SpreadsheetPreview,preview/DocxPreview,preview/PptxPreview,editor-pane/TooLargePreview}.tsx`
- Design: see `design.md` (D1–D7).

## Discipline Skills

- `security-hardening` — SSRF prevention (connect-time address check, rebinding, git pinning),
  path traversal, container mount least-privilege, vulnerable-dependency triage.
- `doubt-driven-review` — confirm legitimate conversions and public KB sources
  still work after confinement/allowlisting.
- `review-code` — inline review of the full diff once tests pass.
- `scenario-design` — metadata target (cloud IP) vs public host, zip-slip entry
  vs normal archive, sensitive mount path vs workspace path.
