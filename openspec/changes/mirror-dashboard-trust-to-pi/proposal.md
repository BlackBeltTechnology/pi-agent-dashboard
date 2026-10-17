## Why

The dashboard durably trusts folders through several stores — worktree-init hook trust, workflow trust, pinned folders (including Docker `PI_WORKSPACES` pins), folder-workspaces, access grants. pi never learns any of it: apart from the bridge's narrow per-run rule for a dashboard-spawned session's own start folder, `~/.pi/agent/trust.json` stays the only input to pi's `project_trust` resolution and to the dashboard's own `host.isProjectTrusted`. The result is a split brain: the agent may freely read, write and execute in a folder, yet pi keeps that folder's `.pi/mcp.json`, extensions and packages inactive, and the MCP folder page reports "pi does not trust this project yet". Project trust is not a sandbox for tool calls (pi `docs/security.md`), so once the dashboard durably trusts a folder, withholding pi's startup-load consent there protects little and confuses a lot.

## What Changes

- **NEW** dashboard trust → pi mirror for sessions on the **same machine**, from **durable** sources only: persisted worktree-init trust for the CURRENT hook hash, persisted workflow trust, pinned folders (incl. Docker-seeded), folder-workspaces, persisted access grants on project roots. Each entry covers its folder's subtree. Never counted: exactly `/`, `$HOME`, its ancestors, system dirs and broad parents (`/Users`, `/home`, …); anything at or below `~/.ssh`, `~/.pi`, `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.docker`, temp dirs, `~/.cache`, `~/Downloads`; YOLO and other server-lifetime trust (in-memory only); KB source trust (not folders). These mirror rules are separate from — and do not alter — the dashboard's grant-subject rules.
- **NEW** folder decision, shared by every consumer: implicit trust (no trust-requiring resources) → pi's nearest recorded entry (true or false) → dashboard trust → `defaultProjectTrust`. A recorded pi entry always wins; dashboard trust deliberately takes precedence over `defaultProjectTrust` including `"never"` (documented). Deciding never writes `trust.json`.
- **NEW** server-written snapshot `~/.pi/dashboard/pi-trust-mirror.json` (durable entries with canonical path, device, inode, birth time, hook hash); the bridge's `project_trust` handler decides from it plus `config.json` and a lockless `trust.json` read — **no server round trip**, works while the server is down. An entry applies only when the bridge sees the same folder identity (path + device + inode + birth time), so other machines and re-created folders fail closed.
- **NEW** config `piTrustMirror { enabled (default true), coverInteractive (default false), sources.<id> }` — sources default ON except `accessGrants` — plus a per-entry choice from an "Also trust this folder in pi" checkbox (states the consequence) in every dialog that creates a mirrorable entry.
- **MODIFIED** bridge `project_trust` handler: consults dashboard trust for dashboard-spawned headless sessions, and for other sessions only when `coverInteractive`. Still per-run, never remembered. **BREAKING (behaviour):** (a) a recorded pi entry now takes precedence over the activation-cwd auto-trust; (b) the activation-cwd auto-trust no longer applies in forbidden/temporary folders (logged); (c) the spawn token is removed from the environment at activation, so agent-started nested pi never qualifies. (a)–(b) are not reverted by the `piTrustMirror.enabled` switch.
- **MODIFIED** `host.isProjectTrusted` (still boolean, honours `PI_CODING_AGENT_DIR`) uses the shared decision; optional `host.projectTrustSource` feeds the MCP effective view. The folder MCP page states who trusts the folder; live state for dashboard-only-trusted folders is "not checked by pi" (`pi mcp list` takes no approve flag); the boot-time fallback that silently reads every folder untrusted now logs.
- **MODIFIED** resource-toggle trust gate: in a dashboard-trusted folder the existing trust prompt appears with "Trust" pre-selected, the dashboard source named, and the lasting effect stated (terminal pi honours it; unpinning does not remove it); nothing is recorded until the operator chooses, then only through `persistTrustDecision`.
- **NEW** Access page: per-entry pi-trust state and choice, an "Effective pi trust" list (source, subtree, ignored-with-reason) next to pi's `trust.json` entries and the agent dir they come from.
- **Deferred to a follow-up change** (out of scope here): server-lifetime trust — "until dashboard restarts" worktree trust, session access grants, every YOLO session (in-memory only; YOLO's default-ON decision carries over) — and bridges on other machines; they need a live server query with a startup budget and a real remote proof.

## Capabilities

### New Capabilities
- `pi-trust-mirror`: durable source registry, filters, canonical subtree matching, folder decision, same-folder identity, snapshot-only bridge decision, `piTrustMirror` config and per-entry choice, Access-page disclosure.

### Modified Capabilities
- `bridge-extension`: the `project_trust` auto-decision consults dashboard trust; recorded pi entries and forbidden folders now stop the activation-cwd rule.
- `mcp-client-config`: the project-trust predicate is the shared folder decision with an optional source; dashboard-only trust reports live state "not checked by pi".
- `mcp-client-folder-section`: the folder page states who trusts the folder, or that nobody does.
- `cross-scope-resource-disable`: dashboard trust pre-selects "Trust" in the existing prompt (still recorded only on the operator's choice).
- `spawn-correlation`: the single-use spawn token is read and scrubbed at bridge activation (kept in bridge state for the first register), so nested pi never inherits it even while the dashboard is unreachable.

## Impact

- `packages/shared`: `piTrustKey`, `decidePiTrust`, `filterMirrorEntries`, `mirrorDenyRules` (separate from `forbidden-subjects`), pure hook normalise/hash (moved from `worktree-init.ts`), snapshot types.
- `packages/server`: durable source registry over `worktree-init-trust.ts` (revoke reports write failures), `workflow-trust.json` (when `add-project-workflows` lands), `preferences-store` pins/folder-workspaces (write-through on revoke), `access-grants.json`; snapshot + choices writers (revocation writes the snapshot first; grant fails if the choice write fails); mcp-client config-writer collisions keep pi-only trust; `host-project-trust.ts` (+ optional `host.projectTrustSource`, agent dir); `resource-toggle-trust.ts`; config schema.
- `packages/extension`: `project-trust.ts` + `registerProjectTrust` (activation capture + token scrub, lockless store read with pi's rules, snapshot decision, canonical activation compare, deny rules on the activation rule).
- `packages/client`: grant dialogs (worktree-init, workflow, pin, Add Folder, access prompt), Settings → Access, MCP folder banner, toggle-prompt pre-selection.
- `packages/mcp-client-plugin`: trust source in the effective view, banner states, "not checked by pi" live state.
- `docker/`: none — `PI_WORKSPACES` becomes pins via `PI_DASHBOARD_PIN_DIRS` (seeded once on first run); server and sessions share the container's view.
- Compatibility: default `enabled: true` changes behaviour on upgrade — durably dashboard-trusted folders (except via access grants) start loading project resources in dashboard-spawned headless sessions, also where `defaultProjectTrust` is `never`. Terminal and interactive pi stay unaffected unless `coverInteractive`. The three bridge behaviour changes above apply. Rollback: `piTrustMirror.enabled=false` in `config.json` (works with the server down); nothing is ever written to `trust.json` by this change.
- Sequencing: rebase after `retire-trusted-networks-bypass` (both change the Access page; this change carries no `access-settings-tab` delta); coordinates with `addons-hub-folder-view` (inherits the toggle pre-selection) and `add-project-workflows` (fills the `workflow` source); records the new boundary in the security-boundary inventory left by the archived `security-boundary-audit`; `add-plugin-isolation-and-public-routes`' `--no-approve` still wins (pi applies it first).

## Discipline Skills

- `security-hardening`: widens which folders auto-load executable project resources; deny-list; same-folder identity; lockless parsing of `trust.json`.
- `doubt-driven-review`: changes a security boundary and defaults it ON for existing installs.
- `observability-instrumentation`: decision source disclosure, Access-page ignored-with-reason, boot-time fallback log.
