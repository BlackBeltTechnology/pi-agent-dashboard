# Remediation Tasks

Ordered by leverage. The systemic fixes (S1–S3) each close several findings.
The standalone bugs (B*) are independent. This audit **records and routes**.
Each behaviour-changing fix lands in its own reviewed OpenSpec change.

**Tick rule** (proposal `## Remediation Ownership`): `[x]` means **routed**, not
fixed. Every ticked line carries exactly one status:

- **Closed by `<change>`**: fixed in code, delivered by that archived change.
- **Owner assigned → `<change>` (fix open)**: an active change owns the fix, and
  its proposal names the ID.
- **Split**: the fixed part is Closed, and the residual has its own ID and owner.
- **No gap (verified)**: re-checked against code and found not exploitable, with evidence.

An unticked finding line has no owner. The rule applies to finding lines. The V1–V5 lines
are audit-procedure checks; their tick means "verification done". Line citations in the original task text are from
the audit (2026-07-16) and may have drifted. Owners' proposals carry current
citations. Reconciled against code on 2026-10-17.

## Tier 0 — Do first (highest blast radius, cheapest fix)

- [x] **S1 · Universal auth guard.** Split: closed by `add-universal-network-guard` (root `onRequest` hook). Per-plugin cwd allowlists, which that change deferred here, plus the "routes registered after `ready()` are unguarded" caveat → S1r: owner assigned → `close-residual-audit-findings` (fix open). Make `networkGuard` (or an auth-independent equivalent) apply to ALL surfaces, not just core routes:
  - [x] Attach to plugin route registrars: expose `networkGuard` on `ServerPluginContext`; gate automation/flows/kb mutating+exec+file routes (closes C-🔴, C-🟠×2, C-🟡). Split: the unauthenticated-access half is closed by `add-universal-network-guard` (root `onRequest` hook over `/api/`). The cwd half → S1r.
  - [x] Attach to provider-auth + models-introspection routes (closes A-🟠 provider-auth). Closed by `add-universal-network-guard`.
  - [x] Run the guard as an auth-independent `onRequest`, so disabling OAuth never removes it. Closed by `add-universal-network-guard`.
- [x] **S2 · Authenticate the bridge↔server WebSocket.** Split: core closed by `add-pi-gateway-transport-identity` + `loopback-credential-proof` (gateway `verifyClient`, single-use ticket, `127.0.0.1` default bind). Residual S2r (tokenless loopback grace, legacy raw token): owner assigned → `close-loopback-legacy-window` (fix open). The mDNS server-impersonation part of "mitigates D-🟠 mDNS" → R4. Original scope (closes D-🔴×2, mitigates D-🟠 mDNS): mint per-server secret, require bridge to present it on the gateway handshake, server rejects unauthenticated gateway sockets, bind gateway to `127.0.0.1`. Verify zrok does NOT tunnel `piPort` (V2: not tunneled).
- [x] **S3 · Close the client XSS trio.** Split: markdown / AsciiDoc / mermaid XSS closed by `sanitize-untrusted-rendered-content`. Strict-CSP residual → S3b. Original scope (closes F-🔴 markdown, F-🔴 asciidoc, F-🟠 mermaid; de-risks F-🔴 localStorage bearer): `rehype-sanitize` + scheme-allowlist `urlTransform` in MarkdownContent; DOMPurify the asciidoctor + mermaid HTML server-side; strict CSP (`script-src 'self'`) for the tunnel/cross-origin case.
- [x] **S3b · Enforce a strict CSP** (`auth/csp.ts` is report-only and allows `'unsafe-inline'`/`'unsafe-eval'`). Owner assigned → `close-residual-audit-findings` (fix open).

## Tier 1 — High, standalone

- [x] **B1 · git checkout command injection.** Split: shell injection closed by `fix-git-checkout-command-injection` (argv `run(["git","checkout",…])`). Option-injection residual (no branch validation, no `--end-of-options`) → B1r: owner assigned → `close-residual-audit-findings` (fix open). 🔴
- [x] **B2 · Electron remote-mode preload isolation.** Minimal preload for the main window; validate `event.senderFrame` in every `ipcMain.handle`. Also covers the E-🟡 `server.log` tail to any renderer. Closed by `harden-electron-renderer-boundary`. 🔴
- [x] **B3 · Electron `shell.openExternal` scheme allowlist.** http/https/mailto only, on BOTH `setWindowOpenHandler` and the `will-navigate` open-external branch. Closed by `harden-electron-renderer-boundary`. 🔴

## Tier 2 — Medium

- [x] **B4 · REST bearer storage.** Split: same-origin closed by `harden-trust-and-credential-boundaries` (httpOnly `pi_dash_device` cookie). Cross-origin residual → B4r: owner assigned → `close-residual-audit-findings` (fix open). 🟠
- [x] **B5 · Login OAuth CSRF + open redirect.** Bind the state nonce to a signed cookie; constrain `returnUrl` to same-origin relative. Closed by `harden-trust-and-credential-boundaries`. 🟠
- [x] **B6 · Windows `shellEscape` bypass.** Replace the `execSync(args.map(shellEscape))` sites with spawn argv `shell:false` (git-operations.ts). Closed by `fix-git-checkout-command-injection`. 🟠
- [x] **B7 · Unbounded PTY spawn.** Cap concurrent PTYs global + per-cwd, reap idle (terminal-manager.ts). Owner assigned → `harden-server-capability-bounds` (fix open). 🟠
- [x] **B8 · Unconstrained browse/mkdir.** Constrain roots to `$HOME` + pinned dirs (routes/file-routes.ts). Owner assigned → `harden-server-capability-bounds` (fix open). 🟠
- [x] **B9 · Recovery server.** Bind loopback; gate POST reinstall/retry on local-token (recovery-server.ts). Owner assigned → `harden-server-capability-bounds` (fix open). 🟠
- [x] **B10 · Electron SSRF probe.** Restrict to the wizard window; deny RFC1918 + link-local + loopback (remote-probe.ts). Closed by `harden-electron-renderer-boundary`, which narrowed the scope by design: loopback/RFC1918 stay allowed for the LAN remote-connect use case; link-local + unspecified are denied; DNS rebinding and unvalidated redirects are accepted residuals, with rationale, in the owner change (`packages/electron/src/lib/remote-probe.ts:12-21`). 🟠
- [x] **B11 · document-converter bind-mounts.** `:ro` inputs, confined under the workspace root, sensitive roots rejected (engine.ts). Closed by `harden-untrusted-content-ingestion`. 🟠
- [x] **B12 · kb source SSRF.** https-only, private/link-local blocked after DNS resolve, redirects capped (kb/sources.ts). Also closes cluster-G "unbounded fetch body + no timeout" (`net-guard.ts` byte cap + timeout). Closed by `harden-untrusted-content-ingestion`. 🟠
- [x] **B13 · kb archive zip-slip.** Reject `..`/absolute entries via a traversal-safe extractor (kb/sources.ts). Closed by `harden-untrusted-content-ingestion`. 🟠
- [x] **B14 · Bare-loopback trust under a marker-less tunnel.** Split: opt-in strict `requireLocalProof` closed by `harden-trust-and-credential-boundaries`. Default-off residual (bare loopback still trusted for terminal/session/git) → B14r: owner assigned → `close-residual-audit-findings` (fix open). 🟠
- [x] **B15 · plugin_emit_event allowlist.** Split: server-side reserved-prefix denylist closed by `harden-trust-and-credential-boundaries`. `emits` is enforced only inside the automation engine. Generic-path allowlist residual → B15r: owner assigned → `close-residual-audit-findings` (fix open). 🟠

## Tier 3 — Low / hardening

- [x] B16 cookie Secure flag behind a TLS tunnel (auth-plugin.ts). Split: `secure` on an https base URL closed by `harden-trust-and-credential-boundaries` (commit `27d6391e7`, PR #808). Request-TLS residual → B16r: owner assigned → `close-residual-audit-findings` (fix open).
- [x] B17 pin JWT `algorithms:["HS256"]`; 256-bit HMAC secret (auth.ts). Owner assigned → `close-residual-audit-findings` (fix open).
- [x] B18 auth audit logging: pairing approve/revoke, credential writes. Owner assigned → `close-residual-audit-findings` (fix open; deny/approve logging already exists).
- [x] B19 narrow CORS `*.share.zrok.io` to the active tunnel host (cors-origin.ts). The `pi-dashboard.dev` half of the register item: no gap (verified). It is the neutral PWA shell, a standing spec'd allowance (`server-cors`; `cors-origin.ts:162`). zrok half: owner assigned → `close-residual-audit-findings` (fix open; admission path already narrowed).
- [x] B20 redact absolute paths / git stderr in error bodies (git-operations.ts). Owner assigned → `close-residual-audit-findings` (fix open; `fix-git-checkout-command-injection` put it out of scope).
- [x] B21 clamp `quiesceMs`; rate-limit inbound bridge bash/prompt (bridge.ts). Owner assigned → `close-residual-audit-findings` (fix open).
- [x] B22 strip `userinfo@` from git remote URLs before link-building (vcs-info.ts / git-link-builder.ts). Verify-first: no credential-bearing link is built today (exact-host `detectPlatform`). Owner assigned → `close-residual-audit-findings` (fix open).
- [x] B23 enforce `MAX_AUDIO_MB`; guard positional media args (ffmpeg/ffprobe in video-transcription + video-production, nano-banana). Owner assigned → `close-residual-audit-findings` (fix open).
- [x] B24 doctor.html href scheme allowlist; argv call in dependency-detector.ts:91. Owner assigned → `close-residual-audit-findings` (fix open).

## Register items never tasked before 2026-10-17

- [x] R1 terminal cwd unconstrained (`browser-handlers/terminal-handler.ts`; out of scope for `harden-server-capability-bounds`). Owner assigned → `close-residual-audit-findings` (fix open).
- [x] R2 tunnel-URL origin normalization (cors-origin.ts, cluster A 🔵). Owner assigned → `close-residual-audit-findings` (fix open).
- [x] R3 pi-core-updater npm version/spec args server-derived (cluster B 🔵). No gap (verified): `routes/pi-core-routes.ts:67-87` resolves requested names against the server-derived status list (unknown names → 400), and the spec is `${pkg.name}@latest` (`pi/pi-core-updater.ts:91`).
- [x] R4 mDNS discovery → connection redirect (cluster D 🟠, `bridge.ts`, `server-auto-start.ts`). Partly controlled by `fix-bridge-mdns-migration-hijack` (health-check gate) and `stabilize-mdns-server-identity` (fingerprint + pin-after-proof). Verify-first for unpinned bridges: owner assigned → `close-residual-audit-findings` (fix open).
- [x] R5 "bash output crosses the tunnel" note (cluster D). Owner assigned → `close-residual-audit-findings` via B22's tunnel-exposure review (fix open: document or redact).

## Verify / follow-up (RESOLVED)

- [x] V1 → **CONFIRMED**: `config.json` (auth HMAC secret) NOT 0600 → B25.
- [x] V2 → **RESOLVED**: bridge `piPort` NOT tunneled (separate listener on `config.host`); D-🔴 re-scoped to same-host/LAN-only.
- [x] V3 → **RESOLVED**: Electron 32.3.3, sandbox default true.
- [x] V4 → **CONFIRMED**: asciidoctor secure mode doesn't strip passthrough → S3 asciidoc fix.
- [x] V5 → **CONFIRMED**: 20 vulns (2 crit/3 high/15 mod); `xlsx` high reachable → B26. Postinstall scripts benign (first-party).

## Added by verification

- [x] **B25 · chmod `0600` on config.json write** (`writeConfigFileSecure`, `packages/shared/src/config.ts`). Closed by `harden-trust-and-credential-boundaries`. 🟠
- [x] **B26 · `xlsx`/SheetJS high vuln** reachable via the XLSX office preview. Split: CDN pin (`xlsx` 0.20.3) closed by `harden-untrusted-content-ingestion`. Advisory-clearance check + triage of the other transitive advisories → B26r: owner assigned → `close-residual-audit-findings` (fix open). 🟠

## Archive-time verification (test-plan)

All rows are manual register-integrity checks (no product code to test). `ship-change` defers them to the archive step.

- [ ] T-E1 Verify every "Closed by" claim: owner archive dir exists and the fix is in current code. Input: all Closed lines + Closed halves of Split lines · trigger: `ls openspec/changes/archive/*-<change>` + grep the cited symbol · observable: 0 missing dirs, 0 absent fixes (test-plan #E1, test-plan: manual-only)
- [ ] T-E2 Verify routed IDs ⊆ owner `Closes` lines for `close-residual-audit-findings` (20 IDs), `harden-server-capability-bounds` (B7–B9), `close-loopback-legacy-window` (S2r). Input: routed sets · trigger: grep each owner proposal · observable: set difference = ∅ (test-plan #E2, test-plan: manual-only)
- [ ] T-E3 Verify the proposal owner table and the `tasks.md` statuses agree. Input: both files · trigger: compare ID→owner · observable: identical mapping, no ID with two owners (test-plan #E3, test-plan: manual-only)
- [ ] T-E4 Verify no finding was dropped. Input: every `audit-findings.md` bullet (A–G, cross-cutting, V1–V5) · trigger: map each to a task ID · observable: 0 unmapped (test-plan #E4, test-plan: manual-only)
- [ ] T-E5 Re-check the No-gap claims (R3, B19 `pi-dashboard.dev`). Input: cited evidence lines · trigger: re-read them · observable: still non-exploitable, else re-route as a residual (test-plan #E5, test-plan: manual-only)
- [ ] T-X1 Verify every "Owner assigned" target still exists (active, or archived, and not superseded). Input: owner names · trigger: `ls openspec/changes/<owner>` at archive time · observable: all present, else untick + re-route (test-plan #X1, test-plan: manual-only)
- [ ] T-X2 Verify the close-out boundary. Input: `tasks.md` · trigger: `openspec status --change security-boundary-audit --json` vs `grep -c` · observable: counts match; any unticked finding line blocks the archive (test-plan #X2, test-plan: manual-only)
- [ ] T-X3 Verify `skip_specs: true` is load-bearing. Input: no `specs/` dir · trigger: `openspec validate security-boundary-audit` · observable: valid; without the key → "at least one delta" error (test-plan #X3, test-plan: manual-only)
- [ ] T-X4 Verify every Split residual is owned. Input: Split lines S1 S2 S3 B1 B4 B14 B15 B16 B26 · trigger: find the residual ID in the owner's `Closes` · observable: 0 unowned residuals (test-plan #X4, test-plan: manual-only)
