## Why

The security map (`docs/security/residual-risks.md`, tool-call guards) lists six findings
about the agent-side guards that are cheap to close or to pin down precisely, and none is
owned by another change. The register wording overstated three of them; the corrected,
re-verified scope (HEAD `109f2e197`) is:

- **TOOL-04 (Medium).** The agent's built-in `read` of `~/.pi/agent/auth.json` (API keys +
  OAuth refresh tokens), `mcp-auth.json`, `providers.json`, `models.json`, `mcp.json`,
  `system-one/auth.json` and `sessions/**` (every other project's transcripts) never
  prompts: the path gate puts the whole pi agent dir in a read-only root and returns
  `in-root` before the sensitive check (`extension/src/path-gate/decide.ts:71,78,88`,
  `roots.ts:132`). The credential guard shipped by `encrypt-credentials-at-rest` protects
  only `plugin-credentials.json`, `vault.json` and the data-key file
  (`extension/src/credential-guard.ts:130-140`). `close-security-map-high-findings` D1
  closes the server HTTP side only and leaves this unowned.
- **TOOL-08 (Medium).** Any headless dashboard spawn auto-answers pi's `project_trust`=yes
  for the exact spawn cwd (`extension/src/project-trust.ts:143-144`). MCP `spawn_session`
  (tier `control`, i.e. an agent's per-session token) reaches it for any existing directory
  (`server.ts:4188-4200`, `process-manager.ts:875`), so code from a hostile clone's `.pi/`
  runs with no LLM or human step, and the project's guard settings are honoured (including
  `mode:"off"`).
- **TOOL-09 (Medium, design limitation).** The untrusted-content guard is not installed by
  default, its default sources/sinks are narrow, and the project layer can lower it
  (`untrusted-content-guard/src/settings.ts:67,104`).
- **TOOL-05 (Low).** `~/.aws`, `~/.config/gh`, `~/.gnupg`, `~/.kube`, `~/.docker`,
  `~/.netrc` and browser profiles are not sensitive: the card offers "Always allow" and an
  operator-activated unscoped YOLO auto-allows them (`shared/src/forbidden-subjects.ts:113`,
  `server/src/access/yolo-session.ts:325-327`).
- **TOOL-03 (Low, was Medium).** Guard self-disable through `bash` adds no capability while
  `bash` is ungated; the other roads are blocked. Documentation only.
- **TOOL-07 (Low, was Medium).** "toolPolicy set, guard missing" is already fail-closed
  (`chat-gateway/src/server/gateway.ts:605-615`). What remains: a typo'd `guardExtension`
  still spawns ungated because nothing verifies the guard loaded.

## What Changes

- **D1/D2 (TOOL-04).** `auth.json`, `mcp-auth.json`, `providers.json` and
  `system-one/auth.json` of both agent dirs join the credential guard's protected set
  (hard block, no override, `<name>.*` siblings, path + text rules). `models.json`,
  `mcp.json` and other projects' `sessions/**` leave the read-only root: an agent `read`
  asks, marked sensitive, `Allow once`/`Deny` only. The session's own session dir, skills,
  prompts and `settings.json` stay silent. Carve-out paths always ask under every root
  (workspace, checkout, grant).
- **D3 (TOOL-08).** The bridge's headless-spawn `project_trust`=yes
  (`project-trust.ts:143-144`) is no longer unconditional: an activation cwd is decided
  through the existing dashboard-trust decision (pinned folder, inside a workspace folder,
  covered grant or YOLO root; a recorded pi entry still wins) and is otherwise left to pi
  (`trust.json`, then `defaultProjectTrust`; RPC has no prompt). The rule is
  road-independent for every pi spawn: MCP, automation, goal, `/new`, worktree, REST and WS
  (ACP starts no pi bridge and is outside the rule).
  No flag, env, record field or server state.
- **D4 (TOOL-08/09).** The project layer of the untrusted-content guard can only tighten
  (mode up, tool lists unioned, `taintScope` to session, no `allowHosts`; a project
  `preset:"strict"` is honoured as tightening).
- **D5 (TOOL-09).** The guard's manifest entry becomes `strongly-suggested`; defaults,
  taint reset and `selfConfirming` are unchanged and recorded as the remaining limits.
- **D6 (TOOL-07).** The chat-gateway guard announces readiness; the gateway binds it to the
  session the spawn resolved to, delivers the triggering message through `send_prompt` only
  after it, shuts down a session whose guard never announces, and refuses the spawn on a host
  that cannot deliver the announcement (no fallback to an unverified spawn).
- **D7 (TOOL-05).** One shared `sensitive` list gains the CLI credential dirs, `~/.netrc`
  and browser user-data roots: no always-allow, no grant, no ladder rung, no YOLO auto-allow.
    Persisted grants that now match are not admitted and not deleted (grant-store writes keep
  the raw rows). Non-local file browse stops serving those directories.
- **D8 (TOOL-03).** Documented, not changed; hand-off to supervised mode recorded.
- **Docs:** CHANGELOG `Unreleased` (Security + BREAKING), register/chapters via DocScribe.

**BREAKING** (four user-visible changes):

1. **Agent reads of pi provider secrets are blocked** (`auth.json`, `mcp-auth.json`,
   `providers.json`, `system-one/auth.json`; no operator override). `models.json`,
   `mcp.json` and other projects' session transcripts now prompt on `read`. Headless
   sessions without a UI are blocked on those.
2. **A dashboard spawn no longer auto-trusts a folder dashboard trust does not cover.**
   A session spawned (UI, MCP, REST, WS, automation) into an unpinned, non-workspace,
   ungranted folder runs without its project `.pi/` resources unless pi's `trust.json`
   or `defaultProjectTrust: "always"` trusts it. Remedy: pin the folder, add it to a
   workspace, or record trust with `/trust` in a terminal pi. `piTrustMirror.enabled:false`
   now also disables the activation-cwd auto-trust.
3. **Credential dirs and browser profiles cannot be granted or YOLO-admitted**, a directory
   containing one (e.g. `~/.config`) is no longer a grant/YOLO root or ladder rung, and a
   project's `.pi/settings.json` can no longer lower the untrusted-content guard.
4. **A custom chat `guardExtension` must announce readiness**, or its spawns are refused; a
   host without plugin-message handlers refuses guarded chat spawns. Non-local file browse
   of the new credential directories is refused, and `~/.config`-like roots outside `$HOME`
   stop being shared browse roots.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `credential-file-guard`: MODIFIED "Protected credential paths" (adds the four provider
  secret files of both agent dirs), "Tool input naming credential files is blocked"
  (text needles for them).
- `agent-path-confinement`: MODIFIED "Session roots" (agent dir root excludes the paths of
  the new requirement), "Always allow requires a second deliberate step" (never offered for
  them); ADDED "Some agent-directory paths are asked about even for reads" (no root or grant
  admits them).
- `path-anchor-grants`: MODIFIED "A grant names the subject a recorded denial named, or one
  of its offered ancestors" (the refused-subject list names the new credential directories,
  "no entry outside this list" now includes them); ADDED "Credential and browser-profile
  directories are sensitive grant subjects", "A grant store write never discards an entry it
  does not admit".
- `server-capability-bounds`: MODIFIED "Shared-root set" (new sensitive directories, dropped
  roots).
- `access-grant-yolo`: ADDED "YOLO never auto-allows a credential or browser-profile
  directory".
- `bridge-extension`: MODIFIED "Bridge auto-decides project_trust for dashboard-spawned
  headless sessions in the activation cwd" (activation cwd decided through dashboard trust
  only; no unconditional yes).
- `pi-trust-mirror`: MODIFIED "One decision order serves every consumer" (the activation-cwd
  rule leaves the bridge's session gate; a mirror-disabled bridge returns undecided), "The bridge
  decides at project_trust from the snapshot" (closed reason-code list gains `not-covered`; uncovered
  activation cwd → undecided), "The Access page discloses pi trust conferred by the dashboard"
  (lists `not-covered` with a label).
- `mcp-client-folder-section`: MODIFIED "Folder MCP page follows pi's project rules" (no "trusted per run"
  exception for dashboard-spawned headless sessions in the not-trusted notice).
- `dashboard-mcp-server`: ADDED "MCP spawn_session does not auto-trust a folder dashboard
  trust does not cover" (one scenario covers every spawn road).
- `untrusted-content-guard`: ADDED "A project's settings can only tighten the guard".
- `chat-gateway`: MODIFIED "Hard in-session tool policy for spawned sessions" (guard
  readiness bound to the resolved session before the first message; no-guard spawn ended;
  host without handler support refuses), "Triggering message runs on spawn or resume" (with a
  guard the message goes through `send_prompt` after readiness).

Spec collateral (`node scripts/spec-collateral.mjs`) flagged `pi-trust-mirror`
("never covers forbidden folders"), `access-provisioning` ("Credential folders are not
provisionable"), `spawn-correlation` (capture-once token) and `bridge-decomposition` as
candidates: reviewed, each stays true as written (the new list is a superset; token handling
is unchanged). `pi-trust-mirror` "One decision order" is MODIFIED above for the activation-cwd rule.

## Impact

- Extension: `credential-guard.ts`, `path-gate/{decide,roots,index}.ts`,
  `project-trust.ts` (activation branch only).
- Shared: new `agent-credential-files.ts`, `forbidden-subjects.ts`, `pi-trust-mirror-types.ts`
  (reason `not-covered` + label),
  `recommended-extensions.ts` (+ its test).
- Server: `access/access-grants.ts` (load filter + raw-row-preserving
  writes, corrupt-file move-aside, 1 MiB store ceiling), `lib/browse-roots.ts` (verified, no code change expected).
- Plugins: `chat-gateway/src/{guard/index.ts,server/seam.ts,server/gateway.ts}`;
  `mcp-client-plugin/src/client/FolderMcpPage.tsx` (copy only).
- Package: `untrusted-content-guard/src/settings.ts` (+ release).
- No new route, no tier change, no config key, no protocol or sidecar field; no data migration.
- Migration/rollback/compat: see design (each item independently revertable; grants not
  admitted but preserved in the store file).

## Discipline Skills

- `security-hardening` — secret containment, removing an auto-trust road from an
  agent-reachable surface, tighten-only layering, fail-closed guard readiness.
- `doubt-driven-review` — D1/D7 set a compatibility line (files and directories an agent
  or operator can reach today) and D3 changes a specified bridge behaviour; review before
  they stand.
- `observability-instrumentation` — new log lines: ignored
  project guard fields, grants filtered at read, guard readiness timeout. No secrets or
  paths of file content in any of them.

## Ownership / not in scope

| Finding / item | Status | Owner |
|---|---|---|
| TOOL-04 server HTTP routes (`GET /api/file` etc.) | Out of scope | `close-security-map-high-findings` (D1); name sets de-duplicated by task 1.9 |
| Legacy plain API keys in `~/.pi/agent/settings.json` / project `.pi/mcp.json` | Residual, not covered | none (`pi-legacy-credentials` migration is the mitigation) |
| `bash` stays ungated; credential guard best-effort | By design (documented) | `add-supervised-tool-approval` is `related` |
| TOOL-03 self-disable via `bash` | **Documented, no code**; hand-off: pin gate/supervised state at session start when `bash` becomes restrictable | `add-supervised-tool-approval` |
| TOOL-08 spawn into an unpinned, non-workspace, ungranted folder (MCP, REST, WS, automation, goal, `/new`, worktree, UI; every pi road) | Closed by the rule (no auto-trust; pi `trust.json` / `defaultProjectTrust` decide) | — |
| TOOL-08 a folder the operator pinned / added to a workspace / granted is trusted for any spawner (a clone inside a pinned folder included: pin trust is subtree-wide) | Residual, by design | none |
| TOOL-08 host with `defaultProjectTrust:"always"` in pi's settings | Residual: pi loads project resources when no extension answers (`dist/core/project-trust.js:42-44`) | none |
| ACP sessions (`acp-spawn.ts`: in-process host or adapter over an external agent; no pi process, no bridge, no `project_trust`) | Not applicable to the D3 rule; the agent applies its own project-config trust (residual, verified from code at apply time) | none |
| `~/.netrc.*` siblings and Windows `_netrc` | Residual (only the exact `~/.netrc` is sensitive) | none |
| Snap/flatpak browser profile locations (`~/snap/firefox`, `~/.var/app/*`) | Residual (design D7 table is the normative list) | none |
| Guarded chat spawn orphaned by a gateway/server restart while awaiting readiness | Residual: session idle and unbound, no chat message delivered; no cleanup | none |
| Credential files of a third agent directory pi reports (differs from `~/.pi/agent` and `PI_CODING_AGENT_DIR`) | Residual for the credential guard; the ask-on-read carve-out covers it | none |
| Agent `write`/`edit` of `models.json`/`mcp.json`/`sessions/**` when a workspace root spans the agent dir (cwd = `$HOME`, dotfiles checkout) | Residual: the carve-out is read-only | none |
| DEP-02 realpath before file-read containment layer ① | Out of scope (server file read; `DEP-02 ↔ TOOL-11` symlink handling) | `close-local-listener-and-egress-gaps` |
| ELEC-01 Electron main-window permission handler | Out of scope | `close-local-listener-and-egress-gaps` |
| TOOL-09 non-default taint sources, ungated sinks (`write`/`edit`/`read`/MCP control), any-input taint reset, unattributed `selfConfirming` | **Residual, not closed** (needs pi-side input source + registry identity) | none; follow-up change |
| TOOL-09 install-by-default | Not done (BREAKING, contradicts bundled-empty spec); promoted to `strongly-suggested` only | none |
| TOOL-07 no `toolPolicy` = full tool set | By design, documented | — |
| `provisioning.ts` / `pi-trust-mirror.ts` local credential lists | Residual drift; superset consistency verified | none |
| Windows alternate names of credential files (`auth.json::$DATA`, 8.3) | Residual (as in `close-security-map-high-findings` G5) | none |
