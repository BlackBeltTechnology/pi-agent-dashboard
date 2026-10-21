# Design — access provisioning

## Context

See proposal.md — Why. Constraints that shape the approach:

- **Grant store.** `recordGrant` (`packages/server/src/access/access-grants.ts:329`) is the one writer: it normalises the subject to a real-path directory (`normalizeGrantSubject`, `:226`), refuses `isUngrantableSubject` on the stored value (`packages/shared/src/forbidden-subjects.ts:182`), and caps the persisted store at 200 by evicting the oldest grant (`GRANT_CAP_PER_SCOPE`, `access-grants.ts:90`; `enforceCap`; spec `path-anchor-grants` "The grant store is bounded at 200 entries"). `via` is typed on `AccessGrant` (`:86`) and `RecordGrantInput` (`:309`) as `"prompt" | "agent-prompt"`. `loadFromDisk` does not validate `via` and spreads it through (`:169-181`).
- **Persisted grants are machine-wide by folder.** `scope: "project"` means *persisted*, not per-project. The bridge gate reads `subject` + `scope` only (`packages/extension/src/path-gate/grant-cache.ts:65-66`). The operator chose to keep this; no per-project binding.
- **Today a grant needs a witnessed trigger.** HTTP grants carry a recorded `denialId` (`path-anchor-grants` "A grant names the subject a recorded denial named…"; `named-grant.ts`); agent-gate grants carry a confirmation the dashboard saw raised (`agent-grant.ts`). The Access page creates nothing (`access-settings-tab`; D12 and D15 of `archive/2026-09-21-add-access-grants-and-review/design.md:280,422`).
- **Operator channel.** The browser gateway issues each browser-shaped socket a capability (`packages/server/src/pairing/browser-gateway.ts:1889` → `issuePromptChannel`, `prompt-channel.ts`) and releases it on close (`:2499`). The browser echoes it in `X-Pi-Grant-Channel` on fetches (`packages/client/src/lib/access-grants/grant-channel.ts:112`); `isPromptEligible(request)` resolves it. `promptChannelCount()` counts live capabilities. These are provenance signals, not authentication (`capability-issuance.ts`; D1b of `add-access-grant-dialog`).
- **Existing settlement paths do not check the capability.** `grant_response` is dispatched to `GrantCoordinator.onResponse(msg)` with no socket check (`packages/server/src/server.ts:2048-2055`; `grant-coordinator.ts:245-249`), and `grant_request` goes out via `broadcastToAll` (`server.ts:2041`). `POST /api/access/prompts/:promptId` settles with operate tier only (`packages/server/src/routes/access-prompt-routes.ts:185`). Gateway handlers receive the sending socket (`browser-gateway.ts:522`, `handler(msg, ws)`).
- **Loopback is trusted.** Genuine-local callers pass the auth hook (`trust-and-credential-boundaries`). The agent's `bash` is ungated and runs as the operator's user, so it can write `~/.pi/dashboard/access-grants.json` directly.
- **pi trust.** A persisted grant on a project root counts toward pi trust only when the mirror's `accessGrants` source is enabled (default `false`, `packages/shared/src/config.ts:816`) or its per-entry choice is `true` (`pi-trust-mirror-service.ts:177-184`). The grant dialog offers that choice (`components/access-grant/PiTrustCheckbox.tsx`) and the server stores it after settle (`storePiTrustChoiceOfVerdict`, `server.ts:2051`). `pi-trust-mirror` "Trust mirror settings and per-entry choice" lists every dialog that must show the checkbox.
- **Remote access** is owned by the remote-access wizard. Its dialog opens on a status landing (`remote-access-wizard` "Remote access dialog opens on a status landing"; `RemoteAccessDialog.tsx:26`). Since `retire-trusted-networks-bypass`, `trustedNetworks` no longer authenticates under `network.trustMode: "pair"`.

## Goals / Non-Goals

**Goals:**
- One operator approval turns a project's declared folder needs into persisted grants.
- Every provisioned grant is visibly provisioned and revocable like any other.
- No route or message this change adds lets a caller without a prompt capability approve a request. This is an honest-path guard, not proof of operator presence (operator decision A; see D11).

**Non-Goals:**
- Per-project grant binding, bridge protocol changes.
- Read-only vs read-write grants (grants have no access kind).
- Writing `trustedNetworks`, CORS origins, pairing state, plugin levels; deep-linking into a wizard task.
- Gating `bash` (that is `add-supervised-tool-approval`).
- Containing a hostile local process (D11).
- Tightening the existing `/api/access/prompts/:promptId` settle (follow-up, see Risks).
- Mining `[path-gate]` logs (they live in pi session output); history comes from the grant store.
- Surviving a server restart: pending requests are in memory only.
- Operator-presence proof (passkey / WebAuthn user verification on approval): follow-up change.

## Decisions

### D1 — A separate provisioning registry, not a new access plane

A request is one record with N lines and one dialog. The access-plane registry (`pending-grant-registry.ts`) is keyed `(plane, subject)` with per-plane/per-channel rates (5 prompts/plane/min, 1/min per deferred channel, 2 concurrent dialogs). A 6-folder profile would split into throttled single-subject dialogs, most landing unprompted.

**Chosen:** `packages/server/src/access/provisioning.ts`, a pure registry (`create` / `get` / `settle` / `dismiss` / `expire` / `list` / `stats`, `now` injected) with its own bounds (D6). It reuses the capability channel for delivery and `recordGrant` for writes; it never touches `PendingGrantRegistry` and never consults YOLO.

*Rejected:* a `provision` deferred plane with a composite subject — breaks plane subject normalisation and per-subject dedupe.

### D2 — The route proposes; it never writes; delivery is capability-targeted

`POST /api/access/provision` (operate tier, `networkGuard`) validates (D7, D8), classifies (D4), records a pending request and sends `provision_request` **only to operator sockets**: sockets that hold a live capability AND are operate tier. This uses a new gateway send helper, not `broadcastToAll`. `no-operator` counts the same set. `provision_dismiss` is server → browser only: it is sent on every terminal transition so other tabs close the dialog. It writes no grant and no config. `GET /api/access/provision` lists pending requests (Access page, observe tier). `GET /api/access/provision/:id` returns status + per-line outcomes (observe tier).

### D3 — Settlement requires a live capability on every path

A provisioning line names a folder the agent chose, not a denial the operator saw. Settlement is accepted only:
- over WS as `provision_response`: the handler receives the sending `ws` (`browser-gateway.ts:522`). It calls a new gateway predicate, `holdsLiveCapability(ws)`, backed by a `WeakMap<WebSocket, grantSocketId>` filled where the capability is issued (`:1889`) and cleared on release (`:2499`), and checked against the live channel table in `prompt-channel.ts`. Capability A never authorises socket B. A failing message is dropped and counted;
- via `POST /api/access/provision/:id/settle`, only when `isPromptEligible(request)` is true.

Closing the dialog sends a `provision_response` with every line rejected, so it is gated the same way. A plain operate-tier request from the agent (no capability) cannot settle. The client already attaches the capability to every same-origin `/api/*` fetch (`grant-channel.ts` `shouldAttach`), so the Access page needs no allowlist change. At settle the server re-checks the D7 ladder (kill switch, `report` mode, `promptEnabled`), like `GrantCoordinator.onResponse` re-checks the mode (`grant-coordinator.ts:245-249`). If the ladder now fails, the answer is refused and the request stays pending until it expires. Residual: a same-machine process that forges a browser-shaped WS gets a capability and can settle (D11, accepted).

### D4 — Line resolution and classification (first match wins)

For each line `{path, why}`:
1. Expand: absolute, `~/`-rooted, or relative to the project root. Anything else (`~user`, empty, non-string, NUL, > 4096 chars) → `invalid`.
2. Real path via `realpathNearestAncestor` + `stat().isDirectory()`; must exist and be a directory → else `missing`. Classification does NOT call `normalizeGrantSubject` (which maps a file onto its parent, `access-grants.ts:226`); a file line is `missing`, never a grant for its parent.
3. `isUngrantableSubject(real)` → `forbidden`.
4. At or below a credential folder, or an ancestor of one (D5a) → `sensitive`.
5. At or below the project root → `in-root` (sessions working in that checkout already have it as a root; other sessions do not, and need their own project's profile).
6. Admitted by an existing persisted grant → `covered`.
7. Else `grantable`.

Lines with the same real path collapse; the first line's `why` is kept. Only `grantable` lines are approvable. `why` is capped at 200 characters with control characters stripped; a cut is shown with `…`. It is rendered as React text only and JSON-quoted in logs (spec requirement).

### D5 — Approval: re-verify, then one synchronous write section, never evict

On settle:
1. *Async phase:* re-check the D7 ladder and re-validate the project root (D8; failure → every approved line `refused`, reason `root-changed`); re-classify every approved line (cheap pre-filter).
2. *Synchronous section (no `await`):* for each approved line, `realpathSync` the shown path and compare it to the shown real path. A mismatch, or a line no longer `grantable`, is refused **before** any write, with outcome `changed` / `refused`; nothing is revoked afterwards. Then count net-new subjects (`recordGrant` is idempotent on an existing subject, `:362-363`). If `persisted + net-new > 200`, every approved line is `refused` with reason `capacity`. Else call `recordGrant({subject, scope: "project", via: "provision", origin, evict: false})` for each. `evict: false` is a new option: it checks the cap on every call and returns `{ok:false, error:"capacity"}` instead of evicting. A write failure → `failed`; later lines still run.

Node runs the section without interleaving, so no other grant write *in this server process* lands between the comparison, the capacity check and the writes (`writeAtomic` is synchronous, `access-grants.ts:281-296`). The home lock is advisory (`lifecycle/home-lock.ts`). Another process writing the same store, or the agent's `bash`, is not serialised by it; such a writer can already write the file directly (D11). The remaining window is the synchronous `realpath` inside `recordGrant`, the same as every other grant write.

**Provisioned grants are never eviction victims.** `enforceCap` skips `via: "provision"` entries: a later denial-path write at the cap evicts the oldest *non-provisioned* grant. When all 200 grants are provisioned, that write is refused like any failed write (no grant, the request still 403s; D11 of grants). Eviction now logs `[access-grants] evicted subject= via=`. "Permanent" means: until the operator revokes it.

### D5a — Credential folders are not provisionable

`forbiddenGrantSubjects().sensitive` covers only `~/.ssh` and `~/.pi` (`forbidden-subjects.ts:113`); both are `forbidden` everywhere. Provisioning additionally classifies as `sensitive` any line at or below, **or an ancestor of**, `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.docker` and (macOS) `~/Library/Keychains`. A grant admits its whole subtree, so `~/Library` would admit `~/Library/Keychains`. The first four match the credential folders `pi-trust-mirror` never covers (`packages/shared/src/pi-trust-mirror.ts:123`); `Keychains` is added here.

**Known pre-existing gap, not closed here:** the denial path can still grant these folders, and their ancestors such as `~/Library`, which admits `~/Library/Keychains`; its ladder carries no warning. This is recorded as a follow-up ("warn on or refuse credential-folder ancestors in the denial remedy") rather than widening this change.

### D6 — Bounds and rate limits

| Bound | Value | On breach |
|---|---|---|
| Lines per request | 32 | 400 `too-many-lines` |
| Pending per project root | 1 | 409 `pending-exists` + existing id |
| Pending total | 4 | 429 `capacity` |
| Creations per project root | 1 per 60 s | 429 `rate-limited` + retry-after |
| Cooldown after a request ended with no approved line (settled with none, dismissed, or expired) | 5 min per project root | 429 `cooldown` |
| Creations total | 3 per 10 min | 429 `rate-limited` |
| Request TTL | 10 min | `expired`; nothing granted |

Terminal transitions (settled / dismissed / expired) are first-wins; a later answer gets 409 `already-settled`.

**Residual, stated honestly.** Per-root limits do not bind an agent that creates `.git` in fresh directories (D8). The global limit still allows 18 dialogs per hour indefinitely, and a rotating agent can keep all 4 pending slots occupied, so legitimate requests get `429 capacity`. Mitigations in this change:
- the Access page lists every pending request with its claimed root;
- the Access page offers "Dismiss all pending", which counts as a dismissal for each request and starts each root's cooldown.

A block-by-requester control is a follow-up.

### D7 — Eligibility ladder (coupled to `accessGrants.promptEnabled`)

Creation is refused, in order, when:
- `PI_DASHBOARD_DISABLE_GRANT_PROMPT=1` (`isGrantPromptKilled`, `access-plane.ts:112`) → 503 `disabled`;
- `accessGrants.promptEnabled` is `false` → 409 `prompting-disabled`;
- the host gate is in `report` mode → 409 `report-mode`;
- `promptChannelCount() === 0` → 409 `no-operator`.

The same ladder gates settlement (D3). One switch covers every dialog, so the existing "prompting disabled" notice stays true unchanged. The default flips to on (D16) so the feature works on default installs.

### D8 — Project root

`projectRoot` must be absolute, exist, be a directory, hold an entry named `.git` or `.pi`, and not be ungrantable. The `.git`/`.pi` test moves from the private `isProjectRootDir` (`pi-trust-mirror-service.ts:182`) into a shared helper both use. Its real path is the pending key and every grant's `origin`. The agent can create `.git` anywhere it can write, so the origin is a *claimed* label: the UI says "requested for `<path>`", never "belongs to".

### D9 — pi trust per line

A `grantable` line whose real-path directory holds an entry named `.git` or `.pi` (the shared project-root helper, D8) shows `PiTrustCheckbox`, pre-set from the `accessGrants` source default (unchecked by default), with the consequence statement `pi-trust-mirror` requires. Wire format:

```ts
interface ProvisionResponseMessage {
  type: "provision_response";
  requestId: string;
  lines: { lineId: string; verdict: "approve" | "reject"; piTrust?: boolean }[]; // omitted lines = reject
}
```

For an approved project-root line, an omitted `piTrust` means `false`: the explicit choice is always stored, never left to the source default. `piTrust` is applied only to lines that end `granted`, by calling the trust-mirror service's per-entry choice write `mirror.setChoice("accessGrants", subject, piTrust)`, the same call `storePiTrustChoiceOfVerdict` makes (`server.ts:573`). `storePiTrustChoiceOfVerdict` (`server.ts:565`) cannot be reused as-is: it returns early unless `verdict === "allow-always"` on the `filesystem`/`cwd` planes. The `pi-trust-mirror` dialog list is extended in a spec delta.

### D10 — Remote goals are a hand-off to the wizard landing

`remote: ("lan" | "internet" | "device")[]` lines render as "Open Remote access" actions naming the task to pick (lan → "Allow devices on my network", internet → "Share over the internet", device → "Let a phone or laptop in"). The action opens `RemoteAccessDialog` on its landing, unchanged, which already shows every road's state. Outcome: `handed-off`. Provisioning writes nothing remote.

### D11 — Stated trust limit

**Operator decision A.** Approval proves that a capability-holding connection answered, nothing more.

A local process running as the operator, including the agent's `bash`, can:
- write the grant store directly;
- create `.git` to claim a project root;
- forge a browser-shaped WS (`capability-issuance.ts` header: "a process on the same machine can forge every header") to obtain a capability and settle its own request.

It can also already settle denial prompts through `POST /api/access/prompts/:promptId`, which checks no capability (`access-prompt-routes.ts:185`).

What provisioning gives:
- consent and audit on the honest path;
- a stop to *casual* self-approval (a plain operate-tier request).

It does not contain a determined local agent; the strength matches today's grant dialog. The dialog says this in one line, and the skill and the docs repeat it. Operator-presence proof (passkey user verification) is a follow-up change.

### D12 — Profile file

`.pi/access.json`, optional, read only by the skill:

```json
{
  "version": 1,
  "folders": [{ "path": "../shared-lib", "why": "sibling package used by tests" }],
  "remote": ["lan"]
}
```

Unknown `version` → the skill refuses. The server never reads the file; the skill sends its contents.

### D13 — Skill placement and modes

`packages/extension/.pi/skills/project-access/SKILL.md`, shipped beside `project-init`.
- `map` (read-only): session roots, covering grants with how each was created, YOLO state, pi trust, gate state, the fact that `bash` is ungated. Lists grants this project's sessions created: `origin` equals the project root, or `origin` is a session id whose cwd (sessions API, best effort) lies in it.
- `suggest`: drafts `.pi/access.json` from that list and reports its coverage gaps before asking to write: how many grants were skipped for an `unknown` origin, and whether the sessions API was reachable. Writes only after `ask_user` confirm.
- `provision`: submits, then polls `GET /api/access/provision/:id` until terminal. A 404 (server restarted) is reported as "unknown — check Settings ▸ Access".

project-init adds an opt-in step after the scaffold that runs `provision`.

### D14 — Observability

Log `[access-provision] created|settled|dismissed|expired|refused id= project=<json> lines= approved= reason=` (project JSON-quoted, as `pending-grant-registry` does for subjects); per-line `[access-grant] persisted … via=provision` from the existing persist path; dropped capability-less `provision_response` → `[access-provision] response-dropped reason=no-capability`. `/api/health` `accessGrants.provisioning = {pending, created, approved, rejected, dismissed, expired, refused, droppedResponses}` (cumulative except `pending`) via `snapshotAccessGrantHealth` (`access-health.ts:55`). The field is additive and optional; readers ignore it when absent.

### D15 — Revision of archived D12 and D15 (explicit)

- **D12** ("The Access tab reviews and revokes; it never creates a grant") — *kept*: no free-form add control anywhere. *Revised*: the Access page may answer a pending provisioning request it lists, because that request carries the same per-line verdict as the dialog.
- **D15** ("A grant may only name a subject that a recorded denial actually named") — *kept*: forbidden subjects on the stored value, real-path subjects, authentication, no cross-origin. *Replaced for this path only*: the denial binding becomes "a line the operator approved on a capability-holding connection, re-verified at approval". *Justification*: D15's binding protects callers that cannot see the denial; provisioning protects the equivalent property (the operator saw this exact real path) through the dialog, and is stricter in two ways the denial path is not: credential folders are refused (D5a), and settlement requires a capability (D3).

### D16 — Prompting defaults to on

Decided by the operator. `accessGrants.promptEnabled` becomes `true` when absent; an explicit value is kept as it is. Today the default is `false` (`packages/shared/src/config.ts:1654`, parse at `:2536-2540`).

Effect:
- denial dialogs (file previews, cwd pins, CORS/network in `legacy` trust mode) appear on default installs that have Host admission enforced and an operator browser open;
- provisioning works out of the box.

Automated environments keep `PI_DASHBOARD_DISABLE_GRANT_PROMPT=1`. Writers are partial (`writeConfigPartial`, `packages/server/src/config-api.ts:235`): none of this machine's config backups carry `accessGrants`, so "absent" really means "never chosen". A task audits for any writer that would persist the old default. Tests and harnesses that assume default-off are updated or set the value explicitly. Docs that state the old default (`docs/architecture.md` access-grant section, the `config.ts` comment near `:1124`) are updated. The agent path gate does not read `promptEnabled`; it has its own `agentPathGate` switch (`agent-path-confinement` "The gate is on by default…"), so its behaviour does not change.

## Risks / Trade-offs

- [Machine-wide reach: a folder provisioned for X is open to every session] → dialog copy says so; Access page shows "requested for"; revoke is one click.
- [Reverses D12/D15 for one path] → D15 above; no free-form add; capability-gated settlement; credential folders refused.
- [Agent can still answer *denial* prompts via `/api/access/prompts/:promptId`, and can forge a capability to settle provisioning] → accepted under decision A. Follow-ups: "require a capability for Access-page settle of *denial* prompts (`access-prompt-routes.ts:185`)"; "passkey proof for approvals"; "warn on or refuse credential-folder ancestors in the denial remedy"; "block a provisioning requester".
- [Default flip surprises existing default-off installs with denial dialogs] → called out in CHANGELOG; one toggle on the Access page (or the env kill switch) turns it off.
- [200 provisioned grants fill the store, so denial-path grants are refused] → the 32-line cap and per-root pending keep this slow; the operator revokes on the Access page; eviction and refusal are logged.
- [Prompt fatigue from repeated requests] → D6 rate limits and cooldown.
- [Folder swapped between dialog and approval] → D5 re-verification; sub-millisecond residual equals every grant write.
- [No operator browser open → feature looks broken] → explicit `no-operator`; skill says to open the dashboard and retry.
- [Server restart while pending] → request lost, nothing granted; skill reports "unknown"; grants written before a crash stay and are listed.

## Migration Plan

Additive: new routes, messages, `via` value and `recordGrant` option. No store migration; older builds preserve `via: "provision"` on read.

**Behavioural:** the `promptEnabled` default flips to on (D16). There is no config migration: explicit values are kept, absent means on. CHANGELOG entry under Changed.

Rollback: revert the change. Provisioned grants stay ordinary, revocable grants. Prompting returns to default-off for configs without the key; operators who want it on set it explicitly before rolling back.
