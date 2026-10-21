# Proposal

## Why

Agents that work across sibling repos, worktrees, media folders and spike directories hit the agent path gate again and again. This machine's grant store holds 28 grants, and each one was a separately answered prompt (22 from agent prompts, 6 from dashboard prompts). Today a persisted grant can only be created from a denial the operator just saw (`path-anchor-grants`; `access-settings-tab`; D12/D15 of `add-access-grants-and-review`), and YOLO is time-boxed and saves nothing. There is no way to say once, up front, "this project needs these folders", and the project initializer cannot ask either.

## What Changes

- **NEW: provisioning request.** `POST /api/access/provision` (operate tier) takes a project root, up to 32 folder lines and optional remote-access goals. It writes **nothing**. It resolves and classifies each line (`grantable` / `covered` / `in-root` / `forbidden` / `sensitive` / `missing` / `invalid`), records one pending request (bounded, rate limited, expiring), and sends a dialog only to browser connections that hold a prompt capability. `GET /api/access/provision` lists pending requests; `GET /api/access/provision/:id` reports the outcome; `POST /api/access/provision/:id/settle` answers one (capability required).
- **NEW: provisioning dialog.** It shows each line's real path, reason and classification. It states that approved folders apply to every session on the machine and that the project name is the requester's claim. Each line has its own approve control and none is preselected; dismissing the dialog rejects everything. Project-root lines offer the existing "also trust in pi" checkbox. A `provision_response` is accepted only from a socket that holds a live capability, so an agent's plain `curl` cannot approve its own request. A local program that forges a browser connection can still approve, and an agent can already settle *denial* prompts through the existing Access-page route. Like today's grant dialog, this is consent plus audit, not containment (operator decision A). Proof of operator presence via passkey is a follow-up change.
- **Approved lines become ordinary persisted grants.** They are re-verified when the operator approves, then written in one synchronous section with `via: "provision"` and the project root as `origin`. They go to the same store, follow the same forbidden-subject and real-path rules, and are revoked the same way. Folder-based and machine-wide, like every persisted grant. Provisioning never evicts an older grant: if the net-new approved folders exceed the store's free capacity (200 per scope), every approved line is refused and nothing is written. "Permanent" means kept until revoked: provisioned grants are never chosen for eviction, and another write at the cap evicts the oldest non-provisioned grant instead.
- **Credential folders are refused.** `~/.ssh` and `~/.pi` are already forbidden everywhere. `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.docker` and `~/Library/Keychains`, and any ancestor of them (such as `~/Library`), cannot be provisioned. The denial path can still grant those five and their ancestors; that pre-existing gap is a follow-up.
- **Provisioning follows the prompting switch, and that switch defaults to on (behavioural change).**
  - `accessGrants.promptEnabled` now defaults to `true` when absent. Explicit values are kept.
  - Provisioning is refused with `prompting-disabled` when the switch is off, and the answer is re-checked against the switch, the kill switch and Host admission.
  - Default installs will now see denial dialogs as well. Turn them off with the Access-page toggle or `PI_DASHBOARD_DISABLE_GRANT_PROMPT=1`.
- **Remote access is handed off, not written.** Remote goals open the Remote access dialog on its landing and name the task to pick there. Nothing writes `trustedNetworks`, CORS origins or pairing state.
- **NEW: `project-access` skill**, shipped by the bridge extension beside `project-init`:
  - `map`: a read-only report of the project's effective access.
  - `suggest`: drafts `.pi/access.json` from the project's past grants.
  - `provision`: submits a request and reports each line's outcome.
- **NEW: `.pi/access.json`**, optional and in the repo. It is a proposal only: the server never reads it, and nothing in it takes effect without line-by-line approval.
- **project-init** offers access provisioning as an opt-in step after the scaffold.
- **Access page** lists pending provisioning requests and lets the operator answer them (capability required). It labels provisioned grants "requested for `<project>`" and offers "Dismiss all pending". It still has no free-form add control.

Mockup: to be produced before UI build (task 3.1).

## Capabilities

### New Capabilities

- `access-provisioning`: operator-approved, ahead-of-time provisioning of persisted folder grants from a project profile. Covers the request routes and messages, line classification, credential-folder refusal, bounds and rate limits, eligibility, capability-gated settlement, the provisioning dialog, approval-time re-verification without eviction, the per-line pi-trust choice, remote hand-off, observability, the `.pi/access.json` format, the `project-access` skill and the stated trust limits.

### Modified Capabilities

- `path-anchor-grants`:
  - The denial-binding requirement gains a third recorded binding: an approved provisioning line.
  - The 200-entry bound gains no-evict rules: provisioning writes never evict, and provisioned grants are never evicted.
  - ADDED: a requirement for provisioning-originated grants.
- `access-grant-dialog`: "Prompting is opt-in and can be disabled outright" changes so that prompting defaults to on, an explicit `false` disables it, and explicit settings are kept.
- `access-settings-tab`:
  - "Reviews and revokes; does not create grants" lists the third origin.
  - ADDED: listing and answering pending provisioning requests.
  - ADDED: the "requested for" label.
- `pi-trust-mirror`: the per-entry-choice requirement adds the provisioning dialog's project-root lines to the dialogs that offer the checkbox.
- `project-init-skill`: ADDED an opt-in access-provisioning step after the scaffold.

## Discipline Skills

- `security-hardening`: adds a new way for a persisted grant to come into existence, reopening part of what D12/D15 closed; flips the prompting default.
- `doubt-driven-review`: deliberately revises recorded security decisions D12/D15 and must stand before build.
- `observability-instrumentation`: new routes, messages and request lifecycle, with log lines per transition and `/api/health` counters.
- `review-code`: before commit.

## Impact

**Server**
- New `packages/server/src/access/provisioning.ts` (registry, classification, settle).
- `recordGrant` gains `evict: false`; the `via` union gains `"provision"` on `AccessGrant` and `RecordGrantInput` (`access-grants.ts`).
- The `.git`/`.pi` project-root test is extracted from `pi-trust-mirror-service.ts` into a shared helper.
- Routes in `packages/server/src/routes/access-routes.ts`.
- `server.ts` wiring for the WS handler and the capability-targeted send helper (`pairing/browser-gateway.ts`).
- `/api/health` counters (`access-health.ts`).

**Shared**
- `browser-protocol.ts`: `provision_request` / `provision_response` / `provision_dismiss`.
- `ws-message-tiers.ts`: `provision_response: "operate"`.
- `route-tiers.ts` rows for the four routes.
- `identity/ws-message-scope.ts` entry and an `identity/ws-road-classification.ts` (`WS_ROADS`) row.
- `config.ts`: `promptEnabled` default flips to `true` (`:1654`, parse at `:2536-2540`).

**Client**
- Provisioning dialog beside `components/access-grant/`.
- Access page rows.
- i18n keys (en, hu, zh-CN).

**Extension**
- New skill `packages/extension/.pi/skills/project-access/`.
- `project-init` SKILL.md step.
- `pi-dashboard` skill references.
- The bridge path gate is unchanged (`grant-cache.ts` reads only `subject` and `scope`).

**Compatibility and rollback**
- `via` is optional and additive, so no migration. Older builds keep `via: "provision"` through reads.
- The `promptEnabled` default flip is behavioural: CHANGELOG entry under Changed. Tests and harnesses that assume default-off must be updated.
- Rollback: revert the change. Provisioned grants stay as ordinary grants that can be revoked.
