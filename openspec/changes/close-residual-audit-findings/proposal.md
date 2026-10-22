## Why

`security-boundary-audit` routes every finding to an owner change. After the
2026-10-17 reconciliation, one set had no owner: the Tier-3 findings (B17–B24),
the residuals of earlier partial fixes (S1r, B1r, B4r, B14r, B15r, B16r,
B26r), the strict-CSP part of S3 (S3b), and register items that never got a
task (R1, R2, R4, R5).

This change owns all of them, so the audit can close. Severity is mixed. Most
items are small and local, but **S3b** (CSP enforcement) and **B4r** (browser
bearer expiry) affect compatibility and need real design.

Planned with `plan-proposal`. The 19 items owned here stay in this one
change, which ships and archives once. B14r moved to
`close-container-loopback-impersonation` (user-confirmed). For S3b it ships
the instrumentation and the strict policy, with the CSP default staying
`report`; the flip to `enforce` moves to the follow-up change
`enforce-strict-csp-default`. Code status was first verified on
2026-10-17; several line references below have since moved. `design.md` carries
the re-verified citations and is authoritative where the two differ.

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
  without weakening that floor. The bound is enforced inside `pauseAutoStart`
  (`connection.ts:748-752`), so every caller is bounded. Rate-limit inbound
  `send_prompt` / bash dispatch and the other turn-starting commands
  (`flow_management` `run`, `plugin_emit_event`, `promote_followup_entry`;
  design D17). Today only `SubagentTickThrottle` exists (`bridge.ts:433`). Design
  inventories every `quiesceMs` the server sends, sets the bound above the
  largest, and sets measured rate-limit thresholds.
- **B22 · Remote userinfo (verify first).** The HTTPS branch of
  `parseRemoteUrl` (`packages/extension/src/git-link-builder.ts:40-42`) captures
  `user:pass@host` as the host. `detectPlatform` is an exact-host lookup
  (`:53-54`), so `buildGitLinks` returns `{}` and no credential-bearing link is
  built today. Verified at planning: the git-info path never carries the raw
  remote, but vault sync does. `vault_sync_request.origin` sends the raw
  `git remote get-url origin` (`vault-delivery.ts:273`) and the hub keeps it in
  memory (`vault-delivery-hub.ts:252`). Strip credentials in `parseRemoteUrl`
  and before the vault origin leaves the bridge: all userinfo for `http(s)`,
  the password only for `ssh://user:pass@host` (user kept). The hub strips
  again on receipt.
- **R5 · Bash output over the tunnel.** Bash tool output reaches remote
  (tunnel) viewers by design. Decided at planning: document it in the
  remote-access security notes; no pattern redaction (only vault values are
  masked, which stays).
- **B23 · Media tool argument safety.** Enforce `maxAudioMb`
  (`packages/video-transcription/src/config.ts:184`, parsed but never read)
  on the extracted audio, before upload, with a `video-transcription` spec delta (the spec
  covers it as config only). In `nano-banana/src/nano-banana.ts:93` `buildArgs`,
  `opts.prompt` is the first positional argument, so a prompt that starts with
  `-` parses as a flag. Pass it via `--prompt` (supported by the pinned
  `@the-focus-ai/nano-banana@1.0.10`). On Windows no arg ever reaches
  `cmd.exe`: npx's JS entry runs under node directly, else the run is refused.
  `video-transcription/src/ffmpeg.ts:82`
  (`args.push("-y", output)`) and its `ffprobe` call (`:98+`) take positional
  media paths, as do `audio-decode.ts` and the `voiceid.ts` runner. Every
  spawn site resolves them to absolute (design D21). `video-production/src/render.ts:127`
  (`extractLastFrame`): no confirmed gap, since the input sits behind `-i`.
  Verify the output-path position and record the result.
- **B24 · Electron residuals.** The `doctor.html` link replacer already allows
  only `http`/`https` (`packages/electron/src/renderer/doctor.html:101-105`,
  harden-client-sinks); keep it under a regression test. Residual: the doctor
  window gets `sandbox`, a window-open handler and a `will-navigate` guard
  (`lib/doctor-window.ts`). Replace the interpolated `execSync(\`"${base.path}" --version\`)`
  (`packages/electron/src/lib/dependency-detector.ts:91`) with an argv call.
  Decided at planning: node is never a `.cmd` shim, so the node version probe
  calls `execFileSync(path, ["--version"])` directly (no shell, no
  `buildSafeArgv`); see design D22. A node override pointing at a `.cmd` /
  `.ps1` shim is then reported not usable (accepted).

- **B20 · Redact error bodies.** Git error paths return raw stderr, e.g.
  `GitCommitError(..., staged.stderr.trim())`
  (`packages/server/src/git-worktree/git-operations.ts:328,333,357`), and the
  routes echo `err.message` to the client (`routes/git-routes.ts:188,210,228,314`).
  Redact absolute paths, URL userinfo and specific token shapes before they
  reach a response body; commit SHAs survive.
  `fix-git-checkout-command-injection` put this out of scope.

### Residuals of earlier partial fixes

- **S1r · Plugin cwd allowlists + hot-load caveat.** `add-universal-network-guard`
  deferred per-plugin cwd hardening to the audit
  (`archive/2026-09-19-add-universal-network-guard/proposal.md:80-83`). The
  automation plugin still takes `body.cwd` verbatim as its scope base
  (`packages/automation-plugin/src/server/routes.ts:36-37`, `/create` `:262`).
  The flows plugin's `/flow-inputs` uses `q.cwd ?? process.cwd()`
  (`packages/flows-plugin/src/server/index.ts:66-68`). Validate
  cwd against known + pinned dirs. The 12 generated MCP automation tools
  (`mcp-server-plugin/src/server/generated/tools.ts`) call these routes: their
  manifest marks `cwd` required for folder-scope tools, and a folder-scope call
  without cwd gets 400 `cwd_required`. Also record the guard caveat: routes
  registered after `ready()` are not covered (`packages/server/src/server.ts`
  ~3004-3006), so any future plugin hot-load must re-guard.
- **B1r · git option injection.** `checkoutBranch` now uses argv
  (`packages/server/src/git-worktree/git-operations.ts:512-520`), but the branch
  is still unvalidated. `routes/git-routes.ts:198` checks only that it is truthy.
  Reject a leading `-`, empty and control-character refs with 400
  `invalid_ref`, including derived and optional git arguments (validator only;
  no `--end-of-options`).
- **B4r · Cross-origin bearer storage.** Same-origin browsers no longer keep the
  durable bearer in `localStorage` (`packages/client/src/lib/pairing/device-auth.ts:16-20`).
  Cross-origin API bases still do (`:20`). No cookie crosses origins. Decided:
  a short-lived, rotated bearer for cross-origin browsers. The legacy global
  slot is discarded on both paths; the same-origin keep-failed path writes a
  per-origin slot. Rotation authenticates only by `Authorization: Bearer`
  (else 401 `bearer_required`); a legacy row without a browser-holder
  declaration gets 409 `holder_declaration_required` (design D5).
- **B14r · Bare-loopback trust default — moved.** Owned by
  `close-container-loopback-impersonation`, which flips the
  `requireLocalProof` default against a demonstrated container exploit. No
  B14r delta, task or rollback here.
- **B15r · Plugin event allowlist.** Plugin events flow server → bridge: a
  plugin calls `ctx.emitEventToSession`, the server seam refuses only reserved
  prefixes (`packages/server/src/plugin-event-seam.ts:11-25`), and the bridge
  relays any non-empty `eventType` (`packages/extension/src/bridge-handlers/dispatch.ts:326-332`).
  `emits` exists only on automation action registrations, enforced inside the
  automation engine (`packages/automation-plugin/src/server/engine.ts:128`).
  Add a static manifest `emits` field enforced at the server seam; automation
  passes through events its registered actions declare. For an
  `automation.action.<source>` key the provider plugin id must equal
  `<source>`, else the provide is refused and logged; `consumeAll` entries gain
  a `provider` field.
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
  Runtime-reachable bumps found at planning (fastify 5.12.1
  GHSA-p68q-wchp-6fh7 auth bypass, nodemailer, linkify-it) are carved out to
  the urgent standalone change `bump-runtime-security-advisories`; this change
  records them in the triage only.

### Split from S3, plus never-tasked register items

- **S3b · Strict CSP: instrumentation and policy.** `packages/server/src/auth/csp.ts:36` ships
  report-only and keeps `'unsafe-inline'` / `'unsafe-eval'` in `script-src`.
  `sanitize-untrusted-rendered-content` put enforcement out of scope. Highest-risk
  item: enforcing can break Vite dev, inline bootstrap, and plugin bundles. Needs
  a MODIFIED delta on `baseline-content-security-policy`, whose spec mandates the
  current `script-src` (`openspec/specs/baseline-content-security-policy/spec.md:50-60`).
  The rollback switch already exists: `PI_DASHBOARD_CSP=report|enforce|off`
  (`csp.ts:8-10`). This change builds the baseline report sink and a persisted
  violation counter (with reset and a `dropped` count), and ships the strict
  nonce policy as a second Report-Only header. Trusted Types already shipped
  (`harden-client-sinks`); its existing header keeps every carve-out and only
  gains a report endpoint (label `trusted-types`). The new counter's reset is
  `POST /api/csp-reports/reset` and its health key `cspReports`; the existing
  `/api/csp-violations` client counters are untouched. Vite dev emits no
  strict header. `enforce` becomes the strict
  policy enforced, opt-in. **The default stays `report`.** The soak gate and
  the default flip to `enforce` move to the follow-up change
  `enforce-strict-csp-default`, which is `blocked_by` this one.
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
  can still be redirected to a rogue server. Decided: counter-proof on every
  loopback `ws:`/`wss:` dial when the local token exists (`ws+unix:` exempt);
  the device bearer goes only to a pinned endpoint (exact `host:port` match with
  the configured endpoint or a pin's `lastEndpoint`), gated at the ticket-mint
  call site, else refused with cause `unpinned_discovered_host`.

## Capabilities

### Modified Capabilities

- `oauth-authentication` (B17, B16r, S3b sink public path)
- `trust-and-credential-boundaries` (B4r, B18)
- `bearer-device-auth` (B4r, B16r; route→tier entries for the rotate and CSP
  report reset routes)
- `cross-origin-client` (B4r)
- `server-cors` (B19, R2) and `live-server-preview` (B19)
- `baseline-content-security-policy` (S3b)
- `git-operations-api` (B20, B1r)
- `terminal-emulator` (R1)
- `plugin-cwd-admission` and `trusted-networks` (S1r)
- `dashboard-plugin-loader` and `automation-action-registry` (B15r)
- `bridge-extension` (B15r, B21, B22)
- `server-restart` (B21)
- `mdns-discovery` (R4)
- `credential-vault` (B22)
- `video-transcription` and `nano-banana-image-generation-client` (B23)
- `electron-shell` (B24)

Checked, no delta: `cross-site-request-gate` (already excludes the zrok
wildcard), `plugin-event-forwarding`, `known-servers`.

## Impact

- Server: `auth/{auth,auth-plugin,cors-origin,csp}.ts`,
  `pairing/paired-devices.ts`, `plugin-event-seam.ts`, `git-worktree/git-operations.ts`,
  `routes/git-routes.ts`, `routes/provider-auth-routes.ts`, `browser-handlers/terminal-handler.ts`.
- Extension: `bridge-handlers/dispatch.ts`, `bridge.ts`, `git-link-builder.ts`,
  `server-auto-start.ts` / discovery (R4). Plugins also: `automation-plugin`,
  `flows-plugin` (S1r).
- Client: `lib/pairing/device-auth.ts`. Shared: `config.ts` (new
  `cors.allowZrokWildcard` key, default `false`, B19).
- Plugins: `video-transcription`, `video-production`, `nano-banana`. Electron:
  `renderer/doctor.html`, `lib/dependency-detector.ts`.
- **Overlaps with active changes.** Sequence or coordinate with each:
  - `add-trusted-types-report-only` modifies the same CSP header requirement and
    needs the baseline report sink built here (S3b). It becomes `blocked_by` this
    change. Its premise is partly stale: the TT directive already ships. Its
    reports are counted under the `trusted-types` label, never toward the
    strict `script-src*` exit.
  - `enforce-strict-csp-default` (follow-up, `blocked_by` this change) owns the
    S3b soak gate and the CSP default flip `report` → `enforce`.
  - `fix-remote-bridge-ticket-origin` rewrites bridge HTTP-origin resolution in
    `bridge.ts` / `bridge-ticket-client.ts` (R4). R4 lands after it.
  - `add-plugin-capability-routes` touches `localhost-guard.ts`, `auth-plugin.ts`
    and the baseline CSP (B16r, S1r, S3b). It does not modify trusted-networks
    "Network guard threaded to all protected routes".
  - `extract-git-as-plugin` relocates `git-link-builder.ts` (B22) and moves
    `git-operations.ts` + `routes/git-routes.ts` into `packages/git-plugin/`
    (B20, B1r). Whichever lands first, the other re-applies at the new path;
    citations here are pre-move.
  - `add-plugin-isolation-and-public-routes` edits `cors-origin.ts` and the
    network guard (B19, R2).
  - `add-srt-translation-pass` refactors `video-transcription/src/config.ts` (B23).
  - `raise-node-floor-to-26` touches `dependency-detector.ts` (B24).
  - `close-container-loopback-impersonation` owns B14r and MODIFIES
    `bearer-device-auth`, `trust-and-credential-boundaries`,
    `oauth-authentication` and `trusted-networks`. This change is `blocked_by`
    it (`dependencies.yaml`) and lands after it. It does not modify "Network
    guard threaded to all protected routes".
  - `close-loopback-legacy-window` also MODIFIES `bearer-device-auth` and
    `trust-and-credential-boundaries`. No dependency: all MODIFIED blocks here
    are written on baseline text; whichever of the three changes archives
    later rebases the shared requirements on the earlier one's text.
  - `device-key-mutual-check` MODIFIES `bearer-device-auth` "Long-lived opaque
    bearer tokens in a revocable registry" and the tier requirement, which B4r
    also modifies. Whichever archives second re-copies both blocks.
  - `retire-trusted-networks-bypass` was archived on 2026-10-18; no longer an overlap.
- **Compatibility:**
  - B17 alg pin: the server only mints HS256, so current tokens keep working.
    Secret rotation, if chosen, logs everyone out.
  - S3b: can break bundles only under opt-in `enforce`; the default stays
    `report`.
  - B4r: cross-origin browsers re-pair once; browser bearers expire.
  - S1r: MCP agents relying on the server-cwd fallback must pass `cwd`.
  - B19: can break a stale second zrok frontend.
  - B21: limits must never throttle normal interactive use.
- **Landing:** one ship-it pass ships all 19 items, with the CSP default
  still `report` (baseline and
  strict policies both report-only), then archives. The soak (≥14 consecutive
  days, zero strict `script-src*` violations, zero dropped reports, ≥1 release,
  green strict-enforced E2E) and the default flip belong to
  `enforce-strict-csp-default`. See design "Landing".
- **Rollback:** each item is an independent local revert. S3b ships behind
  a config switch (`PI_DASHBOARD_CSP`), so its rollback is a config change.
- **Closes (security-boundary-audit):** S1r, S3b, B1r, B4r, B15r, B16r,
  B17, B18, B19, B20, B21, B22, B23, B24, B26r, R1, R2, R4, R5. B14r is closed by its
  owner, `close-container-loopback-impersonation`. S3b closes here
  as instrumentation plus the strict policy (opt-in `enforce`); the final
  default flip is tracked by `enforce-strict-csp-default`.

## Discipline Skills

- `security-hardening` — every item hardens an auth, untrusted-input or exec
  boundary.
- `observability-instrumentation` — B18 adds auth audit log lines.
- `doubt-driven-review` — B17 rotation, B4r expiry, B19 narrowing and the
  S3b `enforce` semantics are compatibility-affecting; review each before it stands.
- `performance-optimization` — B21 rate-limit thresholds need a measured
  interactive baseline.
