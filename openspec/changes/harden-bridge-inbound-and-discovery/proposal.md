## Why

Split out of `close-residual-audit-findings`, which closes `security-boundary-audit`.
This change owns the bridge-side items: inbound bounds on the bridge (B21),
remote-URL credentials leaving the bridge (B22), discovery identity of the
server a bridge dials (R4), and the tunnel-output documentation (R5). They share
the bridge extension and its server-discovery path, so they ship and archive
together. The umbrella keeps the remaining findings.

Mechanical split, no re-planning: decisions are the umbrella's D17–D20. Code
status was first verified on 2026-10-17; `design.md` carries the re-verified
citations and is authoritative where the two differ.

## What Changes

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
  largest, and sets measured rate-limit thresholds. Decided at scenario design:
  overlapping pauses keep the later deadline (never shorten); invalid limit env
  values fall back to the default and log once; the prompt bucket is kept per
  bridge process (reconnect does not refill).
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
  again on receipt. An unparseable remote that carries userinfo sends no
  origin and builds no links.
- **R5 · Bash output over the tunnel.** Bash tool output reaches remote
  (tunnel) viewers by design. Decided at planning: document it in the
  remote-access security notes; no pattern redaction (only vault values are
  masked, which stays). Docs are written via the DocScribe subagent in
  caveman style.
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
  the configured endpoint or a pin's `lastEndpoint`, compared with the R2
  canonical-origin helper), gated at the ticket-mint call site, else refused
  with cause `unpinned_discovered_host`. Counter-proof refusals log
  `server_proof_missing` or `server_proof_invalid`.

## Capabilities

### Modified Capabilities

- `bridge-extension` (B21, B22)
- `server-restart` (B21)
- `mdns-discovery` (R4)
- `credential-vault` (B22)

## Impact

- Extension: `bridge-handlers/dispatch.ts`, `command-handler.ts`, `connection.ts`,
  `bridge.ts`, `bridge-ticket-client.ts`, `git-link-builder.ts`,
  `vault-delivery.ts`, `local-token-header.ts`, `server-pin-store.ts`,
  `server-auto-start.ts` / discovery (R4).
- Server: `vault/vault-delivery-hub.ts`, `routes/system-routes.ts`
  (`SHUTDOWN_QUIESCE_MS` moves). Shared: `recovery-timing.ts`
  (`MAX_QUIESCE_MS`), `protocol.ts` doc comment.
- Docs: `docs/architecture.md`, `docs/faq.md`, README (R5).
- **Overlaps with other changes.**
  - `fix-remote-bridge-ticket-origin` (archived 2026-10-22) rewrote bridge
    HTTP-origin resolution in `bridge.ts` / `bridge-ticket-client.ts`. R4 builds
    on its resolver; verify the post-change version before starting.
  - `extract-git-as-plugin` relocates `git-link-builder.ts` (B22). Whichever
    lands first, the other re-applies at the new path; citations here are
    pre-move.
  - `harden-git-terminal-plugin-boundaries` also modifies `bridge-extension`,
    a different requirement ("Relay plugin-emitted events into the session
    bus"). This change adds new requirements only; no textual overlap.
- **Compatibility:**
  - B21: limits must never throttle normal interactive use. Env limits
    `PI_DASHBOARD_BRIDGE_MAX_BASH` and `PI_DASHBOARD_BRIDGE_PROMPT_RATE`
    (`<burst>/<refillPerSec>`); invalid values fall back to the defaults.
  - R4: a new bridge refuses a same-host server older than 0.10.0 (no
    counter-proof) unless `PI_DASHBOARD_ALLOW_UNPROVEN_LOCAL_SERVER=1`.
    Bridges no longer send the device bearer to an unpinned discovered host.
  - B22: old bridges stay supported; the hub strips credentials on receipt.
- **Rollback:** each item is an independent local revert. B21: raise limits via
  env or revert. R4: set `PI_DASHBOARD_ALLOW_UNPROVEN_LOCAL_SERVER=1` or revert
  the bearer gate. B22: revert; stored origins stay valid. R5 is docs.
- **Closes (security-boundary-audit):** B21, B22, R4, R5.

## Discipline Skills

- `security-hardening` — every item hardens an untrusted-input, credential or
  discovery-identity boundary.
- `performance-optimization` — the B21 measurement task sets rate-limit
  thresholds from a measured interactive baseline and bounds limiter overhead.
- `observability-instrumentation` — R4 and B21 refusals log named causes
  (`server_proof_missing`, `server_proof_invalid`, `unpinned_discovered_host`)
  and surface as `command_feedback` errors, never silently.
