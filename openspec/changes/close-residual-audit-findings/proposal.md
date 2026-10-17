## Why

`security-boundary-audit` routes every finding to an owner change. After the
2026-10-17 reconciliation, one set had no owner: the Tier-3 findings (B17–B24),
the residuals of earlier partial fixes (S1r, B1r, B4r, B14r, B15r, B16r,
B26r), the strict-CSP part of S3 (S3b), and register items that never got a
task (R1, R2, R4, R5).

This change owns all of them, so the audit can close. Severity is mixed. Most
items are small and local, but **B14** (a default change) and **S3b** (CSP
enforcement) affect compatibility and need real design.

This is a scoped stub. Scope is fixed here. `design.md`, spec deltas,
`test-plan.md` and `tasks.md` are written when the change is planned with
`plan-proposal`. Until then `openspec validate` reports "no deltas". That is
expected for a stub; planning adds the deltas listed under Capabilities.

Code status was verified against the working tree on 2026-10-17. Each gap cites
its current location.

## What Changes

### Tier-3 findings

- **B17 · JWT hardening.** Pin `jwt.verify(token, secret, { algorithms: ["HS256"] })`
  (`packages/server/src/auth/auth.ts:179-181`). Mint new HMAC secrets at 32 bytes,
  not 16 (`auth.ts:142`). Design MUST decide what happens to existing 16-byte
  secrets: rotate on upgrade, which invalidates sessions, or accept them with a
  stated rationale. B17 closes only with that decision recorded.
- **B18 · Auth audit logging (residual).** Pairing deny / lockout / approve
  already log (`pairing/pairing.ts:548-610`). Add audit lines for device revoke
  (`pairing/paired-devices.ts`) and for provider-credential writes
  (`routes/provider-auth-routes.ts` → `auth/provider-auth-storage.ts`). Lines carry
  the device id or actor and the source IP, never the secret.
- **B19 · Narrow the zrok CORS read path.** `auth/cors-origin.ts:156` admits any
  `*.share.zrok.io` origin on the read path (`allowZrokWildcard !== false`).
  Admission (`:259`) is already narrowed. Narrow the read path to the active
  tunnel host. Needs a MODIFIED delta on `server-cors`: its spec keeps the
  blanket zrok match "untouched" (`openspec/specs/server-cors/spec.md:105-112`).
- **B21 · Bridge inbound bounds.** Put an upper bound on `quiesceMs` before
  `pauseAutoStart(quiesceMs)` (`packages/extension/src/bridge-handlers/dispatch.ts:82-84`).
  The bound MUST stay at or above every quiesce value the server sends today.
  `server-restart` requires a pause of "at least `quiesceMs`"
  (`openspec/specs/server-restart/spec.md:28`), so the delta defines the bound
  without weakening that floor. Rate-limit inbound `send_prompt` / bash
  dispatch. Today only `SubagentTickThrottle` exists (`bridge.ts:433`). Design
  inventories every `quiesceMs` the server sends, sets the bound above the
  largest, and sets measured rate-limit thresholds.
- **B22 · Remote userinfo (verify first).** The HTTPS branch of
  `parseRemoteUrl` (`packages/extension/src/git-link-builder.ts:40-42`) captures
  `user:pass@host` as the host. `detectPlatform` is an exact-host lookup
  (`:53-54`), so `buildGitLinks` returns `{}` and no credential-bearing link is
  built today. Confirm that the raw `remoteUrl` (`vcs-info.ts:159-170`) never
  reaches the server or client. Then strip userinfo in `parseRemoteUrl` anyway,
  so such remotes get correct links. Record the result.
- **R5 · Bash output over the tunnel.** Bash tool output reaches remote
  (tunnel) viewers by design. Decide between documenting this in the
  remote-access security notes and redacting known secret patterns. Record the
  decision.
- **B23 · Media tool argument safety.** Enforce `maxAudioMb`
  (`packages/video-transcription/src/config.ts:184`, parsed but never read)
  before extract/upload, with a `video-transcription` spec delta (the spec
  covers it as config only). In `nano-banana/src/nano-banana.ts:93` `buildArgs`,
  `opts.prompt` is the first positional argument, so a prompt that starts with
  `-` parses as a flag. Guard it. `video-transcription/src/ffmpeg.ts:82`
  (`args.push("-y", output)`) and its `ffprobe` call (`:98+`) take positional
  media paths. Guard them the same way. `video-production/src/render.ts:127`
  (`extractLastFrame`): no confirmed gap, since the input sits behind `-i`.
  Verify the output-path position and record the result.
- **B24 · Electron residuals.** Allow only `http`/`https` in the markdown link
  replacer at `packages/electron/src/renderer/doctor.html:95`, and escape the
  href. Replace the interpolated `execSync(\`"${base.path}" --version\`)`
  (`packages/electron/src/lib/dependency-detector.ts:91`) with an argv call.
  Windows trap: detection prefers `.cmd`/`.bat` shims
  (`openspec/specs/electron-shell/spec.md`), and a plain
  `execFileSync(path, ["--version"])` cannot run a `.cmd`. Reuse the shared
  safe-spawn wrapper (`buildSafeArgv`, `shared/platform/exec.js`).

- **B20 · Redact error bodies.** Git error paths return raw stderr, e.g.
  `GitCommitError(..., staged.stderr.trim())`
  (`packages/server/src/git-worktree/git-operations.ts:328,333,357`), and the
  routes echo `err.message` to the client (`routes/git-routes.ts:188,210,228,314`).
  Redact absolute paths and remote URLs before they reach a response body.
  `fix-git-checkout-command-injection` put this out of scope.

### Residuals of earlier partial fixes

- **S1r · Plugin cwd allowlists + hot-load caveat.** `add-universal-network-guard`
  deferred per-plugin cwd hardening to the audit
  (`archive/2026-09-19-add-universal-network-guard/proposal.md:80-83`). The
  automation plugin still takes `body.cwd` verbatim as its scope base
  (`packages/automation-plugin/src/server/routes.ts:36-37`, `/create` `:262`).
  The flows plugin's `/flow-inputs` uses `q.cwd ?? process.cwd()`
  (`packages/flows-plugin/src/server/index.ts:66-68`). Validate
  cwd against known + pinned dirs. Also record the guard caveat: routes
  registered after `ready()` are not covered (`packages/server/src/server.ts`
  ~3004-3006), so any future plugin hot-load must re-guard.
- **B1r · git option injection.** `checkoutBranch` now uses argv
  (`packages/server/src/git-worktree/git-operations.ts:512-520`), but the branch
  is still unvalidated. `routes/git-routes.ts:198` checks only that it is truthy.
  Reject a leading `-` and/or pass `--end-of-options` before the ref.
- **B4r · Cross-origin bearer storage.** Same-origin browsers no longer keep the
  durable bearer in `localStorage` (`packages/client/src/lib/pairing/device-auth.ts:16-20`).
  Cross-origin API bases still do (`:20`). No cookie crosses origins, so the
  options are a short-lived, rotated bearer, or same-origin proxying of the API
  base.
- **B14r · Bare-loopback trust default.** Strict `requireLocalProof` exists but
  defaults to `false` (`packages/shared/src/config.ts:1402`), so
  `localhost-guard.ts:91-98` trusts bare loopback for terminal / session / git.
  Design decides between flipping the default and a narrower gate on those
  route tiers. Compatibility-affecting. Shared state with
  `close-loopback-legacy-window`, which rotates the local token and retires the
  bridge loopback grace (S2r). Design MUST fix the order: no default flip before
  that rotation lands, or a documented reason why the order does not matter.
  Flipping the default contradicts `trust-and-credential-boundaries`
  ("requireLocalProof is unset … loopback request with no credential",
  `openspec/specs/trust-and-credential-boundaries/spec.md:54`) and possibly
  `bearer-device-auth` "Genuine-local trust via IPC allowlist" (`spec.md:130`).
  Planning MUST add MODIFIED deltas for both.
- **B15r · Plugin event allowlist.** The bridge forwards any non-empty
  `eventType` (`packages/extension/src/bridge-handlers/dispatch.ts:326-331`). The
  server refuses only reserved prefixes (`packages/server/src/plugin-event-seam.ts:20-23`).
  The per-plugin `emits` list is enforced only inside the automation engine
  (`packages/automation-plugin/src/server/engine.ts:128`). Enforce it on the
  generic bridge → server path.
- **B16r · Cookie `Secure` behind a TLS tunnel.** `secure` is keyed on the
  configured base URL (`packages/server/src/auth/auth-plugin.ts:296-298,315-317`),
  not on request TLS. Behind an https tunnel with an http base, it stays off.
  The fix MUST NOT enable Fastify `trustProxy`. The code deliberately avoids it,
  because forwarded headers would drive `request.ip` (`auth-plugin.ts:302-309`).
  Key `Secure` on a server-known https origin instead, e.g. the active tunnel's
  public URL.
- **B26r · Residual advisory triage.** The `xlsx` high is mitigated by the CDN
  pin (`packages/server/package.json:110`). Check that pinned 0.20.3 clears the
  advisories, and that the lockfile records an integrity hash for the vendor
  tarball, which is a new remote trust root. Triage the remaining transitive `npm audit` advisories as
  reachable / build-only / accepted, each with a reason, in
  `openspec/changes/close-residual-audit-findings/advisory-triage.md`.

### Split from S3, plus never-tasked register items

- **S3b · Enforce a strict CSP.** `packages/server/src/auth/csp.ts:36` ships
  report-only and keeps `'unsafe-inline'` / `'unsafe-eval'` in `script-src`.
  `sanitize-untrusted-rendered-content` put enforcement out of scope. Highest-risk
  item: enforcing can break Vite dev, inline bootstrap, and plugin bundles. Needs
  a MODIFIED delta on `baseline-content-security-policy`, whose spec mandates the
  current `script-src` (`openspec/specs/baseline-content-security-policy/spec.md:50-60`).
  The rollback switch already exists: `PI_DASHBOARD_CSP=report|enforce|off`
  (`csp.ts:8-10`). Design MUST plan a report-only soak before the default moves.
- **R1 · Terminal cwd.** `packages/server/src/browser-handlers/terminal-handler.ts:52,73`
  spawns at `msg.cwd` unchecked. Validate it against known + pinned dirs.
  `harden-server-capability-bounds` declares this out of scope.
- **R2 · Tunnel-URL origin normalization.** The register flags tunnel-URL
  normalization in `auth/cors-origin.ts` (`:59` at audit time). Compare
  case-, port- and trailing-dot-normalized origins against the active tunnel
  URL, and add tests for each variant.
- **R4 · mDNS server impersonation (verify first).** A same-host process can
  advertise `_pi-dashboard._tcp`. Existing controls: a health-check gate before
  migration (`fix-bridge-mdns-migration-hijack`); an identity fingerprint in the
  advert plus pin-after-proof (`stabilize-mdns-server-identity`,
  `packages/extension/src/server-pin-store.ts`,
  `remote-registration-gate.ts`); and a local-token counter-proof on loopback
  dials (`bridge.ts:1243-1248`). Verify whether an unmarked or unpinned bridge
  can still be redirected to a rogue server. Close the gap if it can, or record
  "no gap" with evidence.

## Capabilities

Confirm against `openspec/specs/` at planning time. Known deltas:
`baseline-content-security-policy` (S3b), `bearer-device-auth` (B14r, check), `server-cors`
(B19, R2), `cross-site-request-gate` and `live-server-preview` (share
`cors-origin.ts` with B19/R2: check for collateral), `server-restart` (B21),
`video-transcription` (B23), `trust-and-credential-boundaries` /
`trusted-networks` (B14r), `electron-shell` (B24). Likely more: auth/JWT, CSP,
plugin events, git ops, terminal, bridge discovery (R4).

## Impact

- Server: `auth/{auth,auth-plugin,cors-origin,csp,localhost-guard}.ts`,
  `pairing/paired-devices.ts`, `plugin-event-seam.ts`, `git-worktree/git-operations.ts`,
  `routes/git-routes.ts`, `routes/provider-auth-routes.ts`, `browser-handlers/terminal-handler.ts`.
- Extension: `bridge-handlers/dispatch.ts`, `bridge.ts`, `git-link-builder.ts`,
  `server-auto-start.ts` / discovery (R4). Plugins also: `automation-plugin`,
  `flows-plugin` (S1r).
- Client: `lib/pairing/device-auth.ts`. Shared: `config.ts` (B14r default).
- Plugins: `video-transcription`, `video-production`, `nano-banana`. Electron:
  `renderer/doctor.html`, `lib/dependency-detector.ts`.
- **Overlaps with active changes.** Sequence or coordinate with each:
  - `retire-trusted-networks-bypass` changes `trusted-networks` pair-mode auth (B14r).
  - `add-plugin-capability-routes` touches `localhost-guard.ts`, `auth-plugin.ts`
    and the baseline CSP (B14r, B16r, S1r, S3b).
  - `extract-git-as-plugin` relocates `git-link-builder.ts` (B22).
  - `add-plugin-isolation-and-public-routes` edits `cors-origin.ts` and the
    network guard (B19, R2).
  - `add-srt-translation-pass` refactors `video-transcription/src/config.ts` (B23).
  - `raise-node-floor-to-26` touches `dependency-detector.ts` (B24).
  - `close-loopback-legacy-window` covers loopback trust (B14r).
- **Compatibility:**
  - B17 alg pin: the server only mints HS256, so current tokens keep working.
    Secret rotation, if chosen, logs everyone out.
  - B14r and S3b: can break existing local workflows and bundles.
  - B19: can break a stale second zrok frontend.
  - B21: limits must never throttle normal interactive use.
- **Rollback:** each item is an independent local revert. S3b and B14r ship
  behind config switches (report-only CSP mode; the `requireLocalProof` flag),
  so rollback is a config change.
- **Closes (security-boundary-audit):** S1r, S3b, B1r, B4r, B14r, B15r, B16r,
  B17, B18, B19, B20, B21, B22, B23, B24, B26r, R1, R2, R4, R5.

## Discipline Skills

- `security-hardening` — every item hardens an auth, untrusted-input or exec
  boundary.
- `observability-instrumentation` — B18 adds auth audit log lines.
- `doubt-driven-review` — B17 rotation, B14r default, B19 narrowing and S3b
  enforcement are compatibility-affecting; review each before it stands.
- `performance-optimization` — B21 rate-limit thresholds need a measured
  interactive baseline.
