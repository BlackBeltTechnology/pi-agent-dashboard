## Context

The invoicebot plugin mounts four `/api/plugins/invoicebot/*` routes on the host
Fastify instance, each a JSON `POST` forwarding `{ selector, ...args }` to an
`InvoiceEngine` port method keyed by `cwd` (the per-request workspace key). One
exception already exists: `GET /blob` streams raw bytes and documents itself as
"breaks the POST-envelope convention deliberately" for byte I/O the browser
needs. The port has two bindings — `RealInvoiceEngine` (thin pass-through to the
engine facade over a `file:` link) and `FakeInvoiceEngine` (fixtures for CI /
worktrees where the engine dependency is absent). The ship gate runs against the
Fake.

This change adds the write-side byte door: a multipart upload route and the port
method it forwards to.

## Goals / Non-Goals

**Goals:**
- A `POST /upload` endpoint that accepts `multipart/form-data`, streams each file
  part to a `Buffer`, and forwards the raw bytes to a new `ingest` port method.
- Return the engine's per-file outcome verbatim so the client can render each
  file's result (`landed` / `skipped` / `rejected` + reason).
- Enforce boundary-level size/count limits so a large upload cannot exhaust
  memory before the engine validates.
- Keep the Fake binding faithful enough that the whole gate passes with no real
  engine present.

**Non-Goals:**
- File type validation, content-hash dedup, and the actual drop are the engine's
  job — the route forwards bytes only.
- No flow dispatch (unlike the flow-triggering `review`/`rules` ops).
- No changes to the four existing routes or their port methods.
- The client UI that calls this endpoint is out of scope here.

## Decisions

### D1 — `ingest` is a first-class port method, not a selector
Binary file content does not fit the `{ selector, ...args }` JSON envelope the
four selector methods share. Adding `ingest(cwd, files)` as a fifth method on
`InvoiceEngine` (rather than smuggling base64 through a selector) keeps the
binary path honest and mirrors how `/blob` sits outside the envelope on the read
side. **Alternative rejected:** base64-in-JSON through an existing selector —
inflates payloads ~33%, hides the binary nature, and couples upload to the
envelope's flow-dispatch machinery it does not need.

Signature:
```ts
ingest(cwd: string, files: { filename: string; bytes: Buffer }[]): Promise<{
  results: { filename: string; hash: string;
             status: "landed" | "skipped" | "rejected"; reason?: string }[];
  landed: number; skipped: number; rejected: number;
}>
```

### D2 — Multipart via `@fastify/multipart`, streamed to Buffers
Register `@fastify/multipart` (not currently a dependency). Read the `cwd` field
and collect each file part into a `Buffer` as `{ filename, bytes }[]`, then one
call to `engine.ingest(cwd, files)`.

### D3 — Boundary limits: 20 MB per file, 20 files per request
Configure `@fastify/multipart` `limits: { fileSize: 20 MB, files: 20 }`. The
20 MB per-file cap is the shared number the engine also enforces — a file the
boundary accepts must be one the engine will not reject on size alone. Invoice
scans are typically <3 MB; a heavy multi-page color scan is ~5–15 MB, so 20 MB is
comfortable headroom without inviting memory abuse.

### D4 — Oversize part → reject that file, land the rest (per-file, not whole-batch)
`@fastify/multipart` flags a part that exceeds `fileSize` (`part.file.truncated`
/ throws on the part stream). Rather than failing the whole request, catch it
per-part and record that file as one `results[]` entry
`{ status: "rejected", reason: "too large" }`, letting the other files proceed.
This preserves the per-file contract (D5) and matches the all-rejected handling
(D6). **Alternative rejected:** whole-batch 400 on any oversize part — simpler
but discards partial success and forces the client to re-select every file.

### D5 — Partial success is the contract; response mirrors the engine return
The call succeeds as long as it was a well-formed request; individual files carry
their own status in `results[]`, with aggregate `landed`/`skipped`/`rejected`
counts for a summary/toast. Field names are stable (`results[].filename`,
`results[].status`, `results[].reason`, and the three counts).

### D6 — HTTP status: 200 even when every file is rejected
A fully-rejected batch returns `200 { results: [...all rejected], landed: 0, ... }`,
not 400. `400` is reserved for **bad input** (missing/blank `cwd`, no file parts)
— consistent with the four existing routes, which 400 only on malformed requests,
never on well-formed requests whose contents are merely unusable. This gives the
client one render path for full / partial / no success.

### D7 — Auth inherits the existing global hook, unchanged (traced)
The dashboard's auth is an `onRequest` hook (`packages/server/src/auth-plugin.ts`)
that authenticates on transport metadata only — `request.ip`, `request.headers`,
`request.url`, and the JWT cookie / bearer token. Fastify runs `onRequest`
**before body parsing**, so it never touches the multipart stream. The upload
route is therefore gated identically to the four JSON routes with no special
handling. **No new auth code.**

### D8 — Fake binding simulates ingest deterministically
`FakeInvoiceEngine.ingest` must let the ship gate pass with no real engine:
- sniff magic bytes — `%PDF-` → PDF, `\x89PNG\r\n\x1a\n` → PNG → `landed`;
  anything else → `rejected` (`unsupported type`);
- oversize (bytes over the cap) → `rejected` (`too large`);
- hash the bytes (same `sha256(bytes).slice(0,16)` scheme) and track seen hashes
  within the instance → a repeat → `skipped` (`duplicate`);
- return the aggregate counts. `cwd` accepted and ignored (isolation is a Real
  concern), matching the other Fake methods.

### D9 — No flow dispatch
Unlike `review`/`rules`, `ingest` returns no `flow`. The route does not call the
flow-dispatch seam; it returns the ingest result directly. The engine's own
`file` trigger drains the drop folder.

## Risks / Trade-offs

- **[Memory spike from concurrent large uploads]** → per-file 20 MB × 20 files
  bounds a single request; each part is streamed then released. Buffering (not
  disk-spooling) is acceptable at these bounds.
- **[Fake drifts from the real engine's ingest contract]** → keep the Fake's
  status/reason vocabulary pinned to the port types; the same class of risk the
  existing Fake methods already carry, mitigated by shared `IngestOutcome` types.
- **[Client sends a huge non-file field or thousands of tiny parts]** →
  `@fastify/multipart` `files` limit (20) caps part count; the `cwd` field guard
  rejects malformed metadata early.
- **[Oversize detection races the stream]** → rely on the library's per-part
  truncation flag / stream error rather than pre-measuring; treat a truncated
  part as `rejected` and never forward partial bytes to the engine.

## Migration Plan

Purely additive — a new route, a new port method, a new dependency. No existing
route, port method, or response shape changes. Rollback is removing the route +
method + dependency. No data migration.

## Open Questions

None — size cap (20 MB), file count (20), all-rejected status (200), oversize
semantics (per-file reject), and auth (inherited, traced) are all resolved above.
