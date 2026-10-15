## Why

ArtCraft studio (github.com/storytold/artcraft, Apache-2.0, v0.41.0) is the AI image/video IDE of the ArtCraft family: 2D/3D scene composition and a catalog of 62 cloud models (image, video, audio, mesh, splat) run through the user's ArtCraft account and credits. Unlike the Crafting Apps it ships **no CLI and no local MCP server** — a single Tauri GUI binary (`ai.artcraft.app`) for macOS and Windows that talks to `api.storyteller.ai`.

Explore findings (2026-10-14, external — not checkable from the repo; re-confirmed by the gating tasks before implementation relies on them):
- Releases publish `.dmg`, `_x64-setup.exe`, `.msi`, `.app.tar.gz` — **no `SHA256SUMS.txt`**.
- The open-source API client defines **MCP session management** (`POST /v1/mcp/session/{create,refresh,revoke,list}`; create returns a private session token shown once and a refresh token that rotates on every refresh). `/v1/mcp/session/list` answers **401** in production (unknown paths 404) → the session API is live. The MCP **transport endpoint is not public** (no path in the repo; `/mcp`, `/v1/mcp/{rpc,sse}`, `mcp.*` hosts 404/unresolved).
- A login-challenge flow (`/v1/login_challenges/{create,poll}`) exists in the client for app sign-in.
- The private generation API (`omni_gen` cost+generate for image/video/audio/mesh/splat) is undocumented; building a client on it was rejected (breakage, ToS, credit spend). AI generation stays with `nano-banana` and `veo-generator`.

Users want ArtCraft studio managed like the Crafting Apps (install, update, launch, hand work to it) and agent access the moment ArtCraft's hosted MCP becomes available.

## What Changes

- New `pi-craft artcraft <install|update|status|launch|open|login|logout|whoami|mcp>` subcommand group in `packages/craft-apps`. ArtCraft studio is **not** added to the 13-app Crafting App registry (it has no `<app>-cli`), so `apps`, `status`, `install <app…>` and `<app> …` keep their 13-app meaning.
- `install|update|status|launch|open`: download the host installer (macOS `.app.tar.gz`, Windows `.msi`) and verify the **platform code signature against a pinned identity** instead of a sums file (macOS `codesign --verify --deep --strict` + `spctl` with pinned Team ID; Windows Authenticode with pinned publisher), plus an optional pinned SHA-256 per version. If no identity is pinned for the host, the command refuses with exit `69`. Installs per user. Launches the app or opens files in it. Linux → exit `69` (no build).
- `login|logout|whoami`: ArtCraft account sign-in via the login challenge. Creates an MCP session (client name `pi-craft`). Stores the session and rotating refresh token in **one `0600` file** under `<pi agent dir>/artcraft/` (`0700` dir, independent of `CRAFT_HOME`). One cross-process lock covers read → refresh → write. `logout` revokes server-side and deletes local tokens. Tokens are never printed, logged or put on a command line.
- **Hosted MCP client behind a feature flag** (`ARTCRAFT_MCP_URL` unset ⇒ disabled): `pi-craft artcraft mcp` is a local stdio↔remote bridge. It presents the session token, refreshes once on expiry, and requires a one-time `--accept-credit-use` before any `tools/call` goes upstream. `mcp --register` writes `craft-artcraft` into `.pi/mcp.json` (lazy, like the app servers; refuses while the flag is unset).
- Skill `artcraft-studio` (15th skill in the package): when to use ArtCraft studio vs `nano-banana`/`veo-generator`/craft apps, hand-off via `open`, account/credit caveats, untrusted remote output, hosted-MCP status.

## Capabilities

### New Capabilities
- `artcraft-studio-management`: install/update/status/launch/open with signature verification and per-user install.
- `artcraft-account-session`: login challenge, MCP session creation, `0600` file storage, locked rotation, logout/revoke.
- `artcraft-hosted-mcp`: flagged stdio bridge to ArtCraft's hosted MCP, credit-spend acknowledgement, lazy registration as `craft-artcraft`.

### Modified Capabilities
- `craft-binary-provisioning`: "Desktop installers only on explicit request" gains a second explicit exception, `pi-craft artcraft install|update`, verified by pinned code signature (ArtCraft publishes no `SHA256SUMS.txt`).
- `craft-cli-entrypoint`: dispatch accepts the `artcraft` group. Lazy registration covers `craft-artcraft`. The recommended-extensions `unlocks` names the `artcraft-studio` skill.
- `craft-app-skills`: the router points to `artcraft-studio` for ArtCraft studio hand-off. The manifest declares 15 skills.

Not modified: `credential-vault` and `plugin-credential-store`. The vault stores user-rotated values. Machine-initiated rotation of a secret owned by a CLI tool is a follow-up (task 4.5). The plugin store is a server-plugin API, and `pi-craft` is a standalone CLI.

## Impact

- Code: `packages/craft-apps/src/artcraft/` (new download + signature verification — `launcher-install.ts`/`downloadVerified` require SHA256SUMS and are not reused; session store; MCP bridge mirroring `mcp-proxy.ts` rules; a registry-free entry writer factored out of `mcp-register.ts`), CLI dispatch in `src/bin/craft.ts`, 1 skill, `package.json#pi.skills`, recommended-extensions `unlocks`, tests.
- Depends on: `add-craft-apps-core` (archived `openspec/changes/archive/2026-10-14-add-craft-apps-core/`; CLI dispatch, exit codes, MCP proxy and registration conventions).
- Implementation order (group `artcraft-craft-apps`): 4 of 4. Technically it needs only `add-craft-apps-core`. It is scheduled last because its gating tasks wait on external answers (hosted MCP endpoint, signing identities, ArtCraft third-party-client policy). It may be pulled forward once those resolve.
- External: GitHub releases (installer ≈95 MB), `api.storyteller.ai` (auth, sessions, MCP when live). Credits are spent only through the hosted MCP after acknowledgement.
- Security: desktop installer execution (explicit command only); account credentials; long-lived rotating refresh token; remote tool calls with untrusted output.
- Rollback: remove the subcommand group, skill and manifest entries. `logout` revokes sessions. Delete `<pi agent dir>/artcraft/`. Revert the 3 MODIFIED deltas.

## Discipline Skills

- `security-hardening` — installer without checksums (signature pinning), account auth, token storage and rotation, remote MCP bridge handling untrusted tool output.
- `doubt-driven-review` — integrating an unpublished hosted endpoint and the file-store-over-vault decision are hard-to-reverse trust decisions.
- `observability-instrumentation` — new external calls (auth, session refresh, remote MCP); structured, token-free, stderr-only status/error reporting.
- `review-code` — before commit.
