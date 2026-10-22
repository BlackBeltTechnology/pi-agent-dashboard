## Why

A process in **any local container** can act as the dashboard operator. The
exploit was shown against the live `:8000` instance on 2026-10-22; the evidence
is in `docs/research/containerized-spawn.md` § "Security finding — loopback
trust from containers".

- Docker Desktop (`host.docker.internal`) and podman machine (gvproxy
  `192.168.127.254`) forward container traffic to host servers bound to
  `127.0.0.1`. The dashboard sees `peer=127.0.0.1`, with no forwarding headers.
- Host admission only blocks an *honest* `Host: host.docker.internal` (403).
  The `Host` header is chosen by the attacker, so `Host: 127.0.0.1:<port>`
  passes.
- `isGenuinelyLocal(ip, headers)` = loopback peer + no forwarding header. In
  the default configuration (`requireLocalProof: false`,
  `packages/shared/src/config.ts:1811`), `isLocallyTrusted` reduces to that
  check (`auth/localhost-guard.ts:93-100`).
- Measured results:
  - `POST /api/paired-devices` (operator guard,
    `routes/pairing-routes.ts:121-125`) minted a **durable `operate`-tier
    device token**.
  - `POST /api/ws-ticket {scope:"bridge"}` (`auth/bridge-ticket-eligibility.ts:73`)
    minted a bridge ticket with no bearer.
  - On the live server, `GET /api/paired-devices` returned 200 (7 devices).
- By code reading (not yet exploited), the same predicate also admits the
  auth `onRequest` skip, the route-tier exemption and every WS upgrade. A
  container can very likely spawn a session, send a prompt or open a terminal:
  code execution on the host.
- Observe-tier file reads (`GET /api/file*`) anchor on the session cwd *and*
  `~/.pi` (`routes/file-routes.ts:401`). So with any session running, a
  container can read `~/.pi/dashboard/local/token` and then mint valid
  proofs. It can also read `config.json` with the auth secret.
- Threat: any code in any local container, for example a `postinstall` script
  in an unrelated project's dev container. No user interaction is needed.

The peer address cannot separate a relay from a genuine local caller, so the
fix is a **credential**: never trust a bare loopback peer for anything
privileged. The mechanism already exists (`requireLocalProof`, change
`harden-trust-and-credential-boundaries` D2). It is off by default because
default-on would break bare `localhost` bookmarks and `curl`. A demonstrated
exploit outweighs that.

`close-residual-audit-findings` plans the same default flip as **B14r**, but
`blocked_by` `close-loopback-legacy-window` (the 1.0.0 release). That ordering
leaves the takeover open until 1.0.0. This change takes B14r out and ships it
now.

## What Changes

- **`requireLocalProof` defaults to `true`:**
  - `DEFAULTS` (`config.ts:1811`) changes to `true`.
  - The parser (`config.ts:2670`) becomes boolean-strict: a non-boolean value
    takes the default and logs a warning.
  - Only an explicit `false` opts out (documented rollback).
- **Strict semantics stay as they are.** Proof is required for every
  surface `isLocallyTrusted` (and its inline strict twins) gates: credential
  mints, `bridge` tickets, `control`/`operate` routes, `/ws`,
  `/ws/terminal/*`, `/live/*` and `/editor/*`. Bare loopback stays admitted to
  `observe` `/api/*`, `/v1/*` and posture disclosure. No new predicate.
- **File routes cannot reach dashboard secrets** (owner decision A1; design
  D8):
  - They refuse `~/.pi/dashboard/local/` and `identity.key` for every
    caller in every mode. This is a recorded exception to rollback-by-flag.
  - They gate the rest of the dashboard dir (for example `config.json`) on
    local trust or a login session.
  - They decide on the opened file's real path, so a symlink swap cannot get
    around the check.
  - An unproven local caller cannot raise operator access prompts.
  - The `~/.pi` read anchor no longer admits the state dir.
- **Browser relay keeps working** (owner decision; design D10):
  - The relay URLs (`cdpUrl`, the extension's `mcpRelayUrl`) carry a
    single-use, 60 s relay ticket minted by the browser plugin.
  - Plugin WS scopes that declare `peerCredential: "plugin"` skip only the
    proof requirement.
  - A guid or URL replayed from a transcript is refused.
- **Rotate possibly-leaked secrets once** (owner decision; design D11):
  - On first start, under a lock, rotate the local token and `auth.secret`.
    Every session and proof cookie is invalidated once.
  - Local tooling follows automatically.
- **Proof cookie bound to its port, 12 h idle expiry** (owner decision;
  design D12).
- **Exec templates** get `PI_DASHBOARD_CLI` (an absolute CLI command), so a
  template can call non-observe routes with proof.
- **Plain-tab remedy** (design D3):
  - `/api/health` gains `localProof: "required"` for an unauthenticated,
    unproofed, genuinely-local caller. One predicate (`needsLocalProof`) is
    shared with the refusal.
  - A loopback session cookie is recognised before the strict observe
    early-return.
  - `/auth/login` shows the remedy and does not auto-redirect for such a
    caller.
  - `useNetworkDenied` shows the banner with a copyable `pi-dashboard open`
    in both `offline` and `auth_required` states.
- **`pi-dashboard api <METHOD> <path> [--data <json>]`** (owner decision):
  - It mints a per-request `X-Pi-Local-Proof`, accepts local paths only, and
    never follows redirects.
  - An unknown CLI subcommand now exits 2 instead of starting a server
    (design D4).
- **Unproofed in-repo callers fixed** (design D5):
  - `bus-client` `mintTicket` and its skill scripts
  - `extension/src/dev-build.ts`
  - `implement/scripts/full-rebuild.ts` and `restart-server.ts`, which now dial
    the address literal, not `localhost`
  - `dashboard-plugin-skill/src/next-steps.ts`
  - the e2e `docker exec curl` mint
  - `packages/electron/scripts/test-*-inner.sh`
  - every `qa/`, `scripts/`, `tests/e2e/`, skill and doc `curl`/`fetch` call
    to a non-observe route

  The qa/e2e smoke runs under the new default.
- **Observability:** a `[local-proof] refused` line keyed on (route, reason),
  not the attacker-chosen Host. The WS path extends `wsUpgradeRejectLog`
  (design D6).
- **Regression proof:**
  - L2: a spoofed-Host loopback request with no proof is refused on the
    mint routes, an operate route, `/ws`, and the token file read.
  - With proof, the same requests are admitted.
  - The container probe is repeated against an isolated dashboard.
- **Sibling coordination** (design D7):
  - `close-loopback-legacy-window` gains
    `blocked_by: close-container-loopback-impersonation` in this planning
    commit.
  - `close-residual-audit-findings` is in-flight elsewhere and mostly
    untracked. Its owner is asked to drop only B14r (keeping B4r and B18) and
    to add the same `blocked_by`.
  - Other overlapping changes rebase at archive.

**BREAKING (default posture):** a hand-typed `http://localhost:<port>` tab and
bare loopback `curl` to non-observe routes are refused until proof is
presented. This includes users who reach the dashboard through `ssh -L`, VS
Code port forwarding or WSL; they use `pi-dashboard open --print` with a
same-port forward. Opt-out: `"requireLocalProof": false` in
`~/.pi/dashboard/config.json`. Opting out re-exposes the dashboard to every
local container.

### Why landing before `close-loopback-legacy-window` is not worse

The three reasons in `close-residual-audit-findings/dependencies.yaml`:

1. *A raw harvested token still counts as proof while legacy acceptance is
   on.*
   - True. But it only matters to an attacker who already holds the token.
   - A container without the token is closed by this change.
   - A container that mounts `$HOME` or `~/.pi` holds the token and can mint
     proofs in any ordering: proof derives from the token.
   - Flipping first therefore never makes anything worse. The mounted-token
     case is a documented residual ("never mount `~/.pi/dashboard`").
2. *Users bootstrap twice.* Accepted: one more `pi-dashboard open` for plain
   tabs at the 1.0.0 rotation.
3. *Both changes modify the same requirements.* Handled by `blocked_by` plus
   the rebase (D7).

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `trust-and-credential-boundaries`:
  - MODIFIED "Opt-in local proof for loopback trust": default `true`; Host
    cannot relax it; `X-Pi-Local-Proof` is named as proof; container
    spoof scenario.
  - MODIFIED: the proof cookie is bound to its port, with a 12 h idle expiry.
  - ADDED: refused-browser remedy, dashboard-state protection on every
    path-taking route, and one-shot secret rotation.
- `server-process-management`:
  - MODIFIED "Backward compatible foreground mode": an unknown word exits 2.
  - ADDED: the `pi-dashboard api` CLI.
- `file-read-containment`: MODIFIED the anchor requirement, the git-root
  widening requirement and the suspension requirement. These cover the
  state-dir check and stop an unproven local miss from raising a prompt.
- `dashboard-mcp-server` ("Every /mcp request is authenticated…"),
  `principal-resolution` ("Resolution is inert…"), `cross-site-request-gate`
  ("WebSocket upgrades reject untrusted Origins") and `settings-panel`
  ("Config read endpoint"): MODIFIED, so their loopback wording follows the
  new default.
- `bearer-device-auth`: MODIFIED "Genuine-local trust via IPC allowlist…",
  "Long-lived opaque bearer tokens…", "Direct token issuance for a local
  operator" and "A device bearer's tier gates…". The "(the default)" wording
  is restated.
- `trusted-networks`: MODIFIED "Network guard factory", "WebSocket upgrade
  respects trusted networks", "…admits bypassHosts trust without OAuth",
  "Universal guard runs regardless of auth configuration" and "Relayed
  loopback requests are never trusted by network entry". Same restatement.
- `oauth-authentication`: MODIFIED "Localhost and trusted host bypass" and
  "OAuth login flow" (no auto-redirect for an unproven local caller).
- `browser-relay`: MODIFIED "Relay endpoints are loopback-only" (single-use
  relay ticket).
- `plugin-ws-route`: MODIFIED "Core gates run before plugin delegation"
  (proof under the default; `peerCredential: "plugin"`).
- `prompt-template-executable-mode`: MODIFIED "Dashboard env vars injected for
  ergonomics" (`PI_DASHBOARD_CLI`).
- `qr-device-pairing`: no delta. Approval already ignores bare loopback in
  every mode (design § Open Questions).

## Impact

- Code:
  - `shared/src/config.ts`
  - `server/src/auth/localhost-guard.ts`: `needsLocalProof`, refusal log
  - `server/src/routes/system-routes.ts`: health field
  - `server/src/routes/file-routes.ts` and `access/containment-gate.ts`: D8
  - `server/src/auth/auth-plugin.ts`: session tagging order, login remedy
  - `routes/local-proof-routes.ts`, `auth/local-proof.ts`: D12 cookie
  - `auth/local-token.ts`, `auth/auth.ts`, `server.ts` startup: D11
    rotation
  - `browser-plugin` (`ws-routes.ts`, `relay-manager.ts`, `connect.ts`),
    `dashboard-plugin-runtime` `ws-route-registry.ts`: D10
  - `extension/src/command-handler.ts`: `PI_DASHBOARD_CLI`
  - `shared/src/safe-local-path.ts`: extracted path predicate
  - `server/src/cli.ts`: `api`, unknown-subcommand exit
  - `client/src/hooks/useNetworkDenied.ts`
  - `bus-client/src/client.ts`
  - the callers listed above
- Tests: the full suite runs under the new default (no global opt-out).
  New L1/L2 cover the Host-spoof refusal, health field, CLI, file-route
  denial, and log limiter.
- Docs (via DocScribe): `docs/architecture.md` Auth model, `docs/faq.md`,
  `README.md`. Also root `AGENTS.md`, `implement` skill, CHANGELOG BREAKING.
- Compatibility: only bare-loopback admission changes. Paired devices, login
  sessions, Electron, CLI and bridges are unaffected.
- Rollback: `requireLocalProof: false` (live), or revert. The D8
  always-refused tier has no opt-out, and the D11 rotation is not undone.
- Upgrade steps: stop every dashboard instance before upgrading. Everyone
  signs in again once after the first start (rotation).
- Accepted residuals (recorded, not fixed here):
  - Observe-tier reads stay open to a container: transcripts, session lists,
    and files in any session cwd outside `~/.pi/dashboard/`. A `$HOME` session
    exposes `~/.ssh` and `~/.pi/agent/auth.json`.
  - `/v1/*` model spend.
  - A live-capability URL leaked into a transcript opens that preview
    (design D2; owner decision to keep current semantics).
  - The proof cookie reaches other `localhost:<port>` sites within its 12 h
    idle window (design D12). The follow-up is a dedicated loopback host.
  - A container that mounts `~/.pi` holds the token.
  - The bridge gateway tokenless loopback grace while the TCP gateway is
    enabled (always on Windows); owned by `close-loopback-legacy-window`.
  - The recovery server's loopback-Host admission while the main server is
    down.
  - Unrelated `127.0.0.1` services (for example `:18791`).
- Closes (security-boundary-audit): B14r (moved from
  `close-residual-audit-findings`) and the 2026-10-22 container Host-spoof
  finding.

## Discipline Skills

- `security-hardening`: closes a host-takeover path; default trust posture;
  secret-file exposure.
- `doubt-driven-review`: the posture flip reverses the recorded D2 decision
  and lands ahead of `close-loopback-legacy-window`.
- `observability-instrumentation`: a bounded `[local-proof] refused` log makes
  relay attempts visible.
