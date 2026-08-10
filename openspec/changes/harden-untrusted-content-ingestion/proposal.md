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
- **B13 — Archive zip-slip (`kb/src/sources.ts`).** `unzip -o` / `tar xzf` on a
  fetched archive; entries with `../` or absolute paths write outside the
  destination, overwriting host files.
- **B26 — Vulnerable spreadsheet parser (`xlsx`/SheetJS, via office preview).**
  `npm audit` flags `xlsx` high (prototype pollution + ReDoS, no npm fix
  available); it parses untrusted `.xlsx` files reached through the preview path.

## What Changes

- **Confine document-converter mounts.** Mount input paths **read-only** (`:ro`),
  confine all mounts under a configured workspace root, and reject paths that
  resolve outside it (and sensitive roots like `/etc`, `/root`, `~/.ssh`).
- **SSRF-guard KB source fetches.** Restrict to `https:`, resolve the host and
  reject loopback / private (RFC1918) / link-local targets, and cap redirects.
- **Make KB archive extraction traversal-safe.** Reject entries containing `..`
  or absolute paths (or extract with a traversal-safe library); do not blindly
  overwrite.
- **Bound + isolate spreadsheet parsing.** Cap input size before parsing, and
  either sandbox the SheetJS parse or pin/replace the vulnerable build; triage the
  remaining `npm audit` advisories with a documented decision per finding.

## Impact

- **Closes:** B11 host bind-mount read/overwrite, B12 KB SSRF, B13 zip-slip,
  B26 xlsx exposure.
- **Risk:** the workspace-root confinement for document-converter must still allow
  legitimate conversions of files the user actually referenced; the KB SSRF
  allowlist must not block legitimate public sources. Both need real-usage checks.
- **Affected specs:** new capability `untrusted-content-ingestion`.
- **Affected code:** `packages/document-converter/src/engine.ts`,
  `packages/kb/src/sources.ts`, the office-preview / `xlsx` parse path
  (`packages/server/src/lib/office-preview.ts`).

## Discipline Skills

- `security-hardening` — SSRF prevention (DNS-resolve-then-check, TOCTOU note),
  path traversal, container mount least-privilege, vulnerable-dependency triage.
- `doubt-driven-review` — confirm legitimate conversions and public KB sources
  still work after confinement/allowlisting.
- `scenario-design` — metadata target (cloud IP) vs public host, zip-slip entry
  vs normal archive, sensitive mount path vs workspace path.
