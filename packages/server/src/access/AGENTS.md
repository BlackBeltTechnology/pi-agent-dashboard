# DOX — packages/server/src/access

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `access-denials.ts` | Path-denial registry (design D20): `recordPathDenial`, `getPathDenial`, `__resetPathDenials`. → see `access-denials.ts.AGENTS.md` |
| `access-grants.ts` | The path-grant store (design D2/D10/D11/D16/D17). `recordGrant` / `listGrants` / `revokeGrant` /… → see `access-grants.ts.AGENTS.md` |
| `access-health.ts` | `/api/health` counters (design D11, task 9.3): `snapshotAccessGrantHealth(deps)` + `AccessGrantHealth` =… → see `access-health.ts.AGENTS.md` |
| `access-plane.ts` | The plane registration seam (design D5/D2a/D3, tasks 5.1/5.5/2b.2/8b.1). → see `access-plane.ts.AGENTS.md` |
| `agent-confirm-registry.ts` | `createAgentConfirmRegistry` / `AgentConfirmRegistry`. First-sight record of `agent-path-gate-confirm`… → see `agent-confirm-registry.ts.AGENTS.md` |
| `agent-grant.ts` | `handlePathGrantRequest(connectionSessionId, msg, deps)` → `path_grant_result`. → see `agent-grant.ts.AGENTS.md` |
| `agent-yolo.ts` | `handlePathYoloRequest(connSession, msg, deps)` → `path_yolo_result` (session-bound; verdict from lazy… → see `agent-yolo.ts.AGENTS.md` |
| `ancestor-ladder.ts` | `offeredAncestorLadder(subject)` — the nearest-first rungs a denial remedy may also offer (task 7b.1a). → see `ancestor-ladder.ts.AGENTS.md` |
| `capability-issuance.ts` | Who is issued a prompt capability (design D1a, tasks 2b.1/3.5). → see `capability-issuance.ts.AGENTS.md` |
| `canonical-subject.ts` | Re-export shim → `@blackbelt-technology/pi-dashboard-shared/canonical-subject.js`. → see `canonical-subject.ts.AGENTS.md` |
| `cors-denial.ts` | CORS origin denial -> DEFERRED `cors`-plane denial (server-cors spec "An origin denial may be answered by… → see `cors-denial.ts.AGENTS.md` |
| `containment-gate.ts` | The ONE gate every body-emitting file-read site routes through; before it each of the ten sites inlined… → see `containment-gate.ts.AGENTS.md` `evaluateContainment` refuses a dashboard-state path first with NO remedy and records nothing; an unproven local caller (`currentCallerUnproven`) skips `holdDenial` (prompt-ineligible, `promptOutcome:"ineligible"`). See change: close-container-loopback-impersonation (D8). Decision is path-bound (`resolved`); `decidePassive` for passive sites. See change: codeql-file-containment-barrier. |
| `cwd-admission-log.ts` | `createIndeterminateLogger(logger)` — rate-limited `[cwd-admission] indeterminate` sink: 1 line per canonical… → see `cwd-admission-log.ts.AGENTS.md` |
| `cwd-verdict.ts` | `resolveCwdVerdict(cwd, resolution, {known, rerunAlways?})`: the ONE post-verdict `cwd`-plane re-run (real… → see `cwd-verdict.ts.AGENTS.md` |
| `denial-hold.ts` | The one call a denial site makes (task 6.1-6.3). `installGrantCoordinator` / `holdDenial(facts, target?)` +… → see `denial-hold.ts.AGENTS.md` |
| `forbidden-subjects.ts` | Re-export shim → `@blackbelt-technology/pi-dashboard-shared/forbidden-subjects.js`. → see `forbidden-subjects.ts.AGENTS.md` |
| `grant-coordinator.ts` | Joins a denial to the registry, the planes and the operator's browsers (design D3/D6/D7/D8, tasks 6.1-6.3). → see `grant-coordinator.ts.AGENTS.md` |
| `grant-store-id.ts` | `~/.pi/dashboard/grant-store-id` token naming the grant store. → see `grant-store-id.ts.AGENTS.md` |
| `hold-request.ts` | `awaitHold(request, reply, hold)` (design D7, task 6.3): the `git-routes` worktree-init transport in shape. → see `hold-request.ts.AGENTS.md` |
| `named-grant.ts` | `grantNamedPathSubject` (task 5.2): the ONE path-grant creation sequence, extracted from `POST… → see `named-grant.ts.AGENTS.md` |
| `pending-grant-registry.ts` | The pending access-request registry (design D4/D8/D9/D11, tasks 4.1-4.4 + 2b.6). → see `pending-grant-registry.ts.AGENTS.md` |
| `pi-trust-live.ts` | Live trust entries (server lifetime): session worktree-init trust, session grants, YOLO roots. `createPiTrustLiveProvider`: `reconcile`, `enumerate`, `covering`, `isStillLive`, `setChoice` (memory only). Identity recorded at creation. See change: mirror-dashboard-trust-live-remote. |
| `pi-trust-mirror-service.ts` | Server side of the dashboard-trust → pi mirror. `createPiTrustMirrorService(deps)`: durable registry over… → see `pi-trust-mirror-service.ts.AGENTS.md` |
| `planes.ts` | The four registered planes (tasks 5.2-5.4): `createFilesystemPlane` (held, YOLO-eligible,… → see `planes.ts.AGENTS.md` |
| `preview-egress-store.ts` | `~/.pi/dashboard/preview-egress.json` `{[projectKey]: origins[]}` (env `PI_PREVIEW_EGRESS_STORE`). Reads stat-cached, tolerant, never rewrite. Writes `addPreviewEgressGrant`/`revokePreviewEgressGrant` under `locked-json-file`. `projectEgressGrants`, `listPreviewEgressRows`. See change: improve-canvas-html-and-url-ux. |
| `prompt-channel.ts` | Per-connection prompt capabilities (design D1/D1a/D2, tasks 3.1/3.3/3.4). → see `prompt-channel.ts.AGENTS.md` |
| `provisioning.ts` | Provisioning registry: classify D4/D5a, bounds D6, ladder D7, project root D8, settle D5 (async re-resolve… → see `provisioning.ts.AGENTS.md` |
| `provisioning-wiring.ts` | `installProvisioning({gateway, deps})` → `{registry, onResponse, announce, dispose}`. Wires registry to gateway operator sockets: `operatorCount`, `provision_dismiss` on every terminal transition, one unref'd expiry timer per request. `onResponse` drops + counts a `provision_response` from a socket without its own live capability. See change: add-access-provisioning. |
| `refusal-ledger.ts` | The remembered-refusal ledger (tasks 2b.9, 8b.4a): the ONE piece of persisted state this change owns. → see `refusal-ledger.ts.AGENTS.md` |
| `source-channel.ts` | `sourceChannel(ip)` -> remote requester key by allocation: IPv4 `/24`, IPv6 `/64` (hextets expanded, zone… → see `source-channel.ts.AGENTS.md` |
| `verified-read.ts` | Handle-verified byte serving for GRANT-admitted reads (design D14, task 2.8). → see `verified-read.ts.AGENTS.md` |

| `yolo-env.ts` | `parseYoloEnv` + `YOLO_ENV` (`PI_DASHBOARD_GRANT_YOLO`) + `YOLO_UNSCOPED` (task 2b.8, syntax decided with the… → see `yolo-env.ts.AGENTS.md` |
| `yolo-session.ts` | `YoloController` (design D13, tasks 8b.2-8b.6a/8b.8): `decide` (at the prompt point: `auto-allow` /… → see `yolo-session.ts.AGENTS.md` |
