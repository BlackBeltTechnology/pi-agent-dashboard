# Add mid-turn tool OAuth in ChatView (courier + owner)

> **Status: EXPLORATION DRAFT.** Captures a thinking-mode exploration, not a committed
> change. `tasks.md` and `specs/` deltas are intentionally deferred until this graduates
> from exploration. Feeds `add-connector-layer` (Phase 2 OAuth) and resolves the open auth
> question in `add-cloud-sync-connector`.

## Why

Some tools an agent invokes mid-turn need an interactive OAuth consent — the canonical case
is `rclone` connecting to Google Drive. Today there is no way for that consent ceremony to
happen *inside ChatView*: the tool runs headless under pi, tries (and fails, or pops up
unbidden) to open a browser, and blocks. The user asked whether the dashboard can spawn a
small listener to catch the OAuth code in realtime — the same shape the LLM-provider login
already uses.

The investigation found the dashboard already ships ~90% of the machinery. The gap is small
and well-bounded, and the ergonomics for cloud providers are *better* than the obvious
"dashboard owns a Google OAuth app" path, because tools like rclone already own a registered
OAuth client.

## Scope decisions (from the exploration)

Three answers fixed the shape:

1. **Persist the credential on the local machine.** Auth is a one-time ceremony; remote use
   afterward just reads the persisted config. This removes the tunnel /
   registered-redirect-URI problem for the **loopback** challenge kind (rclone, gcloud
   default) — which is then *local-only*. **Device-code** and **OOB paste-back** kinds (gh,
   aws sso, gcloud `--no-browser`) have no loopback and authenticate fine from a **remote**
   ChatView. Topology is a per-kind property, not a blanket rule (see design.md).
2. **General tool mechanism**, adapted per cloud provider — not an rclone one-off.
3. **Keep the tool's own credential when the external tool has its own auth mechanics.**
   The dashboard is a courier, not the credential owner, whenever the tool (rclone) manages
   its own config + its own loopback listener.

## What Changes

Introduce a **two-mode** mid-turn tool-OAuth capability, split on *credential ownership*:

- **Courier mode** (tool owns its OAuth app + config → rclone, gh, gcloud, aws sso, …). The
  dashboard launches the tool in its most-structured headless auth mode, detects the
  **challenge kind** (loopback `url` / `device` code / OOB `paste`), surfaces the matching
  ChatView card, opens the system browser (loopback) or shows the code/URL (device/paste),
  and lets the tool's *own* listener/poll catch completion and write its *own* config. The
  dashboard never sees the token. This is a thin **wrapper**, not a broker. Detection is
  per-tool adapters (rclone structured; gh/gcloud/aws prose).
- **Owner mode** (generic HTTP connector, no such tool). The dashboard runs the full
  loopback flow it already runs for LLM providers (`startCallbackServer` → exchange →
  persist to `connector-auth.json` → refresh → inject at call time). This is the reusable
  substrate `add-connector-layer` Phase 2 already needs.

The two share only the ChatView card (`ask_user`/`PromptBus`) and the `openBrowser` +
remote-access-gating primitives. They do **not** share a credential model. An earlier idea
to unify both under one adapter interface was rejected during the trace as over-engineering.

## Capabilities

### Added Capabilities

- **mid-turn-tool-auth** — detect an auth challenge raised by a headless tool invoked
  mid-turn, classify its kind (loopback `url` / `device` code / OOB `paste`), surface the
  matching ChatView card, drive the local system browser (gated by remote-access) or show
  the code/URL, and detect completion — while the tool keeps ownership of its own
  credential (courier mode). Ships an rclone adapter as the first tool.

Owner-mode (dashboard-owned credential vault) is **out of scope for this change** — it is a
handoff to `add-connector-layer` Phase 2, which already plans to reuse
`oauth-callback-server.ts` + `connector-auth.json`.

## Reuse (already in the tree — verified)

| Primitive | Location | 
|---|---|
| Open URL in system browser (server host) | `provider-auth-routes.ts` → `openBrowser` (`pi-dashboard-shared/platform/commands`) |
| Host-can-reach-a-desktop probe | `system-open-capability.ts` |
| Remote-access gating of a host-side action | existing "Open file button hidden on remote access" pattern |
| ChatView card + wait for user | `ask_user` tool → `PromptBus` → `prompt_request` |
| Loopback callback + exchange (owner mode) | `oauth-callback-server.ts` `startCallbackServer` + `exchangeCode` |
| Credential vault (owner mode) | `connector-auth.json` convention (`provider-auth-storage.ts`) |

## The only novel surface

**Auth-challenge detection**: recognizing that a headless tool is blocking on a consent URL
(or wants a code pasted back), and detecting completion. Generalized as a small per-tool
`AuthChallengeDetector` interface (structured-first, prose-scrape fallback). Everything else
is glue over shipping primitives.

## Relationship to existing changes

- **Resolves** `add-cloud-sync-connector` design open question (lines ~357-359): *"whether to
  reuse add-connector-layer's credential store / OAuth machinery vs a dedicated one."*
  Answer: for cloud file providers, prefer **courier** (rclone owns the OAuth app) — neither
  a new vault nor connector-layer's vault is needed.
- **Feeds** `add-connector-layer` Key decision 5 (Phase 2 OAuth) as the **owner-mode** half.

## Discipline Skills

- **security-hardening** — flow handles OAuth tokens/secrets and spawns external tool
  processes with untrusted output; token must never enter dashboard logs/stores (courier).
- **observability-instrumentation** — new mid-turn flow spawning external CLIs; needs
  evidence of challenge-kind classification, browser-open gating decisions, and completion.
- **doubt-driven-review** — the remote-access gating decision (loopback local-only vs
  device remote-OK) is a security-relevant boundary; verify before it stands.

## Deliberately deferred

- `tasks.md` + `specs/` deltas — pending go-ahead to build.
- The full walk of rclone's `--non-interactive` state machine past the first `*oauth-…`
  state (the entry point is confirmed; the exact continue-loop shape is a build-time detail).
