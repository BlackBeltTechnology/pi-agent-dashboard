## Why

ArtCraft studio (github.com/storytold/artcraft, Apache-2.0, v0.41.0) is the AI image/video IDE of the ArtCraft family: 2D/3D scene composition and a catalog of 62 cloud models (image, video, audio, mesh, splat) run through the user's ArtCraft account and credits. Unlike the Crafting Apps it ships **no CLI and no local MCP server** — a single Tauri GUI binary (`ai.artcraft.app`) for macOS and Windows that talks to `api.storyteller.ai`.

Explore findings (2026-10-14):
- Releases publish `.dmg`, `_x64-setup.exe`, `.msi`, `.app.tar.gz` — **no `SHA256SUMS.txt`**.
- The open-source API client defines **MCP session management** (`POST /v1/mcp/session/{create,refresh,revoke,list}`; create returns a private session token shown once and a refresh token that rotates on every refresh). `/v1/mcp/session/list` answers **401** in production (unknown paths 404) → the session API is live. The MCP **transport endpoint is not public** (no path in the repo; `/mcp`, `/v1/mcp/{rpc,sse}`, `mcp.*` hosts 404/unresolved).
- A login-challenge flow (`/v1/login_challenges/{create,poll}`) exists in the client for app sign-in.
- The private generation API (`omni_gen` cost+generate for image/video/audio/mesh/splat) is undocumented; building a client on it was rejected (breakage, ToS, credit spend). AI generation stays with `nano-banana` and `veo-generator`.

Users want ArtCraft studio managed like the Crafting Apps (install, update, launch, hand work to it) and agent access the moment ArtCraft's hosted MCP becomes available.

## What Changes

- `pi-craft artcraft install|update|status|launch|open <file…>|uninstall-cache` in `packages/craft-apps`: download the host installer (macOS `.app.tar.gz`/`.dmg`, Windows `.msi`), verify **platform signatures** instead of checksums (macOS `codesign --verify` + `spctl` with pinned Team ID; Windows Authenticode with pinned publisher), optional pinned SHA-256 per version, install per-user, launch, open files in the app.
- `pi-craft artcraft login|logout|whoami`: ArtCraft account sign-in via the login challenge; create an MCP session (client name `pi-craft`); store session + rotating refresh token in the OS keychain (fallback: user-only `0600` file); `logout` revokes server-side and deletes locally. Tokens never printed or logged.
- **Hosted MCP client behind a feature flag** (`ARTCRAFT_MCP_URL` unset ⇒ disabled): `pi-craft artcraft mcp` as a local stdio↔remote bridge presenting the session token, refreshing on expiry, and requiring a one-time confirmation that tool calls spend ArtCraft credits. `mcp --register` (lazy, like the app servers).
- Skill `artcraft-studio`: when to use ArtCraft studio vs `nano-banana`/`veo-generator`/craft apps, hand-off via `open`, account/credit caveats, hosted-MCP status.

## Capabilities

### New Capabilities
- `artcraft-studio-management`: install/update/status/launch/open with signature verification and per-user install.
- `artcraft-account-session`: login challenge, MCP session creation, secure storage, rotation, logout/revoke.
- `artcraft-hosted-mcp`: flagged stdio bridge to ArtCraft's hosted MCP, credit-spend confirmation, lazy registration.

### Modified Capabilities
- None in this change. (Storing the rotating ArtCraft session in the credential vault needs plugin-initiated rotation, which `credential-vault` does not offer; tracked as a follow-up.)

## Impact

- Code: `packages/craft-apps/src/artcraft/` (installer, signature verification, session store, MCP bridge), CLI wiring, 1 skill, tests.
- Depends on: `add-craft-apps-core` (CLI, MCP registration conventions).
- Implementation order (group `artcraft-craft-apps`): 4 of 4 — technically only needs `add-craft-apps-core`, but scheduled last because its gating tasks wait on external answers (hosted MCP endpoint, signing identities, ArtCraft third-party-client policy); may be pulled forward once those resolve.
- External: GitHub releases (installer ≈95 MB), `api.storyteller.ai` (auth, sessions, MCP when live). Credits are spent only through the hosted MCP after confirmation.
- Security: desktop installer execution (explicit command only); account credentials; long-lived rotating refresh token; remote tool calls.
- Rollback: remove subcommands/skill; `logout` revokes sessions; keychain entries deletable.

## Discipline Skills

- `security-hardening` — installer without checksums (signature pinning), account auth, token storage and rotation, remote MCP bridge handling untrusted tool output.
- `doubt-driven-review` — integrating an unpublished hosted endpoint and choosing keychain over the vault are hard-to-reverse trust decisions.
- `observability-instrumentation` — new external calls (auth, session refresh, remote MCP); structured, token-free status/error reporting.
- `review-code` — before commit.
