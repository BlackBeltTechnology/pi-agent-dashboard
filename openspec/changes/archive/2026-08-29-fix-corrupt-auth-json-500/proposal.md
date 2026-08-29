## Why

An empty or truncated `~/.pi/agent/auth.json` makes `GET /api/provider-auth/status`
return `500 {"message":"Unexpected end of JSON input"}`, and the Settings panel
white-screens on `TypeError: t.filter is not a function`. Reported on
0.8.0 AppImage / Ubuntu 24.04: `readAuthJson()` rethrows every non-`ENOENT`
error (including `SyntaxError`), and `ProviderAuthSection.fetchStatus()` calls
`res.json()` with no `res.ok` check, feeding a Fastify error envelope into
`statuses.filter(...)`. A zero-byte credential file — an interrupted write, a
crashed pi, a first-run `wx` create that lost its content — is unrecoverable
from the UI, because the UI that repairs credentials is the surface that dies.

## What Changes

**Read tolerance and write safety are split.** A read must never fail on bad
*content* and never mutate `auth.json`; a write must never destroy bytes it
could not first copy aside.

### Failure taxonomy (the boundary, stated once)

| Condition | Read path | Write path |
|---|---|---|
| `ENOENT` | `{}`, no backup, no log | proceeds (creates file `0600`) |
| Bytes readable, not a JSON plain object (`""`, truncated, `null`, `[]`, `42`) | `{}`, best-effort quarantine copy, log | quarantine under lock; proceed only if the copy succeeded, else **throw** |
| `readFileSync` itself fails (EACCES, EISDIR, EMFILE, Windows EPERM/EBUSY) | **throws** — an unreadable file is not a corrupt file, and a permission bug must stay loud | throws |

Contract "status MUST NOT 500" is scoped to **content** failures. An
I/O-unreadable `auth.json` still 500s by design; the hardened client renders
that as an inline error instead of a dead panel, so requirement 7 (Settings
stays usable) holds via the UI layer, not by swallowing the I/O fault.

### Server

- **Two functions, one behaviour each.** An internal
  `readAuthJsonChecked(): { data: AuthData; corrupt: boolean; quarantined: boolean }`
  carries the quarantine outcome; the exported `readAuthJson(): AuthData` is the
  tolerant wrapper returning `.data`. Write paths call the checked variant so
  they can distinguish "corrupt, un-backed-up" from "legitimately `{}`" — a
  distinction the tolerant return value cannot express.
- **Quarantine by COPY, never by rename.** Bad bytes are copied to
  `auth.json.corrupt-<stamp>`; `auth.json` is left untouched. A rename would race
  a concurrent pi that atomically replaced the file between our read and our
  rename, moving away a *valid* file. Copying a since-repaired file is harmless;
  moving one is data loss.
- **Backup is created `wx` with mode `0600`.** `wx` so a same-millisecond second
  quarantine (crash-looping pi, two dashboards sharing `$HOME`) cannot overwrite
  an existing backup — on `EEXIST` a `-1`, `-2`, … suffix is appended. `0600`
  because truncated bytes routinely still contain intact credentials; a
  world-readable remnant would be a new leak.
- **Stamp is filename-safe everywhere** — `YYYYMMDDTHHMMSSsssZ`, no colons
  (NTFS rejects `:`; the repo ships Windows QA + an Electron build).
- **Dedup key is a SHA-256 of the bad bytes**, not `(size, mtime)`. Coarse-mtime
  filesystems and same-millisecond replacement collide on size+mtime and would
  skip backing up genuinely different content. A content hash cannot.
  Deduplication is a spray guard only — an in-process set, recorded **only on a
  successful copy**, so a failed copy is retried rather than latched.
  **A dedup hit reports `quarantined: true`** — the flag means "a backup of these
  exact bytes exists on disk", not "this call performed the copy". Otherwise the
  change's own repair flow deadlocks: Settings mounts → read quarantines and
  records the hash → user clicks Add Key → the write re-reads the same corrupt
  bytes (the quarantine was a copy; `auth.json` is unchanged) → dedup skips the
  copy → every write throws forever.
- **Writes refuse to clobber un-backed-up bytes.** Inside `withLock()`,
  `writeCredential()` / `removeCredential()` re-read via the checked variant.
  `corrupt && !quarantined` → throw, persist nothing. `corrupt && quarantined`
  → proceed on `{}`; the old bytes live in the backup.
- **A read-path copy failure is swallowed** (logged, not thrown) — it is
  best-effort by definition, and the write path re-attempts it under the lock
  where it is load-bearing.
- **The quarantine is announced** — one log line with the backup path and the
  reason. Never file contents, never a credential.
- **UTF-8 BOM is stripped before parse**, so a BOM-prefixed but otherwise valid
  file is not misclassified as corrupt.
- **`withLock()`'s placeholder create gains `mode: 0o600`.** It currently writes
  `{}` with no mode (≈0644 after umask) and `writeAuthJson()` then *preserves*
  that permission — violating the existing spec scenario "New file creation →
  mode 0600". This fails **today** on every first write, not only under
  corrupt-recovery; the recovery flow merely makes it routine.
- **`DELETE /api/provider-auth/:provider` gains the `PUT` error shape.** It
  currently has no `try`/`catch`, so a refusal would surface as Fastify's
  default `{message}` envelope while the client reads `{error}`. Both routes
  map a refusal to `{ error: <reason> }` so the operator sees why.

### Client

- **`ProviderAuthSection` fails closed on BOTH status consumers** —
  `fetchStatus()` and the auth-code poll in `startAuthCode()`. A non-`ok`
  response or a non-array body renders an inline error. The poll tolerates
  *transient* failures — it ends the flow only after N consecutive malformed or
  non-`ok` responses, so a single 500 or a mid-login `/api/restart` does not kill
  an in-flight OAuth login that survives today, while a persistent failure stops
  reporting "waiting" until the 5-minute timeout.
- No change to `useProvidersReady()` — it already guards with `res.ok` +
  `Array.isArray`.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `provider-auth-server`: the `readAuthJson()` recovery contract (non-throwing
  content reads, copy-based `0600` `wx` quarantine, write-refusal when
  un-backed-up), the `GET /api/provider-auth/status` 200-array guarantee for
  content failures, the `0600` lock-placeholder fix, and the `DELETE` error shape.
- `provider-auth-ui`: the Settings provider section SHALL degrade to an inline
  error on a failed or malformed status response rather than throwing, on both
  the mount fetch and the OAuth poll.

## Impact

- `packages/server/src/auth/provider-auth-storage.ts` — `readAuthJson()` (+ the
  checked variant), `withLock()`, `writeCredential()`, `removeCredential()`.
- `packages/server/src/routes/provider-auth-routes.ts` — `DELETE` error mapping.
- `packages/client/src/components/settings/ProviderAuthSection.tsx` —
  `fetchStatus()`, `startAuthCode()` poll, and the section's error render path.
- Indirect read consumers inherit tolerance without change:
  `model-proxy/registry-singleton.ts` (`readAugmentedAuth`),
  `model-proxy/internal-auth-storage.ts` (`getAuth` cache), `server.ts:2389`
  (already `try`-wrapped → `undefined`).

### Accepted trade-offs

- **Merge loss.** Once quarantined, the next `writeCredential()` writes a file
  containing only that credential; pre-corruption entries are not merged back
  and are recoverable only from the backup named in the log. The bytes were
  already unreadable — no parse, no merge.
- **Background OAuth refresh is a write path too.** `InternalAuthStorage` may
  serve a *stale-valid* cached credential into the corrupt window
  (`getAuth()` returns `cachedAuth` unconditionally once populated); an expiring
  token then drives `refreshOAuth → writeCredential`, which quarantines and
  reduces the file to that one provider. The bytes survive in the backup, but
  the wipe can originate from a background path with no operator present. The
  earlier claim "stale-empty, never stale-wrong" was wrong and is withdrawn.
  Server-side cache reload comes from `refreshModelRegistry()` inside
  `notifyBridges()` — not from the `credentials_updated` broadcast itself.
- **Shape rejection.** Valid JSON that is not a plain object is treated as
  corrupt. If pi ever adopts a versioned wrapper (`{version, credentials}`),
  the dashboard would quarantine it — but the bytes are copied before any
  clobber, and a pi format change requires a dashboard change regardless.
- **No cross-process dedup.** Two dashboards sharing `$HOME` may each write a
  backup of the same bytes. `wx` + suffix makes that duplicative, never
  destructive.

No API-shape change; no migration; no config.

## Discipline Skills

- `security-hardening` — on-disk credential store: backup mode `0600`, no secret
  in a log line / error body / filename, the `0600` placeholder regression.
- `systematic-debugging` — root cause is evidenced (500 payload + un-minified
  stack); tasks reproduce it red before the fix.
- `review-code` — non-trivial change on a credential path, reviewed before commit.
