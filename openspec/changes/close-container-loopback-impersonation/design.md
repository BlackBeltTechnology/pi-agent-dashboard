# Design — close-container-loopback-impersonation

## Context

Motivation: see proposal.md § Why. Paths below are relative to
`packages/server/src/` unless they start with `packages/`.

- **Flag.**
  - Field: `packages/shared/src/config.ts:1263` (doc comment at `:1255-1262`,
    which says "Default false").
  - Default: the `DEFAULTS` entry at `config.ts:1811`.
  - Parse: `parsed.requireLocalProof === true` (`config.ts:2670`). Missing and
    non-boolean values parse as `false`. The test matrix asserting this is
    `packages/shared/src/__tests__/config-secure-write.test.ts:91-94` ("E16").
  - The only runtime reader is `liveRequireLocalProof()`
    (`config-snapshot.ts:113-115`). It reads the mtime-gated snapshot
    (`config-snapshot.ts:77-96`), so changes apply live.
  - `loadConfig` also runs in every bridge process (`cli.ts:1742-1744`).
- **Trust context.** Created at `server.ts:748`
  (`createLocalTrustContext(localToken, liveRequireLocalProof)`) and threaded
  to the guard, route and WS registrars.
- **Strict-aware admission** goes through `isLocallyTrusted(input, ctx)`
  (`auth/localhost-guard.ts:93-100`) at:
  - `auth/auth-plugin.ts:515` (onRequest skip), `auth/auth-plugin.ts:624`,
    `auth/auth-plugin.ts:743` (WS)
  - `auth/localhost-guard.ts:402` (network guard / universal hook)
  - `auth/route-tier-gate.ts:84`
  - `auth/operate-required.ts:56`
  - `auth/bridge-ticket-eligibility.ts:73`
  - `pairing/socket-locality.ts:21`
  - `routes/pairing-routes.ts:121-125` (operator guard)
  - `routes/user-routes.ts:75`
  - `routes/plugin-runtime-client-routes.ts:124`
  - `routes/live-server-routes.ts:166`
  - `routes/file-routes.ts:534-537` (`confinedRoots`, browse routes only)

  The same rule is applied inline (`!ctx || !ctx.strict() || hasLocalProof`)
  by `isPluginScopePeerLocal` (`auth/localhost-guard.ts:151`, called with
  ctx at `server.ts:4594`) and by `isTrustedSource`
  (`auth/localhost-guard.ts:200-212`).
- **Calls with no ctx** (bare-loopback semantics in every mode):
  - Hint/remedy only: `auth/approval-refusal.ts:79`,
    `auth/operate-required.ts:103`.
  - Posture disclosure: `canDiscloseAccessPosture`
    (`auth/localhost-guard.ts:110-115`), true for authenticated OR
    genuinely-local callers.
  - Live-capability validation: `live-server/live-capability.ts:445` and
    `server.ts:4644` call `store.validateGrant(target, token, {
    genuinelyLocal: isLocallyTrusted(…) })`. A token is required, and a
    locally-minted token is honoured only from a "genuinely local" request,
    judged here without ctx. `routes/live-server-routes.ts:99`
    (`isLocalBoundMint`) is the mint-side twin.
- **Strict carve-outs.**
  - Observe: `auth/auth-plugin.ts:517-521` and
    `auth/localhost-guard.ts:405-412`. `isObserveApiRequest` is at
    `auth/localhost-guard.ts:444-447`.
  - `/v1/*`: `auth/localhost-guard.ts:409, 435-437`.
  - The observe early-return at `auth/auth-plugin.ts:517-521` runs **before**
    `/api/health` tags a session cookie (`auth/auth-plugin.ts:532-536`). Under
    strict mode, a signed-in loopback tab therefore reaches health with
    `isAuthenticated` unset.
- **File reads.**
  - `GET /api/file*`, `GET /api/session-file` and `GET /api/grep` are
    `observe` (`packages/shared/src/route-tiers.ts:126-137, 151, 263`).
  - `/api/grep` anchors on cwd only (`routes/grep-routes.ts:67-68`). Its JS
    fallback does not skip dot directories (`lib/grep.ts:41, 72`).
  - The live static gates (`server.ts:3263, 3279`) and
    `resolve-file-mention.ts:79` also probe paths.
  - `access/verified-read.ts` is grant-only and `lstat`-based
    (`routes/file-routes.ts:1628-1635`).
  - The read, raw, render and mention sites anchor on `[cwd, ~/.pi]`
    (`routes/file-routes.ts:137-139` `homePiAnchor`, `:401`). So *any*
    running session lets a bare-loopback caller read
    `~/.pi/dashboard/local/token` (`auth/local-token.ts:39-60`) and
    `~/.pi/dashboard/config.json`, which holds the auth HMAC secret
    (`packages/shared/src/config.ts:2567`). Spec: `file-read-containment`
    "the ~/.pi anchor is preserved".
  - Containment itself does not depend on the caller (`gateFilePath`,
    `gateReadPath`, `routes/file-routes.ts:342-410`).
  - A denial may be held for an operator access prompt
    (`access/containment-gate.ts:303-307`, `holdDenial`) for any caller.
  - No client feature reads `~/.pi/dashboard/` through the file routes.
    Attachments use `routes/attachment-routes.ts:44`.
  - The dashboard dir resolves through `getDashboardConfigDir`
    (`packages/shared/src/dashboard-paths.ts:111`).
- **Refusals.**
  - REST: `sendNetworkDenied` (`auth/localhost-guard.ts:352-365`, 403
    `network_not_allowed`, `reason:"local_proof_required"`).
  - WS: a bare 403/401 written at `server.ts:4722`, logged via
    `wsUpgradeRejectLog`. That limiter is bounded at 256 keys
    (`auth/ws-upgrade-reject-log.ts:41-55`).
- **Login page.** `/auth/login` auto-redirects to the provider when exactly
  one is configured (`auth/auth-plugin.ts:358-371`). A bare-loopback HTML
  navigation without a session is redirected there (`auth/auth-plugin.ts:574-579`),
  so the SPA never loads.
- **Client.**
  - `useNetworkDenied` probes `/api/health` only while `status === "offline"`
    (`packages/client/src/hooks/useNetworkDenied.ts:26-51`).
  - With OAuth configured, a refused WS becomes `auth_required`
    (`packages/client/src/hooks/useWebSocket.ts:219-226, 243`).
  - `local_proof_required` is consumed nowhere in `packages/client/src`.
- **Callers that send proof:**
  - Electron: `packages/electron/src/main.ts:295, 352` → `loadWithLocalProof`
    (`packages/electron/src/lib/local-proof-bootstrap.ts:100-108`).
  - CLI: `cli.ts:670-675, 862-866, 1136, 1158, 1200, 1387`, via
    `localCredentialHeaders` (`cli.ts:1066-1080`).
  - Bridge: `X-Pi-Local-Proof`.
  - `scripts/reload-all.sh:58-86`, which dials the address literal.
- **Callers that send no proof:**
  - `packages/bus-client/src/client.ts:146` (`mintTicket`). It is used by
    `packages/extension/.pi/skills/pi-dashboard/scripts/dashboard-bus.ts` and
    `.pi/skills/debug-dashboard/scripts/{list-sessions,health-probe}.ts`.
  - `packages/extension/src/dev-build.ts:34`.
  - `.pi/skills/implement/scripts/full-rebuild.ts:62-65` and
    `restart-server.ts:47-52`. Both dial `localhost`, and
    `canonicalBinding` throws on a host name
    (`packages/shared/src/local-credential-proof.ts:66-79`).
  - `packages/electron/scripts/test-{desktop-launch,electron-install,deb-install}-inner.sh`
    (bare `curl -X POST` to `/api/session/spawn` and `/api/shutdown`).
  - `tests/e2e/goal-plugin-relocation.spec.ts:37`, and possibly e2e
    `fetch` callers such as `tests/e2e/archive-fold.spec.ts:201`. Whether
    the harness peer is loopback is unverified; task 5.6 settles it.
  - `packages/dashboard-plugin-skill/src/next-steps.ts:32`.
  - `qa/tests/*.sh`, plus skill and doc curls.
- **CLI dispatch.**
  - `SUBCOMMANDS` (`cli.ts:101`) lists six words. `token`, `service`, `pair`
    and `login` are dispatched earlier by `rawArgs[0]` (`cli.ts:1746-1780`).
  - An unknown positional falls through to `cmdForeground`
    (`cli.ts:123-126, 1811-1814`).
  - There is no runtime usage printer; `cli.ts:20` is a source comment.
  - `sanitizeReturnUrl` (`auth/auth-plugin.ts:117`) returns `/` on rejection,
    and `cli.ts` keeps `auth-plugin` out of its static imports (dynamic import,
    `cli.ts:37-39`).
- **Bridge gateway.** The tokenless loopback grace is on through 0.9.x
  (`server.ts:1274`; `pi/bridge-upgrade-auth.ts:167-178`). TCP is opt-in on
  POSIX; Windows has no unix socket.
- **Browser relay.**
  - `packages/browser-plugin/src/server/ws-routes.ts:23-26, ~92, ~112`
    registers `/ws/browser-ext/` and `/ws/browser-cdp/`; the guid is the sole
    credential.
  - The core gate is `server.ts:4565-4615` → `isPluginScopePeerLocal`
    (`auth/localhost-guard.ts:144-157`), which requires proof under strict.
    The CDP client (Playwright `connectOverCDP`, `agent-browser connect`) and
    the pinned extension send neither headers nor the cookie, so a strict
    default would refuse the relay.
  - `cdpUrl` is built at `relay-manager.ts:442, 643, 1061`. The extension URL
    is built at `connect.ts:48-51`.
  - `guidFromPath` strips the query.
  - The registration type is `{pathPrefix, admitOrigins, handleUpgrade}`
    (`packages/dashboard-plugin-runtime/src/server/ws-route-registry.ts`).
  - Spec `browser-relay` "Relay endpoints are loopback-only" forbids
    `/api/ws-ticket` tickets on these scopes.
- **Secrets at rest.**
  - The local token is created once and never rotated
    (`auth/local-token.ts:39-60`). There is no lock and no epoch.
  - The server reads it once at startup (`server.ts:734, 740, 748`). CLI,
    bridge and Electron re-read it per use.
  - `auth.secret` is created once in `config.json` (`auth/auth.ts:139-157`).
    It keys session JWTs and the OAuth state MAC.
  - Both may already have been read through the `~/.pi` anchor.
  - `close-loopback-legacy-window` plans a `local/token-epoch` rotation
    (`REQUIRED_TOKEN_EPOCH = 1`, `token.lock`, its design D3/D4) for 1.0.0.
- **Exec templates.** `buildDashboardExecEnv`
  (`packages/extension/src/command-handler.ts:1360-1366`) injects
  `PI_DASHBOARD_PORT` and `PI_DASHBOARD_BASE=http://localhost:<port>`.
  `resolveServerCliPath` (`packages/extension/src/server-launcher.ts:52-67`)
  finds the server CLI.
- **Recovery server.** Admits a loopback peer with a loopback `Host`
  (`lifecycle/recovery-server.ts:112-124`) while the main server cannot load.

## Goals / Non-Goals

**Goals:**
- Under the default, a bare loopback peer is refused on every strict-gated
  surface.
- It cannot read or overwrite dashboard secrets through the file routes.
- It cannot raise operator access prompts.
- Secrets that may already have leaked are rotated once.
- The browser relay keeps working under the default through a single-use
  relay ticket.
- A refused tab is shown the remedy.
- Every in-repo caller and documented command keeps working.

**Non-Goals:**
- No new admission predicate.
- Observe-tier REST, `/v1/*` and posture disclosure stay as they are.
- No change to the bridge gateway grace, legacy raw-token acceptance or the
  recovery server.
- No relay or process detection (D1).

## Decisions

### D1 — Close it with a credential, not relay detection

- Change `DEFAULTS.requireLocalProof` to `true` (`config.ts:1811`).
- Parse with `typeof v === "boolean" ? v : true` (`config.ts:2670`).
- A present non-boolean logs one warning from the server's config-snapshot
  consumer (`liveRequireLocalProof`, `config-snapshot.ts:113-115`), keyed on
  the last-warned raw value. It never comes from `loadConfig`, which bridges
  also run. A quoted
  `"false"` rollback is therefore reported, not silently ignored.
- Update the doc comment.

*Alternatives:*
- Peer-process relay detection (libproc, `/proc/net/tcp`). Rejected: a
  per-platform name list, per-connection cost, and it misses `--network host`
  and `ssh -R`.
- Gating only the mint routes. Rejected: leaves operate REST and `/ws` open.
- Auto-strict only while a container runtime runs. Rejected: racy.

### D2 — Strict semantics unchanged (live capabilities untouched; owner decision)

The flip changes when strict applies, not what it does. Live-capability
validation (`live-server/live-capability.ts:445`, `server.ts:4644`,
`routes/live-server-routes.ts:99`) keeps judging local binding without ctx.
Threading proof would break Electron's "Open in browser" for previews (the
system browser has a different cookie jar) and agent `/live` fetches.
Residual: a capability URL leaked into a transcript lets a container open that
preview. The hint-only sites stay ctx-less and are labelled as non-admission in
the `auth/localhost-guard.ts` sidecar.

### D3 — Remedy for a refused tab

- **One predicate.** `needsLocalProof(request, ctx)` in
  `auth/localhost-guard.ts`:
  `isLocallyTrusted(input) && !isLocallyTrusted(input, ctx) &&
  !request.isAuthenticated`. It uses only the shared predicate: the call
  without ctx means "genuinely local", the call with ctx means "trusted
  now". There is no direct `isGenuinelyLocal` call, honouring E18. The health
  handler gets `localTrust` threaded through `routes/system-routes.ts`
  registration. `sendNetworkDenied`'s strict branch
  (`auth/localhost-guard.ts:353-356`) and the health handler both use it.
- **Session tagging first.** Recognise a valid session cookie (the existing
  `tagSessionCookie`) **before** the strict observe early-return at
  `auth/auth-plugin.ts:517-521`. A signed-in loopback tab is then
  `isAuthenticated` on observe routes: no banner, and D8's session admission
  works. Tagging never refuses and never clears a cookie on observe routes,
  which preserves today's no-clear behaviour there.
- **Health.** `/api/health` adds `localProof: "required"` when
  `needsLocalProof` holds.
- **Login page.** When `needsLocalProof` holds for the request,
  `/auth/login` does not auto-redirect to a single provider. It renders the
  picker with the `pi-dashboard open` remedy.
- **Client.** `useNetworkDenied` probes in `offline` and `auth_required`.
  `probeNetworkDenied` handles the 200-with-`localProof` body as well as the
  existing 403. It maps the field to `{ reason:"local_proof_required", hint }` in the
  existing banner, with a copyable command.
- *Alternative:* a JSON body on the WS 403. Rejected: browsers do not expose
  upgrade-response bodies.

### D4 — `pi-dashboard api` (owner decision) and a fail-closed CLI

- **Dispatch.** The subcommand word is the first positional that is not a
  flag value: `--port 9000 api …` resolves to `api`. One scan serves `api`,
  `token`, `service`, `pair`, `login` and the `SUBCOMMANDS` list. `api`'s
  own positionals therefore never count as unknown.
- It dials the address literal `restart` uses (`cli.ts:859-866`), mints one
  proof with `localCredentialHeaders`, and sends `redirect:"manual"`.
- **Path rule.** Extract the leading-slash predicate behind
  `sanitizeReturnUrl` into a dependency-free shared module
  (`packages/shared/src/safe-local-path.ts`, `isSafeLocalPath(raw)`).
  `sanitizeReturnUrl` and the CLI both call it, so there is one predicate and
  no static `auth-plugin` import in `cli.ts`. The CLI additionally rejects
  `#`. On rejection it exits 2 with nothing sent.
- Exit codes: 0 = 2xx; 1 = any other status (body on stderr); 2 = usage or
  server not running.
- **Unknown positional word.** It prints a minimal usage line (a new runtime
  string listing the recognised words) and exits 2. Flag-only invocations
  still run in the foreground. This is MODIFIED in `server-process-management`.
- **Older binaries** keep the old fall-through. The docs name the minimum
  version; in-repo qa and skills call the CLI shipped with them.

### D5 — Every in-repo caller sends proof

- TS callers dial the address literal (as `reload-all.sh` does) and mint with
  shared helpers:
  - `full-rebuild.ts`, `restart-server.ts`: `httpProofHeaders`.
  - `dev-build.ts`: `localCredentialPlan`.
  - `bus-client` `mintTicket`: an injected proof-header provider, supplied by
    its skill scripts. bus-client stays free of token-file I/O.
- The e2e `docker exec curl` mint sends proof. The `docker/test-entrypoint.sh:997-1010`
  `/ws` smoke mints proof.
- Exec templates get `PI_DASHBOARD_CLI` (absolute, from
  `resolveServerCliPath`; MODIFIED `prompt-template-executable-mode`).
  Templates that call non-observe routes, such as
  `commands/dashboard-server-config.md:5` `GET /api/config` and
  `dashboard-peer-scan.md`, use `$PI_DASHBOARD_CLI api …`.
- `packages/extension/src/server-auto-start.ts:427` ("Dashboard started at
  …") appends the `pi-dashboard open` remedy.
- Tests get a proof-based stamp helper next to the legacy one
  (`test-support/local-credential-stamp.ts`). New and migrated tests use it,
  so the legacy-window change does not inherit a larger legacy surface.
- Shell, docs and skills move to `pi-dashboard api` or `pi-dashboard restart`.
- The sweep matches `curl|wget|fetch(|WebSocket(` toward loopback or
  `$PI_DASHBOARD_BASE` across `qa/`, `scripts/`, `docker/`,
  `packages/electron/scripts/`, `tests/e2e/`, docs and skills. Each hit is triaged against
  `packages/shared/src/route-tiers.ts`, including GETs on `operate` routes.
- A qa and e2e run under the new default closes the sweep. This carries over
  the harness audit promised by `close-residual-audit-findings` design
  (B14r risk line).

### D6 — Observability without a flood

- REST `local_proof_required` refusals log
  `[local-proof] refused peer=… host=<sanitized> method=… route=<pattern>`.
- The limiter key is (route pattern, reason), never the attacker-chosen Host.
  It is bounded like `auth/ws-upgrade-reject-log.ts:41-55`, at one line per
  key per 60 s. Host is length-capped and newline-escaped.
- WS refusals extend the existing `wsUpgradeRejectLog` entry with `reason`.
  There is no second emitter.

### D7 — Sibling coordination

- **`close-loopback-legacy-window`** is tracked on `develop`. The planning
  commit adds its `dependencies.yaml` with
  `blocked_by: close-container-loopback-impersonation`. The ship-it
  dependency gate then enforces the order. Its deltas (which say "defaulting
  to `false`") are rebased at its own apply/archive; the archive validator
  refuses dropped scenarios.
- **`close-residual-audit-findings`** is mostly untracked: its `design.md`,
  `specs/` and `dependencies.yaml` are in-flight planning in another session.
  This change does not edit it. A manual task asks its owner to:
  - drop only its B14r material (keep B4r and B18);
  - replace the B14r `blocked_by` with
    `blocked_by: close-container-loopback-impersonation`;
  - rebase its overlapping deltas.

  Until then, both changes list B14r. This change is the one that ships it.
- **Rotation epoch.** `close-loopback-legacy-window` must reuse
  `local/rotation.lock`, and its token rotation must require
  `rotation-epoch >= 2`. Its `dependencies.yaml` reason records this.
- **Other overlaps**, rebased at archive by whichever change archives later:
  - `browser-relay`, `plugin-ws-route` and `prompt-template-executable-mode`
    may have other active changes. The task 0 collateral re-scan lists them.
  - `device-key-mutual-check` and `add-plugin-isolation-and-public-routes`
    (bearer requirements)
  - `add-plugin-capability-routes` ("Network guard factory", "Localhost and
    trusted host bypass")
  - `core-file-cwd-admission` (file-read-containment anchor requirement)

### D8 — Dashboard secrets out of reach of path-taking routes (owner decision A1, widened)

- **Coverage.** Every route that reads, writes, searches or probes a path for
  a client applies the check:
  - `/api/file*`, `/api/session-file`, `/api/file/write*`;
  - `/api/grep`: its matches are filtered, and the JS fallback skips the
    state dir;
  - mention resolution (`resolve-file-mention.ts:79`), open-in-system and
    reveal;
  - the live static gates (`server.ts:3263, 3279`).
- **Tiers.** The dashboard dir is resolved once with `fs.realpathSync`
  (`getDashboardConfigDir()`, recomputed when HOME changes).
  - **Always refused**, every caller, every mode: `<dir>/local/**` and
    `<dir>/identity.key`. This tier is the recorded exception to
    rollback-by-flag.
  - **Trust-gated:** the rest of `<dir>` is refused unless
    `isLocallyTrusted(…, ctx)` holds or the caller has a login session. A
    caller that passes falls through to the normal anchors (`[cwd, ~/.pi]`),
    so a proofed editor still opens `config.json`, and `false` restores the
    old behaviour for this tier.
- **Race.**
  - Before open, check the target's realpath against the realpath'd dir.
  - After open, compare the handle's `fstat` (dev, ino) with a `stat` of each
    always-refused file. A symlink swapped in between check and open is
    caught for that tier.
  - The trust-gated tier keeps only the pre-open check; its residual race is
    documented.
  - This does **not** reuse `verified-read`, which is grant-only and would
    regress in-scope symlink reads.
- **No prompts.** A `needsLocalProof` caller's containment miss is not
  prompt-eligible (MODIFIED `file-read-containment` "A containment miss may
  suspend…"). Containment is otherwise caller-independent, and the widening
  requirement is MODIFIED to record the state-dir check as its only
  caller-dependent step.

### D9 — Tests run under the new default

- No global `requireLocalProof:false` in test setup.
- The first apply task flips the default and runs the full suite. Each
  failure is triaged:
  - an admission-semantics test states its mode with `setTrustConfig`;
  - other tests send proof via `stampedHeaders` / `stampLegacyHook`
    (`test-support/local-credential-stamp.ts:22-29`).
- The E16 matrix asserts `undefined → true`, `false → false`, and
  `"yes"`/`"false"` → `true` plus a warning.

### D10 — Browser relay gets a single-use relay ticket (owner decision)

- `WsRouteRegistration` gains an optional `peerCredential: "plugin"`. For
  such scopes the core gate (`server.ts:4594`) skips only the strict proof
  requirement; host, origin and genuinely-local checks still apply. Other
  plugin scopes need proof under the default (MODIFIED `plugin-ws-route`).
- **Minting.** The browser plugin mints a relay ticket per issued URL:
  - 32 random bytes;
  - 60 s TTL;
  - bound to (guid, role `ext`|`cdp`);
  - consumed by the first upgrade attempt;
  - in memory only, never logged.

  It is appended as `?ticket=` to `cdpUrl` (`relay-manager.ts:442, 643, 1061`)
  and to `mcpRelayUrl` (`connect.ts:48-51`). `handleUpgrade` verifies it
  before `manager.resolve` (MODIFIED `browser-relay`; the plugin's own
  ticket, not `/api/ws-ticket`).
- URLs are issued only to callers the dashboard already admitted
  (`POST /api/browser/connect` is non-observe, so it needs proof).
- **Reconnect.** A client reconnecting needs a fresh URL from `connect`.
  Task 6.1 spikes whether `agent-browser connect`, Playwright
  `connectOverCDP` and the pinned extension preserve a query string and
  whether they reconnect silently. If any of them fails,
  `SHIP_IT_BLOCKED.md` hands the decision back to planning.
- *Alternatives:* a bare-loopback carve-out (owner rejected); accepting the
  break (owner rejected).

### D11 — One-shot rotation of possibly-leaked secrets (owner decision)

- At server start, before `server.ts:734` reads the token, run
  `rotateSecretsOnce()` under an exclusive `local/rotation.lock`:
  - link-claimed;
  - stale after 30 s or a dead pid;
  - wait capped at 35 s.

  This is the lock design `close-loopback-legacy-window` D4 specifies, built
  here first and shared.
- If `local/rotation-epoch` is below `REQUIRED_ROTATION_EPOCH = 1`:
  - write a new local token (0600, atomic);
  - replace `auth.secret` through `writeConfigFileSecure`;
  - then write the epoch.

  The server then derives verifiers and the proof key from the new values.
- Effects:
  - every session JWT and OAuth state cookie stops validating (one logout);
  - every `pi_dash_local` cookie stops validating (its key derives from the
    token);
  - CLI, bridge, Electron and `reload-all.sh` re-read the token per use and
    follow automatically.
- A still-running older instance on the same HOME keeps its in-memory token
  until it restarts. This is covered by the "stop every instance before
  upgrading" CHANGELOG step (same as legacy-window D5).
- **Coordination.** `close-loopback-legacy-window` reuses the lock and moves
  its epoch to 2 (D7).
- **Failure is closed** (owner decision). If the lock wait times out or any
  write fails, the server exits 1 before listening. It logs one line naming
  the failed step and the lock and epoch paths. The epoch is written last, so
  the next start retries the whole rotation; a second token rotation is
  harmless.
- **Rollback.** Delete `local/rotation-epoch` only to force another rotation.
  Rotating is never undone.

### D12 — Proof cookie bound to its port and short-lived (owner decision)

- `pi_dash_local` = `id.issuedAt.lastUse.port.HMAC(k_local, …)` (field order
  fixed in code). The server rejects a cookie whose port differs from its
  own listening port.
- Idle expiry is 12 h. An admitted request that is more than 1 h past
  `lastUse` gets a re-signed cookie (sliding). The absolute cap is 30 days
  from `issuedAt`.
- Residual (owner-accepted, FAQ):
  - browsers send the cookie to every `localhost:<port>` site, so a local web
    app can capture it and replay it to the right port within the idle
    window;
  - the follow-up is a dedicated loopback host (`pi-dashboard.localhost`).

## Risks / Trade-offs

- **[Risk] Plain `localhost` tabs are locked out.** This includes users who
  reach the dashboard through `ssh -L`, VS Code port forwarding or WSL; they
  arrive as bare loopback. → Mitigation:
  - D3 remedy;
  - `pi-dashboard open --print` with a **same-port** forward (the code URL is
    port-bound);
  - CHANGELOG BREAKING and the FAQ name this group;
  - opt-out.
- **[Risk] A local caller is missed.** → Mitigation: the D5 sweep, the qa/e2e
  run under the default, and the D6 log.
- **[Risk] An older `pi-dashboard` on PATH** starts a server on `api`. →
  Mitigation: D4 going forward, the minimum version in docs, and task 5.6
  checks dev-checkout resolution.
- **[Trade-off, accepted] Observe reads.** Containers still read observe-tier
  data: transcripts, session lists, and files in session cwds and under
  `~/.pi` outside the dashboard dir, such as `~/.pi/agent/auth.json`. A
  `$HOME`-cwd session also exposes `~/.ssh`. They can also spend `/v1/*`.
- **[Risk] Relay clients drop the ticket query or reconnect with a stale URL.**
  → Mitigation: task 6.1 spike first; `SHIP_IT_BLOCKED` if it fails.
- **[Risk] Rotation logs everyone out once.** A second instance on the same
  HOME refuses clients until it restarts. → Mitigation: CHANGELOG step "stop
  every instance before upgrading"; the lock keeps it to one rotation.
- **[Trade-off, accepted] Proof cookie leaks to other localhost sites** (D12).
- **[Trade-off, accepted] Leaked live-capability URL** (D2).
- **[Trade-off, accepted] Token mounted into a container.** A container that
  mounts `~/.pi` or `$HOME` can mint proofs. No loopback fix covers
  credential possession. The FAQ warns.
- **[Trade-off, out of scope] Bridge gateway grace.** While TCP is enabled
  (always on Windows), a container can register a fake bridge. It can receive
  prompts addressed to that fake session, but gains no host execution. Owned
  by `close-loopback-legacy-window`.
- **[Trade-off, out of scope] Recovery server.** Admits a spoofed loopback
  Host while the main server is down.
- **[Trade-off] Cookie bootstrapped twice** (at the 1.0.0 rotation).

## Migration Plan

1. Ship in the next `0.9.x` minor. Steps for users:
   - stop every dashboard instance before upgrading;
   - expect the first start to rotate the local token and `auth.secret`, so
     everyone signs in again once.

   The CHANGELOG `[Unreleased]` BREAKING entry covers:
   - the default posture;
   - forwarded-loopback users;
   - the remedy;
   - `pi-dashboard api`;
   - the D8 refusals;
   - the opt-out and its container warning.
2. No data or schema migration; an explicit boolean is respected.
3. Electron, CLI, bridge and `npm run reload` need no action. Plain tabs
   run `pi-dashboard open` once (the cookie lasts 30 days).
4. Rollback: `"requireLocalProof": false` (live), or revert. The D8
   always-refused tier stays.

## Open Questions

- None that change specs or tasks.
- `qr-device-pairing` needs no delta: approval ignores bare loopback in every
  mode (`openspec/specs/qr-device-pairing/spec.md:85-93`). Its "Bare loopback
  cannot approve" scenario (`:161-162`) reads "disabled" as explicit `false`
  and stays true.
