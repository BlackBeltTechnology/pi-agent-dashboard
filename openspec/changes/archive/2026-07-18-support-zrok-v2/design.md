# Design — Support zrok v2

## Context

zrok v2 is a hard break from v1: renamed binary, renamed env dir/vars, a new API host, and
a wholesale replacement of "reserved sharing" with "namespaces + reserved names". The
dashboard's `tunnel-providers/zrok.ts` was written entirely against v1 verbs. The hosted
`api-v1.zrok.io` now 500s for v1 clients, so "stay on v1" is not viable for hosted users.

Ground truth used for this design (not guessed):
- Installed `zrok v2.0.4` CLI help output (`share`, `create name`, `create share`, `delete`, `enable`).
- v2 CHANGELOG (#726 reserved-sharing removal; #1124 binary/env/var rename).
- v2 docs `manage-reserved-names.md` (exact `create name` / `share public -n public:<name>` / `delete name` verbs).
- `v2.0.4` release assets: tarball `zrok_2.0.4_<os>_<arch>.tar.gz`, `checksums.sha256.txt`, **binary inside is `zrok2`**.
- Live `zrok status`: `apiEndpoint = https://api-v2.zrok.io`.

## Decision 1 — Dual binary resolution (`zrok2` preferred, `zrok` fallback)

**Why:** Homebrew's formula installs the v2 binary as `zrok`; the official tarball, the
Windows package, and the Linux package all install `zrok2`. A single hard-coded name breaks
one platform or the other.

**How:** `getZrokBinary()` resolves the first of `["zrok2", "zrok"]` found via the existing
`ToolResolver` (login-shell PATH). `detectZrokBinary()` returns true if either exists. The
chosen absolute path is cached and reused for every subsequent invocation (enable, create
name, share, delete). `tunnel-enroll.ts` uses the same resolver rather than the literal
string `"zrok"`.

**Alternatives rejected:** (a) hard-require `zrok2` — breaks Homebrew users; (b) shell alias
— not portable, not present for a GUI-launched server.

## Decision 2 — Reserved/persistent URL via namespaces + names (not tokens)

**v1 flow (removed):** `reserve public <t>` → opaque token → `share reserved <token>` →
`release <token>`. The token was stored in `config.tunnel.reservedToken`.

**v2 flow (adopted; verified live against zrok v2.0.4):**
```
zrok2 create name -n public <name>                    # reserve a name in the public namespace
zrok2 share public --headless -n public:<name> localhost:<port>   # serve it → <name>.shares.zrok.io
zrok2 delete name <name>                              # release (ONLY on explicit user forget — see persistence)
zrok2 list names                                      # enumerate (idempotency / cleanup)
```
- `-n public:<name>` on `share` is `namespace:name`. **Verified:** `create name` lands in
  `public` even when `defaultNamespace` is `<unset>`; we still pass `-n public` explicitly on
  `create name` for robustness against a user-set non-public default.
- **Verified live:** `list names` shows the reserved name's URL as exactly
  `https://<name>.shares.zrok.io`.
- Config stores `tunnel.zrok.reservedName` (string), namespace `public`. No opaque token persisted.

**Name generation:** when the user asks for a persistent tunnel and no name is stored, the
provider generates a DNS-safe name (`pi-dash-<8 hex>`), `create name -n public`s it, persists
it, then serves. On reconnect it reuses the stored name. Idempotency: if `create name` reports
the name already exists **for this account**, proceed to serve; if it fails as taken by
*another* account, surface a warning and fall back to ephemeral (do not silently rotate).

**Persistence model (corrected — a reserved name MUST survive disconnect/restart):** the whole
point of a reserved name is a stable URL across restarts, so the provider MUST NOT `delete name`
on a normal `disconnect`/`deleteTunnel`. Deletion happens ONLY on an explicit user "forget
reserved URL" action (a distinct config clear). Consequently the generic `ChildTunnelRuntime`
teardown is NOT wired to `spec.release` for the reserved path; `release` is invoked only by the
explicit-forget code path, which reads the stored `reservedName` before clearing it.

**Retry must not recycle a reserved name:** the core's failure/timeout retry currently calls
`release(token)` then re-reserves. Under v2 that would delete the reserved name and mint a new
URL — breaking stability. The reserved-name path opts out of release-on-retry: a transient
`share public` failure retries the SAME name; only the ephemeral path may fall back to a fresh URL.

**Ephemeral fallback unchanged:** with no `reservedName`, `share public <target> --headless`
yields a rotating `*.shares.zrok.io` URL — the current landed behaviour.

**`buildArgs` (v2):**
```
reservedName ? ["share","public","--headless","-n",`public:${name}`,`localhost:${port}`]
             : ["share","public","--headless",`localhost:${port}`]
```
Flags precede the positional target consistently across all artifacts (cobra accepts either
order; we fix ONE form so an argv-order test is deterministic). The target shape is
`localhost:<port>` (v2 accepts host:port); the v1
`--override-endpoint http://localhost:<port>` form is dropped.

**Orphan scavenge — `processMarker` must match `zrok2` (bug found in review):** the substring
`"zrok share"` does NOT appear in `"…/zrok2 share public …"`, so a substring marker of
`"zrok share"` silently skips every orphan on the tarball/Windows/Linux (`zrok2`) platforms —
exactly the platforms this change targets. The marker becomes a test matching BOTH `zrok share`
and `zrok2 share` (e.g. `/\bzrok2? share\b/`), and `endpointMarker` stays `localhost:<port>` used
**in conjunction** with the binary+`share` marker (alone `localhost:<port>` is too weak). Verify
with a scavenge test whose ps line uses the real flags-first `zrok2 share public --headless -n public:x localhost:PORT` form.

### Decision 2a — Persistence request trigger + forget path (gaps found in review)

The first draft specified a reserved-name lifecycle with no way to **request** one and no place to
**release** one. Both are now concrete:
- **Request (entry):** add `tunnel.zrok.persistent?: boolean` (default `false`). Connect mints/uses
  a reserved name only when `persistent === true`; otherwise ephemeral. "A persistent tunnel is
  requested" everywhere in the specs means `persistent === true`.
- **Forget (exit):** add `POST /api/tunnel-disconnect` body `{ forget: true }` (single existing
  endpoint, back-compat: no body = plain disconnect that PRESERVES the name). `forget:true` calls
  the provider release (`delete name`), then clears `tunnel.zrok.reservedName` and sets
  `persistent=false`. This is the ONLY caller of `release`. A Gateway UI "Forget reserved URL"
  control invokes it (task 8.2).

### Decision 2c — Generic-core (`tunnel-core.ts`) changes (under-specified in first draft)

The v2 semantics require three changes to the provider-neutral `ChildTunnelRuntime`, not just the
zrok spec:
1. **`processMarker: string | RegExp`.** `scavengeOrphans` uses `trimmed.includes(marker)`; a
   single string cannot be a substring of both `zrok share` and `zrok2 share`. Widen the type and
   switch the matcher to `typeof marker === "string" ? line.includes(marker) : marker.test(line)`.
   zrok sets `/\bzrok2? share\b/`; ngrok keeps its string marker (back-compat).
2. **Reserved names are non-releasable on retry.** The crash-exit retry path (`createInner`, the
   `child.on("exit")` branch) currently calls `spec.release?.(token)` and re-runs with
   `undefined` — for a reserved name that deletes it and drops to ephemeral. Gate BOTH the exit
   and timeout retry paths on `!callerProvidedToken` (the timeout path already is; the exit path
   is not). A reserved name is always caller-provided (Decision 2b), so it is never released or
   regenerated by the core — only re-served.
3. **No auto-mint for ephemeral.** `createInner` calls `spec.reserve(port)` whenever no token is
   passed and `spec.reserve` is defined — under v2 that would mint a reserved name on every
   ephemeral connect. Remove `reserve` from the zrok `ChildProviderSpec`; name-minting moves into
   the zrok provider's `connect` (only when `persistent`), which then passes the name as a
   caller-provided token to `createTunnel`. The core no longer auto-reserves.

### Decision 2b — Plumb `reservedName` end-to-end through connect (gap found in review)

Adding `reservedName` to the schema is inert unless the connect path reads it. Today the connect
chain passes only the legacy token: `cli.ts` sets `tunnelReservedToken = tunnel.reservedToken`;
`server.ts` and `routes/system-routes.ts` call `createTunnel(port, tunnelReservedToken)`;
`TunnelConnectOpts.reservedToken` is what the zrok provider serves. This change:
- Adds `reservedName` to the connect options (`TunnelConnectOpts`) and the server/CLI config
  surface, sourced from `tunnel.zrok.reservedName`.
- The zrok provider's `connect` serves `reservedName` (named share) when present, else ephemeral.
- **Stops feeding the legacy `reservedToken` into the v2 provider.** A v1 token is meaningless
  to a v2 account; passing it as `-n public:<v1token>` would fail rather than fall back. Under
  v2 the provider ignores `reservedToken` entirely (it is preserved on disk only for downgrade).
- Affected files (were missing from the first draft): `packages/server/src/cli.ts`,
  `packages/server/src/server.ts`, `packages/server/src/routes/system-routes.ts`,
  `packages/shared/src/tunnel-provider.ts` (`TunnelConnectOpts`), and `config-api.ts`
  (redact/preserve `reservedName` on partial writes, alongside the existing `reservedToken`).

## Decision 3 — Headless enrollment

`zrok2 enable <token>` opens a TUI and, in a non-interactive server, dies with
`open /dev/tty: device not configured`. The enroll recipe appends `--headless`:
```
"zrok:auth-token": { binary: <resolved>, args: (tok) => ["enable", tok, "--headless"], … }
```
The argv-only invariant (no interpolation) is preserved verbatim — `--headless` is a fixed
literal, not a parameter.

**Token-length bound is wrong for v2 (bug found in review):** the current validator is
`/^[A-Za-z0-9._-]{20,200}$/`, but a real v2 account token is **12 chars** (verified:
`RX1EuRvs9H8s`). The min-20 bound rejects valid v2 tokens before spawn, making server-side
enrollment impossible. Lower the minimum to `8` (keep the max and the metacharacter-free
charset so the injection boundary is unchanged): `/^[A-Za-z0-9._-]{8,200}$/`. Only the length
bound moves; the security invariant (allow-list, argv element, no cmd.exe metacharacters) holds.

## Decision 4 — api-v2 endpoint + version-compat detector (the root-cause tooling)

- **api-v2 probe:** doctor's "zrok API reachable" resolves `api-v2.zrok.io` (or, when
  enrolled, the `api_endpoint` from the env file — future-proof if the account is pinned to a
  self-hosted controller). The stale suggestion text still naming `api-v1.zrok.io` is updated.
  **Caveat (found in review):** this is a **DNS-resolution** probe; it CANNOT detect the
  field-incident failure, which was an HTTP 500 on a *reachable* host. DNS success ≠ working
  service. The version-compat check below — not this one — is the actual root-cause detector;
  api-reachable is retained only as a coarse network/DNS gate and is framed as such.
- **NEW "zrok version compatible" check (the real root-cause detector):** run
  `<resolved-zrok> version`, parse the semver, and flag a major version `< 2` (zrok never
  shipped a `1.x`; v1 was the `0.4.x` line, so "< 2.0.0" is the precise boundary) as a warning
  with the remedy (`brew upgrade zrok` / re-download `zrok2`). Guards found necessary in review:
  - **Binary-presence guard first:** `getZrokBinary()` falls back to the literal `"zrok"` when
    nothing resolves, so running `version` on a missing binary yields ENOENT, not a clean
    "unavailable". The check MUST short-circuit on `detectZrokBinary() === false` and defer to
    the "zrok binary" row (status unavailable), never spawn.
  - **Unparseable → `warn` (unknown), never throw.**
  - **Upper bound:** treat `>= 2.0.0` GA as `ok`; a pre-release (`2.0.0-rc.N`) or an
    as-yet-unknown future major is reported `ok` (do not hard-fail on newer), but the check is
    named for the *lower* bound it actually enforces.

## Decision 5 — Config migration (drop dead v1 tokens)

`normalizeTunnelConfig` today lifts a legacy bare `reservedToken` into
`{ provider: "zrok", mode: "public", zrok: { reservedToken } }`. Under v2 a v1 reserved token
is meaningless to the v2 account (different service). New rule:
- Introduce `tunnel.zrok.reservedName?: string`.
- A legacy `reservedToken` (top-level or under `zrok`) is **not** promoted to `reservedName`
  (names ≠ tokens); it is preserved on read for downgrade safety but ignored by the v2 provider.
- No disk rewrite at read time (idempotent shim, matching the existing contract).

Downgrade safety here is **field-preservation, not functional-preservation** (be honest in the
proposal): the `reservedToken` string survives on disk, but a v1 client pointed at the v2 API
still will not serve a working tunnel. It exists so a rollback build can read its own field.

**`config-api.ts` partial-write preservation (gap found in review):** `readConfigRedacted` /
`writeConfigPartial` today redact + re-merge `tunnel.reservedToken` and
`tunnel.zrok.reservedToken`, but have NO handling for `tunnel.zrok.reservedName`. A UI-driven
partial write (e.g. toggling `tunnel.enabled`) would drop the reserved name → silent loss of
the stable URL. `reservedName` is not a secret (no redaction needed) but MUST be carried
through the deep-merge like the other per-provider sub-config, so it survives partial writes.

## Decision 6 — Docker ships zrok v2

- `ARG ZROK_VERSION=2.0.4`. Asset `zrok_${ZROK_VERSION}_linux_${arch}.tar.gz`, arch map
  unchanged (`amd64`/`arm64`/`armv7`), `checksums.sha256.txt` unchanged.
- The tarball contains `zrok2` (not `zrok`): extract `zrok2` to `/usr/local/bin/zrok2` and
  symlink `zrok → zrok2` so both names resolve (belt-and-suspenders with Decision 1).
- `zrok2 version` smoke-check in the build.
- Entrypoint enrollment (`ZROK_TOKEN` set) runs `zrok2 enable "$ZROK_TOKEN" --headless`.
- `~/.zrok2` volume already declared; keep it.

## Risks / trade-offs

- **Name collision across machines:** two dashboards reserving the same generated name on one
  account conflict. Mitigation: random 8-hex suffix + reuse-on-exists; document one name per
  host.
- **Homebrew vs tarball skew:** if Homebrew later renames its binary to `zrok2`, Decision 1
  still resolves it (prefers `zrok2`). No action needed.
- **Self-hosted controllers:** users on a private zrok controller have a non-`api-v2.zrok.io`
  endpoint. The doctor probe reads `api_endpoint` from the env when enrolled, so it does not
  hard-code the hosted host for enrolled machines.
- **v1 holdouts:** a machine still on v1 + still enrolled against a working v1 controller keeps
  functioning for ephemeral shares (dual-binary + `~/.zrok` read). Reserved URLs are v2-only.

## Migration / rollout

1. Land code + tests (dual binary, v2 verbs, headless, api-v2, version check, CORS/URL).
2. Bump Docker, rebuild image, smoke-test enrollment + ephemeral + reserved in the container.
3. Update install-guide UI + tool-registry hints + skill docs.
4. Manual: on a real v2-enrolled host, verify ephemeral connect; persistent connect (stable URL
   across a server restart); plain disconnect PRESERVES the name; `disconnect {forget:true}`
   deletes the name; and doctor all-green.
