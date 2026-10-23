# Design — harden-bridge-inbound-and-discovery

## Context

Split out of `close-residual-audit-findings` (mechanical, no re-planning). It owns four `security-boundary-audit` items on the bridge extension: B21 (inbound bounds), B22 (remote userinfo), R4 (mDNS server impersonation) and R5 (tunnel-output docs). Decisions D17–D20 are the umbrella's, copied verbatim with their numbers. See proposal.md (Why / What Changes).

Constraints that shape the approach:

- **No server logger.** Fastify runs `logger: false` (`packages/server/src/server.ts:1905-1906`); server-side lines use `console.*`, as pairing does (`pairing/pairing.ts:542,581,586,604`). Bridge refusals use the bridge logger (`[dashboard] …`).
- **`trustProxy` stays off.** Deliberate (`auth/auth-plugin.ts:319-324`): `request.ip` is the socket peer, so tunnel traffic appears as `127.0.0.1`.
- **Shared spec text.** MODIFIED blocks are written on **baseline** text (`openspec/specs/**`). `harden-git-terminal-plugin-boundaries` modifies a different `bridge-extension` requirement. Requirement wording lives in `specs/` and is referenced here, not restated.

## Goals / Non-Goals

**Goals**
- Close B21, B22, R4 and R5 with test-backed changes (R5: docs plus a manual check).
- Bound the bridge's inbound surface: quiesce window, bash concurrency, turn-starting command rate.
- Keep credentials from leaving the bridge (remote userinfo) and keep the device bearer off unpinned discovered hosts.
- Give each behaviour change a rollback that needs no code revert where possible (env limits, opt-out env).

**Non-Goals**
- Server-side rate limiting only; it gives no protection against a rogue server (D17 alternatives).
- Pattern redaction of bash output. R5 is docs-only (D20).
- Defending against a same-user rogue process (see Risks).
- The remaining umbrella findings (auth, CORS, CSP, git/terminal/plugins, media, Electron).

## Decisions

### Bridge

**D17 · B21 — normalize `quiesceMs`, bound inbound prompt/bash.**

*Quiesce* (`dispatch.ts:80-87` accepts any `>0`; `connection.ts:748-752` accepts `1e15`). The bound is enforced **inside `pauseAutoStart`** (`connection.ts:748-752`), so every caller is bounded; dispatch passes the value through. Shared `MAX_QUIESCE_MS = 120000` sits next to `RESTART_QUIESCE_MS` (`shared/src/recovery-timing.ts`); `SHUTDOWN_QUIESCE_MS` (60000) moves there from `routes/system-routes.ts:345`. Rules, in order:
1. not a number, or `NaN` → ignored (no pause);
2. non-integer → rounded **up** (`ceil`), so the "at least `quiesceMs`" floor holds;
3. ≤ 0 → ignored;
4. > MAX, including `Infinity` → clamped to 120000.

5000 and 60000 are honoured exactly. A test asserts `MAX ≥ 2 × max(sent)`. MODIFIES server-restart "Bridges pause auto-start during quiesce window".

*Inbound limits* — the spec is qualitative with floors: bounded concurrent bash per session, bounded inbound prompt rate per connection, limits configurable, refusals visible (never silent), normal use not throttled. ADDS bridge-extension "Inbound command bounds".
- *Bash bound* covers every `handleBashCommand` caller (`extension/src/command-handler.ts`): `!`/`!!` (`:718`) and exec slash templates (`:1392`). 30 s timeout `:434`.
- *Prompt bucket* covers every turn-starting inbound command: `send_prompt` (`:661`), `retry_session` (`:965`), `git_commit_draft` (`:1039`); and in `bridge-handlers/dispatch.ts`: `flow_management` `run` (`:184-186`), `plugin_emit_event` (`:326-332`), `promote_followup_entry` (`:430-434`).
- *Config:* `PI_DASHBOARD_BRIDGE_MAX_BASH`, `PI_DASHBOARD_BRIDGE_PROMPT_RATE`, with defaults.
- *Refusal:* reuses the existing extension→server path for a refused `send_prompt`: `prompt_received` plus an `event_forward` of `command_feedback {command, status:"error", message}` (`command-handler.ts:674-685`), which settles the optimistic bubble and shows the user an inline error. No new message type.
- **Provisional defaults** (design only): 4 bash in flight per session; prompt bucket burst 30, refill 10/s per connection. The follow-up cap is unchanged (`followup-buffer.ts:13,53`).
- *Measurement task* (performance-optimization) sets final defaults before landing: replay automation per run (`automation-plugin/src/server/index.ts:455`), the `/reload` fan-out (`session-action-handler.ts:95,185`), flows and chat-gateway; defaults ≥3× the observed peak.

*Alternatives:* server-side limiter only (no protection against a rogue server, see R4); drop-oldest (silent loss).

**D18 · B22 — strip userinfo, keep the raw origin shape.**
- A new helper strips credentials from every URL-form remote, keeping scheme, host, port and path: `http(s)` loses all userinfo; `ssh://user:pass@host` loses the **password** but keeps the user. scp forms (`git@host:o/r`) carry no password and are unchanged.
- `parseRemoteUrl` (`extension/src/git-link-builder.ts:40-42`) uses it, so links are built correctly.
- Vault: the bridge sends the userinfo-stripped **raw** origin in `vault_sync_request.origin` (`vault-delivery.ts:273`). The hub stores it (`vault/vault-delivery-hub.ts:252`) and derives `repoKey` via `normalizeOrigin` exactly once (`:187`). `normalizeOrigin` is **not idempotent** — its `host/path` output has no scheme and no `@`, so re-parsing returns `undefined` (`shared/src/vault-origin.ts`, `normalizeOrigin`/`parseScp`). So its output never goes on the wire. The hub imports `normalizeOrigin` via the `vault-project-key.js` re-export (`vault-delivery-hub.ts:25`; re-export at `shared/src/vault-project-key.ts:14-18`). The hub also strips credentials on receipt, which covers old bridges.
- The doc comment at `shared/src/protocol.ts:902` is updated. Recorded: the git-info path never carries the raw URL (`vcs-info.ts:331-334`).

ADDS bridge-extension "Remote URL credentials never leave the bridge"; credential-vault "Repository origin sent to the hub is credential-free".

**D19 · R4 — counter-proof on every loopback dial; no bearer to an unpinned discovered host.** *(user-confirmed)*
- *Loopback scope:* when the bridge holds the local token, **every** loopback TCP dial or retarget — configured endpoint, auto-start, discovered advert, retarget, reconnect — requires server counter-proof (`extension/src/local-token-header.ts:129-199`). Today that happens only when the spawn marker is set (`:142`, `markerEnforces` `:84-90`). This covers **both** `ws:` and `wss:` loopback dials whenever the token exists. Exempt, stated explicitly: only `ws+unix:` (filesystem permissions; already skipped at `:133`).
- *Opt-out:* `PI_DASHBOARD_REQUIRE_SERVER_PROOF` is **not** reused: `markerEnforces` treats any non-empty unparseable value, `"0"` included, as enforcing, and the spawner deletes/overwrites it (`server/src/spawn-process/process-manager.ts:397,413`). A new explicit env `PI_DASHBOARD_ALLOW_UNPROVEN_LOCAL_SERVER=1` opts out, logged when active.
- A refusal blocks registration and session data, is logged with a named cause, and falls back to backoff.
- *Skew window:* servers answer counter-proof since 0.10.0 (`CHANGELOG.md:420-424`). A new bridge against a same-host server older than 0.10.0 is refused unless the opt-out is set.
- *Pinned* = exact `host:port` equality with the configured endpoint (config/env) or with a `server-pin-store` entry's `lastEndpoint` (`extension/src/server-pin-store.ts`). `resolvePinForEndpoint`'s single-pin fallback (`server-pin-store.ts:79-83`, "the sole pin") is **not** used: it would treat any endpoint as pinned when one pin exists.
- *Gate location:* the ticket-mint call site — `prepareRemoteUpgrade` (`bridge.ts:1047`, mint at `:1051`) → `mintBridgeTicket` (`bridge-ticket-client.ts:66-71`, `Authorization: Bearer` at `:70`). The bearer is attached only for a pinned endpoint. Discovered-only mDNS candidates (`server-auto-start.ts:199-206`, `shared/src/mdns-discovery.ts:414-427`) never receive it; the refusal is logged through the bridge's existing `[dashboard] bridge ticket <cause>` line (`bridge.ts:1053`) with cause `unpinned_discovered_host`.
- *Coordination:* `fix-remote-bridge-ticket-origin` rewrites the HTTP-origin resolution in the same call sites; R4 builds on its resolver (dependencies.yaml `blocked_by`).

MODIFIES mdns-discovery "Guarded migration away from an established bridge"; ADDS "Local-token holders require server counter-proof on every loopback dial", "Device bearer never sent to an unpinned discovered host".

**D20 · R5 — document.** *(user-confirmed)*
- `!` output reaches tunnel viewers by design (`extension/src/command-handler.ts:1526-1538`). Only vault values are masked (`vault-redaction.ts:1-21`).
- Document in `docs/architecture.md` "Remote confinement" (~`:3103`), `docs/faq.md` (~`:723`) and README "Tunnel (zrok)" (~`:394`), via DocScribe.

## Measurement record (task 2.1, `performance-optimization`)

Method: static trace of every producer of an inbound turn-starting command, then a fake-clock replay (test BP1) of each workload against the **default** limits. Production traffic cannot be sampled from a worktree, so the peaks below are the *upper bounds the code permits*, not telemetry. The bucket and the bash counter are **per bridge connection / per session**, so fan-out across sessions never concentrates on one bucket.

| Producer | Code | Inbound prompts per bridge connection |
|---|---|---|
| Interactive typing / paste | composer → `send_prompt` | human-bound; ≤ 3/s sustained, ≤ 8 back-to-back (paste + queued follow-up drain on `agent_settled`, `followup-buffer.ts` cap 20 drains one entry per settle) |
| Automation run | `automation-plugin/src/server/index.ts:455` `sendToSession` | exactly 1 per spawned run session (per-session bridge) |
| `/reload` fan-out | `session-action-handler.ts:95,185` one `send_prompt "/reload"` per session | exactly 1 per bridge, regardless of M sessions |
| Flows / chat-gateway | one prompt per agent turn / per platform message | ≤ 1 per turn; platform-side rate limits make > 1/s per chat impractical |
| Bash | `!` / `!!` / exec templates | UI sends sequentially; observed concurrent = 1 |

Recorded constants (`__tests__/helpers/bridge-inbound-peaks.ts`): peak 3 prompts/s, peak burst 8, peak concurrent bash 1, reload fan-out M = 40 sessions (1 prompt each).

Defaults ≥ 3× the peaks (asserted by BP1): bucket refill 10/s ≥ 3×3 = 9; burst 30 ≥ 3×8 = 24; bash 4 ≥ 3×1 = 3. The provisional defaults (4 bash, `30/10`) are therefore **final**.

## Sequencing

```mermaid
flowchart TD
  RBT["fix-remote-bridge-ticket-origin<br/>(archived 2026-10-22; resolver R4 builds on)"] -->|prerequisite| R4["R4"]
  subgraph This["harden-bridge-inbound-and-discovery"]
    B21["B21"]
    B22["B22"]
    R4
    R5["R5 docs (DocScribe)"]
  end
  EGP["extract-git-as-plugin<br/>(moves git-link-builder.ts)"] -. second lander re-applies B22 at new path .- B22
  HGT["harden-git-terminal-plugin-boundaries<br/>(bridge-extension: different requirement)"] -. no textual overlap .- B21
```

- B21 starts with the measurement task; the limits land only after the defaults are set from it.
- R4 builds on the archived `fix-remote-bridge-ticket-origin` resolver; task 1.1 verifies the post-change `prepareRemoteUpgrade` / `mintBridgeTicket`.
- *Path move:* `extract-git-as-plugin` moves `git-link-builder.ts` (B22). Whichever lands first, the other re-applies at the new path; citations here are pre-move.
- *Spec rebase rule:* `harden-git-terminal-plugin-boundaries` modifies the `bridge-extension` requirement "Relay plugin-emitted events into the session bus"; this change only ADDS requirements to that capability, so no rebase is needed.

## Risks / Trade-offs

- **[Risk]** B21 limits throttle legitimate fan-out (automation, `/reload`). → the measurement task sets defaults (≥3× peak); limits are configurable via env; refusals are visible.
- **[Risk]** R4 refuses a same-host server older than 0.10.0. → named cause; `PI_DASHBOARD_ALLOW_UNPROVEN_LOCAL_SERVER=1`.
- **[Residual] R4 same-user rogue process.** A process running as the same user can read the local token and answer counter-proof. Counter-proof only stops other users' listeners; same-user compromise is out of scope.
- **[Trade-off] B22 unparseable remotes.** A remote that carries userinfo but cannot be parsed sends no origin and builds no links, rather than risk leaking it.
- **[Risk]** Overlapping changes conflict. → Sequencing above.

## Migration Plan

One landing: every row below ships in one ship-it pass, then the change archives. R4 follows `fix-remote-bridge-ticket-origin` (archived).

| Item | Data / config migration | Rollback |
|---|---|---|
| B21 | New env limits `PI_DASHBOARD_BRIDGE_MAX_BASH`, `PI_DASHBOARD_BRIDGE_PROMPT_RATE`. | Raise limits via env, or revert; shared constants revert together. |
| B22 | None (hub derives the key as before). | Revert; stored origins stay valid. |
| R4 | New opt-out env. | `PI_DASHBOARD_ALLOW_UNPROVEN_LOCAL_SERVER=1`; revert the bearer gate. |
| R5 | Docs. | n/a |

*Compatibility:*
- Old bridge, new server: the hub strips credentials for B22.
- New bridge, old (<0.10.0) loopback server: R4 refuses; the opt-out env covers it.
- No database. All persistence is JSON with optional fields.

## Open Questions

None.
