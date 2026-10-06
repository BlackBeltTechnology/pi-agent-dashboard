## Why

With YOLO active the dashboard banner reads "YOLO everywhere: file access auto-allowed on every folder", yet the agent's own `read`/`write`/`edit` calls still raise the path-gate prompt (`Agent wants to write outside its workspace: …`). YOLO is wired only into the server's grant coordinator (filesystem + working-directory planes); the bridge path gate never consults it, so `/api/health` shows `accessGrants.yolo.autoAllowed: 0` for a live session. Operators enable YOLO precisely to stop agent interruptions, so the mode fails its main use case. Issue #809.

## What Changes

- YOLO's coverage widens from two planes to two planes **plus the agent path gate**: while a YOLO session is live, an out-of-root agent tool call whose path is in scope is allowed once with no prompt, persisting nothing.
- The bridge path gate asks the server, at the exact point it would otherwise prompt, whether YOLO answers this call (request/reply over the existing bridge socket, mirroring `path_grant_request`). The server stays the sole YOLO authority: expiry, end, roots, forbidden rule, refusals, counters and history are evaluated there. The question is accepted only on the named session's own bridge connection — the agent-path equivalent of the prompt-capability proof.
- Sensitive locations, ungrantable subjects, a recent operator denial, and sessions with no interactive UI keep today's behaviour. Any failure to get an answer (timeout, error, no dashboard, server without support) → the ordinary prompt; asking never blocks a call by itself.
- **A gate `Deny` becomes a durable remembered refusal** (`agent-path` surface) in the existing refusal ledger: survives restart, listed and clearable on the Access surface. While YOLO is live, a remembered subject is blocked without a prompt (`yolo-refused`), never auto-allowed. Timeouts are not recorded.
- Auto-allows are logged (`yolo-allowed` gate outcome; server `yolo:auto-allowed plane=agent-path`), counted in the YOLO `autoAllowed` total, and listed in Access → YOLO history.
- Fix: YOLO scope matching resolves a not-yet-existing subject through its nearest existing ancestor and tests containment on that resolved path (today the containment helper re-resolves strictly and rejects it), so a write creating a new file under a root is in scope.
- The YOLO spec's forbidden-subject wording is aligned with the shipped grant model (descendant rule applies to `~/.ssh`/`~/.pi`; root/home/system dirs refused as themselves and their ancestors). The agent path gate additionally refuses descendants of platform system directories (OS temp dir exempt); such calls get the ordinary prompt.
- Agent-path YOLO and durable gate refusals require same-host proof (the grant-store identity match already used for "Always allow"), since the server evaluates paths on its own filesystem; remote dashboards keep today's prompts.
- Fixes a pre-existing loss of `dashboard_identity` after a `/dashboard-connect` move (affects "Always allow" today and the new flag).
- Version skew is safe: the server advertises `path-yolo` support in `dashboard_identity`; a bridge without that signal never asks.
- YOLO banner/pill copy names what is covered (agent and dashboard file access).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `access-grant-yolo`: "planes only" requirement renamed/extended to include the agent path gate; "could have been prompted" defines the agent-path proof (session-bound bridge connection + attached UI); "never reverses an explicit refusal" covers gate denials; "does not bypass … forbidden-subject rule" aligned with the shipped grant model; "unmissable and fully recorded" names the agent path gate and requires accurate copy; ADDED scope matching for not-yet-existing subjects (all surfaces); ADDED agent path-gate system-directory exclusion.
- `agent-path-confinement`: "gated before execution", "operator is asked", "the gate fails closed" and "every outcome is observable" carve out / enumerate the YOLO outcomes (new `yolo-refused` block cause; a YOLO-answer failure is not a gate error); ADDED "a live YOLO session answers the out-of-root prompt" and "an operator Deny at the gate is remembered durably".

## Impact

- `packages/extension/src/path-gate/` — `handler.ts` (YOLO question before the per-session mutex; `yolo-allowed`/`yolo-refused` outcomes; deny report from `settleDeny`), new `yolo-link.ts`, `index.ts` (route `path_yolo_result`, read `features` from `dashboard_identity`).
- `packages/server/src/access/` — `agent-confirm-registry.ts` (per-kind observe/consume + caps), `agent-grant.ts` (consume `confirm` kind only), `yolo-session.ts` (`decideAgentPath`, shared `answer()` core, resolved-subject containment), new `agent-yolo.ts` (`handlePathYoloRequest`, `handlePathGateRefusal`), `refusal-ledger.ts` (accept `agent-path`); `routes/access-prompt-routes.ts` (clear route accepts `agent-path`); `event-wiring.ts` (new frames; lazy `decideAgentPath` dep; observe `agent-path-gate` select prompts; `dashboard_identity` always sent with `features`); `server.ts` (pass the dep).
- `packages/shared/src/` — `protocol.ts` (`path_yolo_request`/`path_yolo_result`/`path_gate_refusal`; `dashboard_identity.features?`, `grantStoreId` optional), `browser-protocol.ts` (`YoloSurfaceId`; `AccessPlaneId` unchanged), `canonical-subject.ts` (`isResolvedSubjectWithin`).
- `packages/client/src/` — `components/access-grant/YoloIndicators.tsx` + `YoloAccessCard.tsx` copy, `components/settings/AccessPromptsSection.tsx` + `access-prompts-types.ts` + `access-prompts-api.ts` (`YoloSurfaceId`, `agent-path` label); locale strings.
- `packages/extension/src/bridge.ts` + `session-move.ts` — heartbeat carries `yoloAllowed`; yolo support flag bound to the announcing connection; `dashboard_identity` forwarded after a move.
- Docs: per-directory `AGENTS.md` rows for new/changed files; `docs/architecture.md` access-grant section (via DocScribe).
- Persisted data: `access-refusals.json` gains `plane: "agent-path"` rows. Rollback: old server ignores/drops them on load (fail-safe — refusals grant nothing). Old bridge + new server, or new bridge + old server: behaviour as today.

## Discipline Skills

- `security-hardening` — widens an auto-allow path for agent-controlled input (paths); the server must bind each frame to the session connection and re-derive subject/scope itself.
- `doubt-driven-review` — amends deliberately narrow, structural spec boundaries ("YOLO applies to … only", "could have been prompted"); stress-tested during planning.
- `observability-instrumentation` — new auto-allow / refused outcomes must be logged, counted and listed.
- `review-code` — non-trivial cross-package change; inline review before commit.
