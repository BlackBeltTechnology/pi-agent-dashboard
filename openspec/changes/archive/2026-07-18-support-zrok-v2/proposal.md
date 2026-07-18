# Support zrok v2 (binary rename, namespaces/reserved-names, api-v2 endpoint)

## Why

zrok shipped **v2.0.0 (GA, non-prerelease as of v2.0.4)** with breaking changes that make
the dashboard's zrok integration fail against the hosted service. The hosted
`api-v1.zrok.io` is deprecated: an **outdated v1 client now returns HTTP 500 on every
`enable` and every share create** (verified in the field — the v1 CLI hit `500
enableInternalServerError` / `shareInternalServerError`; `GET https://api-v1.zrok.io/api/v1/version`
replies "your local zrok installation is out of date and needs to be upgraded"). Upgrading
the CLI to v2 fixes enrollment, but then the dashboard's own provider code breaks because
every v1-era command and string it relies on changed.

Authoritative source: the zrok v2 CHANGELOG (issues [#726], [#1124]) and the v2 docs
(`website/docs/how-tos/shares/manage-reserved-names.md`, `.../install/*`). Verified against
the installed `zrok v2.0.4` CLI and the `v2.0.4` GitHub release assets.

### zrok v2 breaking changes (verified)

| Area | v1 (what the dashboard assumes) | v2 (reality) |
|---|---|---|
| Binary name | `zrok` | **`zrok2`** — tarball/Windows/Linux packages install `zrok2`; **Homebrew still installs `zrok`** (formula bottle exposes `zrok` → v2.0.4). Both must resolve. |
| Env dir | `~/.zrok/` | `~/.zrok2/` (already handled by `zrok-env.ts`) |
| Env vars | `ZROK_*` | `ZROK2_*` — informational only; the dashboard reads `environment.json`, not zrok env vars, so no code change here (the Docker `ZROK_TOKEN` is our own compose var, unrelated) |
| API endpoint | `api-v1.zrok.io` | `api-v2.zrok.io` |
| Enroll | `zrok enable <tok>` (opens TUI) | `zrok2 enable <tok> --headless` (bare enable fails `open /dev/tty: device not configured` in a non-interactive server) |
| Reserved share | `zrok reserve public <t>` → token; `zrok share reserved <tok>`; `zrok release <tok>` | **all three removed** → **namespaces + reserved names**: `zrok2 create name -n public <name>` → `zrok2 share public --headless -n public:<name> localhost:<port>` → `zrok2 delete name <name>` |
| Ephemeral public | `zrok share public --headless <t>` → prints `https://<t>.share.zrok.io` | `zrok2 share public --headless <t>` → prints a **bare** host `<t>.shares.zrok.io` (plural, **no scheme**) |
| Private vanity | n/a | `zrok2 share private <t> --share-token <name>` |

### Field-fix already landed (uncommitted, this change formalizes it)

A minimal "quick connect" patch is already in the working tree and MUST be folded into this
change (kept, tested, documented): `tunnel-providers/zrok.ts` `urlRegex` now matches bare +
plural hosts and a `normalizeUrl` hook prepends `https://`; `tunnel-core.ts` gained the
optional `normalizeUrl(raw)` `ChildProviderSpec` hook; `cors-origin.ts` allows
`*.shares.zrok.io`; the stale v1 `tunnel.reservedToken` was cleared from the live config.
Those edits unblocked an **ephemeral** public tunnel only; reserved/persistent URLs,
binary-name resolution, headless enroll, the api-v2 doctor probe, the version-too-old
detector, and the Docker bump are still missing — that is the scope below.

## What Changes

1. **Binary resolution accepts `zrok` and `zrok2`.** `tunnel-providers/zrok.ts` and
   `tunnel-enroll.ts` resolve whichever exists (prefer `zrok2`, fall back to `zrok`), so a
   tarball/Windows/Linux-package install (`zrok2`) and a Homebrew install (`zrok`) both work.

2. **v2 reserved/persistent URLs via named shares.** Replace the removed
   `reserve/share reserved/release` flow with the namespace+name flow: reserve a name
   (`create name -n public`), serve it (`share public --headless -n public:<name>
   localhost:<port>`), release it (`delete name`). Config stores a **reserved name**, not a v1
   reserved token. Persistence is opt-in via `tunnel.zrok.persistent` (default false); a reserved
   name SURVIVES disconnect/restart (stable URL) and is deleted ONLY by an explicit
   `POST /api/tunnel-disconnect {forget:true}`. Ephemeral public (no name) stays the default.
   The provider-neutral core (`tunnel-core.ts`) gains: a `string | RegExp` process marker (so
   `zrok2 share` is scavenged), a `!callerProvidedToken` guard on the crash-exit retry path (so a
   reserved name is never released/regenerated), and removal of auto-reserve (minting moves into
   the zrok provider's `connect`, guarded by `persistent`).

3. **Headless enrollment + correct token length.** The `zrok:auth-token` enroll recipe appends
   `--headless` so server-side `enable` never blocks on `/dev/tty`, AND the token validator's
   min length drops from 20 to 8 — a real v2 account token is **12 chars** (verified), which the
   current `{20,200}` bound rejects before spawn. The allow-list charset + argv-only invariant
   are unchanged; only the length bound moves.

3b. **Plumb `reservedName` end-to-end.** Adding the field is inert unless connect reads it: the
   connect chain (`cli.ts` → `server.ts`/`system-routes.ts` → `TunnelConnectOpts` → provider)
   is updated to carry `reservedName`, and STOPS feeding the legacy v1 `reservedToken` into the
   v2 provider (a v1 token served as a v2 name would fail rather than fall back to ephemeral).

4. **api-v2 everywhere the endpoint is named.** Doctor's "zrok API reachable" DNS probe
   targets `api-v2.zrok.io` (falling back to the enrolled env's `api_endpoint`), and its stale
   `api-v1.zrok.io` suggestion text is corrected. Note: this is a **DNS** gate and cannot
   detect the HTTP-500 failure mode — the version check (#5) is the actual root-cause detector.

5. **New "zrok version compatible" doctor check (the real root-cause detector).** Detect a
   too-old client (major `< 2`; zrok v1 was the `0.4.x` line) — the actual cause of the 500s —
   and tell the user to upgrade. Guards: short-circuit to "unavailable" when no binary resolves
   (never spawn ENOENT); unparseable output → `warn`; `>= 2.0.0` → `ok`.

6. **URL + CORS accept `*.shares.zrok.io`** (fold the landed patch; add regression tests).

7. **Docker image ships zrok v2.** `ARG ZROK_VERSION` → `2.0.4`; extract the `zrok2`
   binary from the tarball and expose it as both `zrok2` and `zrok`; entrypoint enrollment
   uses `--headless`. `~/.zrok2` volume already present.

8. **Install hints + install-guide UI updated to v2** (macOS `brew install zrok`; Linux
   package-repo / `zrok2`; Windows `zrok2` binary on PATH), and the enroll copy notes
   `zrok enable <token>` works headless.

9. **Config migration.** A persisted v1 `tunnel.reservedToken` / `tunnel.zrok.reservedToken`
   is inert under v2 (v1 tokens are meaningless to the v2 account). `normalizeTunnelConfig`
   PRESERVES the legacy token on read for downgrade safety but does NOT promote it to
   `reservedName` (a name is not a token) and the v2 provider ignores it. New fields
   `tunnel.zrok.reservedName` / `tunnel.zrok.persistent` are added.

## Impact

- **Affected specs:** `zrok-tunnel` (MODIFIED), `zrok-process-tunnel` (MODIFIED),
  `zrok-install-guide` (MODIFIED), `tunnel-provider` (MODIFIED), `zrok-v2-runtime` (ADDED — headless enroll + api-v2 probe + version-compat).
- **Affected code:**
  - `packages/server/src/tunnel-providers/zrok.ts` — binary resolution, v2 named-share serve/release, `processMarker` matching `zrok2`, URL regex anchor + normalize (regex/normalize landed).
  - `packages/server/src/tunnel-core.ts` — `normalizeUrl` hook (landed); reserved-path opt-out of release-on-retry.
  - `packages/server/src/tunnel-enroll.ts` — `enable … --headless`, binary resolution, token min-length 8.
  - `packages/server/src/cli.ts`, `packages/server/src/server.ts`, `packages/server/src/routes/system-routes.ts` — plumb `reservedName` into the connect call; stop passing v1 `reservedToken` to the v2 provider.
  - `packages/shared/src/tunnel-provider.ts` — `TunnelConnectOpts.reservedName`.
  - `packages/server/src/tunnel-core.ts` — `processMarker: string | RegExp` + regex-aware matcher; `!callerProvidedToken` guard on the crash-exit retry; drop auto-reserve.
  - `packages/server/src/config-api.ts` — carry `tunnel.zrok.reservedName` / `persistent` through partial-write deep-merge (not secrets; must not be dropped).
  - `POST /api/tunnel-disconnect` (`system-routes.ts`) — accept `{forget:true}` to release the name + clear config; plain disconnect preserves it.
  - `packages/server/src/cors-origin.ts` — `*.shares.zrok.io` (landed).
  - `packages/shared/src/zrok-env.ts` — already v2-first; verify field names.
  - `packages/shared/src/doctor-core.ts` — api-v2 probe, binary detect `zrok2`, version-compat check + suggestion.
  - `packages/shared/src/tool-registry/definitions.ts` — v2 install hints.
  - `packages/shared/src/config.ts` — `tunnel.zrok.reservedName`, migration of legacy token.
  - `packages/client/src/components/Gateway/*` — install/enroll copy (v2, `zrok2`).
  - `docker/Dockerfile`, `docker/entrypoint.sh`, `docker/compose.yml`, `docker/.env.example`.
  - Tests: `tunnel.test.ts`, `tunnel-provider.test.ts`, `doctor-tunnel-checks.test.ts`, `tunnel-config-migration.test.ts`, `cors*.test.ts`, `tool-registry-definitions.test.ts`, `zrok-env` tests.
  - Docs: `packages/extension/.pi/skills/pi-dashboard/references/api-reference.md`, `packages/extension/.pi/skills/doctor/*` (api-v1 → api-v2), `docker/README.md`, `docs/architecture.md` tunnel section.
- **Back-compat:** v1 installs still resolve (`zrok` binary + `~/.zrok/` still read). A live
  v1-enrolled machine keeps working for ephemeral public shares; only reserved URLs require v2.
- **No persisted-key rename:** the `tunnel` config block keeps its name; only the zrok
  sub-shape gains `reservedName` and deprecates `reservedToken`.

## Discipline Skills

- `security-hardening` — `tunnel-enroll.ts` is the command-injection boundary; the new
  reserved-**name** argument and dual-binary path must keep the strict allow-list validator
  and argv-only (never interpolated) invariant.
- `systematic-debugging` — the version-compat detector and api-v2 probe are the
  root-cause tooling; derive them from the observed 500 failure mode.
- `review-code` — before commit.
