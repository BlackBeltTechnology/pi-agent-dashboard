## Context

All paths are under `packages/` unless noted. Findings come from
`docs/security/residual-risks.md` (TOOL-03 :108, TOOL-04 :109, TOOL-05 :110, TOOL-07
:111, TOOL-08 :112, TOOL-09 :113). Premises were re-verified at HEAD `109f2e197`
(`/tmp/secmap/batch2/VERIFY-D.md`); the TRUE scope below replaces the register wording.
Tier order is `observe < control < operate` (`shared/src/tiers.ts:17`).

### TOOL-04 today (agent `read` of pi's own secrets never prompts)

- The path gate puts the whole pi agent dir in the read-only root set:
  `extension/src/path-gate/roots.ts:132` (`ro = [res.agentDir, ...]`). For `read`,
  `decidePathAccess` adds `readOnly` to the rooted set (`path-gate/decide.ts:71`) and returns
  `in-root` at `decide.ts:78`, **before** the `sensitive` flag is computed (`:88`). So
  `~/.pi/agent/auth.json` (API keys + OAuth refresh tokens), `mcp-auth.json`, `providers.json`,
  `models.json`, `mcp.json`, `system-one/auth.json` and `sessions/**` (every other project's
  transcripts) are read without a prompt. Writes already prompt: "a write whose target lies
  only within a read-only root SHALL be treated as outside the roots"
  (`openspec/specs/agent-path-confinement/spec.md`, "Session roots").
- The shipped credential guard (archived `2026-10-26-encrypt-credentials-at-rest`, spec
  `credential-file-guard`) runs before the path gate (`extension/src/bridge.ts:1965-1974`) but
  protects only `plugin-credentials.json`, `vault.json` and the data-key file
  (`extension/src/credential-guard.ts:130-140`; `shared/src/credential-encryption.ts:25-28`).
- `read` is not a default `sensitiveTools` entry of the untrusted-content guard
  (`untrusted-content-guard/src/settings.ts:30-36`), so taint does not stop it either.
- `close-security-map-high-findings` D1 refuses the same files on the **server HTTP** routes
  (`lib/dashboard-state-guard.ts`, its design.md:411-445) and marks the agent-side read an
  unowned residual (its design.md:168-174). This change closes the agent side.
- Trap: `credential-guard.ts:209` builds the text-rule needles with
  `protectedLexical().slice(2)`, i.e. it relies on the first two array entries being the two
  home paths. Adding protected names changes the array shape; the needle list must be built
  explicitly (task 1.3).

### TOOL-08 today (headless spawn answers `project_trust`=yes)

- `decideBridgeProjectTrust` trusts the exact activation cwd for any dashboard-spawned
  headless session unless pi's `trust.json` has an entry or the folder is mirror-denied
  (`extension/src/project-trust.ts:143-144`; spec `bridge-extension`, "Bridge auto-decides
  project_trust for dashboard-spawned headless sessions in the activation cwd"). Project
  `.pi/extensions` then run, and a project `untrusted-content-guard.mode:"off"` is honoured
  (`untrusted-content-guard/src/extension.ts:26-33`, `settings.ts:104`).
- Every dashboard spawn road is affected alike, because the rule lives in the bridge, not in
  the spawner: MCP `spawn_session` (manifest tier `control`,
  `mcp-server-plugin/src/server/tools.manifest.ts:45` → `ctx.spawnSession({cwd})`; the host
  hook admits any trusted plugin with a non-empty cwd, `server/src/server.ts:4188-4200`, and
  `spawnPiSession` only checks `existsSync(cwd)`, `spawn-process/process-manager.ts:875`), REST
  `POST /api/session/spawn`, WS `spawn_session`, automation/goal/team/chat, `/new`,
  worktree and subfolder spawns. ACP sessions are not on this list: they start no pi process
  and no bridge (verified at apply time, see Risks), so there is no `project_trust` to answer. Net: a control-tier agent can run code from a hostile clone
  with no LLM or human step (it already has `bash`; the new capability is the absence of any
  step).
- Dashboard trust the bridge already consults (`project-trust.ts:161-187` `decideFromMirror`):
  durable snapshot entries — pinned folders, folder-workspaces, persisted access grants,
  worktree-init and workflow trust (`server/src/access/pi-trust-mirror-service.ts:180,184,193`,
  `shared/src/pi-trust-mirror-types.ts:10`, spec `pi-trust-mirror` "Dashboard trust is derived
  from durable trust sources") — plus a bounded live query for server-lifetime entries (YOLO
  roots, session-scoped grants; `server/src/access/pi-trust-live.ts:135-143,180`). Source
  switches default in `shared/src/config.ts:937-942` (`accessGrants` off, the rest on).
- pi's behaviour when no extension answers (`project_trust` undecided), verified in the
  installed pi: saved decision (`trust.json`), then `defaultProjectTrust`: `"always"` trusts,
  `"never"` does not, `"ask"` (default) prompts only if the context has a UI
  (`dist/core/project-trust.js:38-58`); an RPC process starts with `hasUI:false`
  (`dist/main.js:622`), so `ask` returns untrusted with no prompt
  (`dist/core/project-trust.js:50-52`). pi docs: `docs/security.md:61-82` ("Project trust
  without an interactive prompt"). So for a headless dashboard session "pi decides" means
  `trust.json`, else `defaultProjectTrust`; there is no dashboard prompt.
- A `--no-approve` road exists (`scope.noProjectTrust`, `shared/src/platform/spawn-mechanism.ts:195`)
  but pi applies it before any extension, so it would also strip `.pi/` skills/flows of
  pinned repos.

### TOOL-09 today (guard optional, narrow, and project-lowerable)

- `pi-untrusted-content-guard` is `status:"optional"`, `autowired:true` (works once
  installed, not installed by default) (`shared/src/recommended-extensions.ts:658-673`).
  Only the e2e harness stages it (`docker/test-entrypoint.sh:634-642`). There is no
  auto-install; the bundled set is empty by spec (`bundled-recommended-extensions`).
  `required` entries show a dismissible banner (`client/.../MissingRequiredBanner.tsx:38`).
- Defaults: untrusted sources = `fetch_content`, `web_search`, `get_search_content`; sensitive
  sinks = `bash`, `*_send`, `*_reply`, `*_delete`, `*_trash`, `*_modify`
  (`untrusted-content-guard/src/settings.ts:30-36`). `write`/`edit`/`read` and MCP control
  tools are ungated; `preset:"strict"` adds only `write`/`edit` (`:75-81`).
- Any `input` clears taint in run scope (`guard.ts:116-118`, `extension.ts:46-48`); any
  extension can push a `selfConfirming` declaration to the shared registry, which exempts
  that tool (`guard.ts:205`, `registry.ts:36-41`). The registry has no extension identity.
- The project layer **replaces** user values: `resolveSettings` does `Object.assign` per layer
  (`settings.ts:67`) and `loadSettings` feeds it `global` then `project` (`:104`). A trusted
  project can set `mode:"off"`, replace `sensitiveTools` with `[]`, or add `allowHosts`.
  Project trust is exactly what TOOL-08 hands out.

### TOOL-05 today (credential dirs are not sensitive)

- `forbiddenGrantSubjects().sensitive = [~/.ssh, ~/.pi]` (`shared/src/forbidden-subjects.ts:113`).
  `~/.aws`, `~/.config/gh`, `~/.gnupg`, `~/.kube`, `~/.docker`, `~/.netrc` and browser profiles
  are outside roots → `ask` with `sensitive:false`, `grantable:true` (`path-gate/decide.ts:84-91`),
  so the card offers "Always allow ~/.aws…".
- Operator-activated YOLO (`unscoped`, or a root containing them) auto-allows them:
  `server/src/access/yolo-session.ts:325-327` skips only ungrantable subjects and system dirs.
  Needs YOLO unscoped (UI or `PI_DASHBOARD_YOLO`) + `hostGateMode:"enforce"` (default).
  Default behaviour still prompts, hence Low.
- Three lists already drift: `server/src/access/provisioning.ts:208` (`.aws .gnupg .kube
  .docker` + macOS Keychains), `shared/src/pi-trust-mirror.ts:124` (adds `.cache`,
  `Downloads`), the shared grant list above. `isForbiddenGrantSubject`/`isUngrantableSubject`
  feed the grant store backstop (`access/access-grants.ts`, `named-grant.ts:59`), the
  ancestor ladder (`ancestor-ladder.ts:136,143`), planes (`planes.ts:79,111,120`), YOLO roots
  (`yolo-session.ts:188,270,325`), provisioning (`provisioning.ts:282`) and the trust-mirror
  deny rules (`pi-trust-mirror.ts:106`). Further `isUngrantableSubject` callers: cwd verdicts
  (`access/cwd-verdict.ts:63,133`), allow-once admission (`access/containment-gate.ts:373`), agent
  grant acceptance (`access/agent-grant.ts:67`), provisioning classification
  (`access/provisioning.ts:495`). Browse roots build their own predicate from the same lists
  (`lib/browse-roots.ts:86-89`, `isWithinBrowseRoots` `:112-114`, consumers
  `routes/file-routes.ts:621-678`, `browser-handlers/folder-gate.ts:42`) and apply only to non-local
  requests (`server.ts:1468`; spec `server-capability-bounds`, "Shared-root set"). Spec
  `path-anchor-grants` ("A grant names the subject…") says "No entry outside this list SHALL be
  compared against" and is MODIFIED here.

### TOOL-03 today (self-disable through `bash`: no new capability)

- `bash` can write `agentPathGate:{enabled:false}` to `~/.pi/dashboard/config.json`; the gate
  re-reads on a stat-signature change (`extension/src/path-gate/index.ts:64-83`, parse keeps
  `enabled:false`: `shared/src/config.ts:989-999`). `bash` is outside the gate
  (`path-gate/handler.ts:10`, `GATED_TOOLS` `:40`), so while `bash` is allowed the agent
  already reads/writes every file the gate protects: no capability is added. Roads other
  than `bash` are blocked: `write` to `~/.pi/**` prompts; MCP `set_config` is
  `PUT /api/config`, tier `operate` (`shared/src/route-tiers.ts:514`) above the MCP `control`.
  Once tainted, `bash` itself is confirm-gated (`guard.ts:200-220`).
- It only matters where `bash` is restricted (e.g. a future supervised mode,
  `add-supervised-tool-approval`, whose toggle lives in the same `~/.pi/dashboard` config class).

### TOOL-07 today (chat-spawned sessions: residual after the fail-closed fix)

- The register's main claim ("toolPolicy set, guard missing → ungated") is already closed:
  `chat-gateway/src/server/gateway.ts:605-615` refuses the spawn. `guardRef` is passed only
  when both are set (`:634`) → `extensions:[guardRef]` + `extensionConfig` (`:650-656`).
  No `toolPolicy` (the default) = full tool set by design; the bridge path gate + credential
  guard still load. Chat users are allowlisted (default empty, `auth.ts:46-47`).
- Residual: pi treats an unresolvable `-e <ref>` as non-fatal (comment `gateway.ts:602-604`),
  so a typo'd `guardExtension` spawns ungated and nothing verifies the guard loaded.
- Precedent for the missing check: team-plugin's guard announces `team_guard_ready` over the
  plugin-message channel at `session_start` and the plugin server waits and aborts
  (`team-plugin/src/extension/index.ts:7-14`, `team-plugin/src/server/conversations.ts:97`;
  bridge forwards `dashboard:plugin-message`, `extension/src/bridge-handlers/lifecycle.ts:443-448`).
  The chat-gateway guard (`chat-gateway/src/guard/index.ts`, default export) announces nothing;
  the gateway seam (`chat-gateway/src/server/seam.ts:92,186`) exposes `onSessionResolved` only.

## Goals / Non-Goals

**Goals**

- Agent `read` of pi's provider secrets is blocked (credential guard) and of other pi-agent
  state (`models.json`, `mcp.json`, other projects' `sessions/`) needs an explicit human Allow.
- A dashboard spawn is auto-trusted only in a folder dashboard trust covers, whichever road
  spawned it; a project cannot lower the untrusted-content guard.
- Cloud/CLI credential dirs and browser profiles are sensitive everywhere the shared list is
  used: no always-allow, no YOLO auto-allow, no grant.
- A guard-bearing chat session is refused unless its guard proves it loaded.
- TOOL-03 and the unclosable part of TOOL-09 are recorded precisely, not silently dropped.

**Non-Goals**

- Not a sandbox: `bash` stays ungated; credential-guard stays best-effort (indirection and
  encoding undetected, per its spec). TOOL-03 is documentation only (D8).
- No change to spawns into folders dashboard trust covers, nor new spawn-side plumbing
  (no flag, env, protocol, record or server state).
- No auto-install of the untrusted-content guard; no new taint sources; no change to
  taint-clearing or `selfConfirming` attribution (design limits recorded, D5).
- No server-HTTP change (owned by `close-security-map-high-findings`); no change to the
  legacy plain keys in `settings.json` (its residual).
- No refactor of the `provisioning.ts` / `pi-trust-mirror.ts` local lists.

## Decisions

Each decision is **confirmed by operator 2026-10-26**; alternatives and consequences are in
`/tmp/secmap/batch2/DECISIONS-D.md`.

### D1 — TOOL-04 protection class (Decision D1 (confirmed by operator 2026-10-26))

**Choice.** Two classes in a new shared leaf `shared/src/agent-credential-files.ts`:

- `PI_AGENT_SECRET_FILES = ["auth.json","mcp-auth.json","providers.json","system-one/auth.json"]`
  → **hard block** in the credential guard, in both agent dirs (`~/.pi/agent` and
  `PI_CODING_AGENT_DIR` of the pi process), same `<name>.*` sibling rule, same path rule
  (read/edit/write/ls/find/grep, symlink-following) and text rule (`.pi/agent/<name>`
  needles, bare names not matched). No switch (the guard has none, spec "Guard is always
  active"). Block reason keeps the `credential_guard` prefix.
- `models.json`, `mcp.json` (+ `<name>.*`) and `<agentDir>/sessions/**` → **ask on read**
  (D2), never always-allow.
- The protected paths of both dirs are built from `~/.pi/agent` and `PI_CODING_AGENT_DIR`
  only, never from the path gate's `res.agentDir` (the credential guard has no access to it,
  `credential-guard.ts:130-140`). A third directory pi reports (`getAgentDir` expands a
  `~`-prefixed override, `pi-coding-agent/dist/config.js:491-497`) is a recorded residual for the
  credential files; the ask-on-read carve-out (D2) does cover it.

Why not hard-block all six: `mcp.json`/`models.json` are files agents legitimately read
("which MCP servers are configured?") and edit; blocking the path tools blocks `write`/`edit`
on `mcp.json`, which the path gate already prompts for. Ask-on-read matches the existing
write posture.

**Alternatives.** (a) hard-block all six (simpler, mirrors close-security-map D1; breaks
agent diagnostics and `mcp.json` edits). (c) ask for all six (secrets stay one click from
disclosure; `auth.json` is never needed by an agent). Recommend the split (b).

The server-side set from `close-security-map-high-findings` D1 (`AGENT_CREDENTIAL_NAMES`,
seven names) stays server-only; the two sets overlap by design and are documented side by
side. If both changes land, task 1.9 re-points the server set at the shared constant.

### D2 — `sessions/**` and read-only-root carve-out (Decision D2 (confirmed by operator 2026-10-26))

**Choice.** `decidePathAccess` stops admitting a read whose canonical target is under
`<agentDir>/sessions` (except the session's own session dir, which `roots.ts:133` already lists
as a read-write root and `sessionManager.getSessionDir()` returns) or is
`<agentDir>/{models,mcp}.json[.*]`. Implementation shape: it tests the carve-out FIRST, before
`inRoot` (`decide.ts:67-78`): a carve-out target skips every root class (read-only agent dir,
workspace and checkout root, readWrite, grants), so a workspace root at or above the agent dir
(cwd = `$HOME`, a dotfiles checkout) cannot admit it and neither can an existing grant. The
carve-out also forces `sensitive:true` (`decide.ts:88` derives it from `~/.pi` only, and
`PI_CODING_AGENT_DIR` may lie elsewhere) and `grantable:false` (`decide.ts:90` is
`!isUngrantable(subject)`, false only under `~/.pi`; an override dir elsewhere would otherwise
offer "Always allow" for its whole directory), so `buildOptions` (`decide.ts:115-122`) offers only
`Allow once`/`Deny`. The carve-out dirs are the union of `~/.pi/agent`, `PI_CODING_AGENT_DIR` and
`res.agentDir`, built independently of the read-only root (`path-gate/roots.ts:129-133`). The
own session dir is exempt. The directory `<agentDir>/sessions` itself asks too (a listing exposes every project's slug; equality-inclusive, as `isWithinRoot`). Result: `ask`, `Allow once`/`Deny` only. Writes keep today's rule (a
write inside a workspace root that spans the agent dir is already unprompted; residual, listed
in the proposal). Skills, prompts, `settings.json`, `trust.json` keep silent in-root reads (the skill/prompt preview and settings editor depend
on them; legacy keys in `settings.json` are the other change's residual).

**Alternatives.** (a) leave sessions readable (cross-session transcript disclosure stays,
TOOL-04's second half unfixed). (c) hard-block sessions (breaks the session-search
extensions' agent-facing `read` of transcripts, and a human cannot unlock). Recommend (b).

### D3 — TOOL-08 shape: activation auto-trust only under dashboard trust (Decision D3 (operator decision 2026-10-26))

**Choice.** The unconditional activation-cwd `yes` (`project-trust.ts:143-144`) is removed.
The activation cwd is resolved like any other cwd: recorded pi entry first (`piStoreBlocks`),
then `decideFromMirror` (snapshot, then live query), so it is auto-trusted only when
dashboard trust covers it. When nothing covers it the bridge logs the new reason `not-covered`
(added to `MirrorWithheldReason`, logged through `withheld`; today `project-trust.ts:186` returns a
silent undecided); a live query that ran and found no cover keeps `live-not-covered`. The forbidden-folder branch is kept for logging
(`withheld("forbidden-folder")` for a dashboard-spawned headless session in a forbidden or
temporary activation cwd), and `via:"activation"` goes away. Otherwise pi decides:
`trust.json`, then `defaultProjectTrust` (headless: no prompt, `ask` = untrusted; see
Context). The rule is road-independent, so it needs no spawner cooperation and no state.

**Alternatives rejected.** (a) per-spawn flag (`withholdActivationTrust` on
`PluginSpawnOptions`): bypassed through resume, automation and goal spawns into the same cwd.
(b) folder-sticky set of withheld cwds: bypassed through archive, worktree and `/new`
(doubt cycle 3). (c) `--no-approve`: strips the resources of pinned repos. (d) cwd admission
for MCP spawn: blocks the spawn, fails open for a clone inside a pinned folder.

**Consequences.** `piTrustMirror.enabled:false` now also turns off the activation-cwd
auto-trust (the bridge returns undecided; the old "keeps only the activation rule" scenario
is MODIFIED). `piTrustMirror.sources.accessGrants` stays off by default, so a grant alone
covers a folder only when the operator enabled it or chose `true` for that entry; YOLO
covers through the live query. A host with `defaultProjectTrust:"always"` still loads
project resources (pi decides; recorded as residual).

**Residual.** A folder the operator pinned, added to a workspace or granted is trusted for
any spawner, including a clone created inside a pinned folder (subtree-wide trust); by design.

### D4 — Project layer of the untrusted-content guard is tighten-only (Decision D4 (confirmed by operator 2026-10-26))

**Choice.** `loadSettings` resolves `defaults ← global` as today, then applies the project
layer through `applyProjectLayer(base, project)` instead of `Object.assign`: `mode` may rise
along `off < warn < strip < block`, never fall; `untrustedTools` and `sensitiveTools` are
**unioned**; `taintScope` may become `session`; `allowHosts` is ignored. A project `preset:"strict"` is
honoured because it only tightens: it adds `write`/`edit` to `sensitiveTools` and sets
`taintScope` to `session` (`settings.ts:69-75`); that is also a change from today, where a
user-layer `taintScope:"run"` survived a project preset. A project field that
would have lowered or relaxed the effective settings and was ignored (a lowering `mode`, a
non-empty `allowHosts`, `taintScope:"run"` over `session`) logs one line naming the field (no
values) per `loadSettings` call; no-op fields (`strip` over `strip`, `[]`, `run` over `run`) and
invalid values dropped by `sanitize` are silent. The global layer (`<agentDir>/settings.json`)
is unchanged: it is operator-owned, and an agent write to it prompts (`~/.pi/**` is
sensitive for writes).

**Alternatives.** (b) ignore the project layer entirely (simplest; loses legit tightening
by repos). (c) status quo (a hostile trusted repo disables the guard). Recommend (a).

### D5 — TOOL-09 posture (Decision D5 (confirmed by operator 2026-10-26))

**Choice.** Move the manifest entry from `optional` to `strongly-suggested`
(`recommended-extensions.ts:658-673`; surfaces it in the recommended-extensions UI as a
promoted entry) and document that it is **not installed by default**; ship D4. Do not widen
default sources/sinks and do not change taint clearing or `selfConfirming`.

Why not more: (1) install-by-default contradicts the bundled-empty spec and adds new
confirm prompts to every existing session (BREAKING). (2) `write`/`edit` as default sinks
prompt on every `web_search` → edit run (a coding session's normal shape). (3) Clearing taint
only on human input needs `input.source` to tell a human prompt from an injected follow-up;
dashboard prompts arrive as `extension` (`guard.ts:116` comment), so the signal is not
available. (4) `selfConfirming` attribution needs registry identity that does not exist.

**Alternatives.** (a) default-install + `strict` preset: strongest, BREAKING (new prompts,
spec change). (c) docs only. (d) promote to `required` (dismissible banner in every session
until installed; stretches the enum's meaning). Recommend (b).

**Result.** TOOL-09 stays Medium (design limitation) with narrowed residuals recorded:
non-default sources (browser, MCP output, downloads), ungated sinks, any-input taint reset,
unattributed `selfConfirming`. A follow-up change would need pi-side signals.

### D6 — TOOL-07: guard readiness handshake (Decision D6 (confirmed by operator 2026-10-26))

**Choice.** The chat-gateway guard announces `chat_gateway_guard_ready` at `session_start`
over `dashboard:plugin-message`, carrying the spawn's `chatSpawnToken` (passed in
`extensionConfig["chat-gateway-guard"]`, env `PI_EXT_CHAT_GATEWAY_GUARD_*`; the policy
already travels this way). The gateway registers the handler through the plugin context's
`registerPiHandler` (extend `seam.ts` with `onGuardReady`; the handler receives the sending
bridge's `sessionId`, as in `team-plugin/src/server/conversations.ts:209`). Readiness is bound to
the `sessionId` the spawn RESOLVED to (`onSessionResolved`, `seam.ts:92`, via the owned
`chatSpawnToken`), not to the token alone: the token travels in the spawned process's
environment, so any process holding it, or any other session, could otherwise announce ready.
The gateway releases the message only when both facts are present and equal. The bridge
forwards the message with the sender's `sessionId` (`lifecycle.ts:455`). `spawnCorrelated` holds back
`initialPrompt` from `seam.spawn` when a guard is configured and delivers it with
`sendPrompt` once the announcement arrives; on timeout (fixed 30 000 ms constant, injectable in
tests only, as team-plugin `spawnTimeoutMs`; no config key; an announcement at exactly 30 000 ms loses
to the timer) it `shutdownSession`s the session and replies "refused". A resume spawn follows the
same rule, bound to the sessionId `onSessionResolved` delivers for that spawn (not the ended
session's id). While a guarded spawn awaits readiness the channel stays pending, tested BEFORE an
existing binding: a second message gets the existing reply "A session is already starting for this
channel — one moment." (no queue, never delivered), and the channel→session binding is persisted
only on release, so neither a second message nor a message after a gateway restart can reach an
unverified session. A `sendPrompt` rejection after readiness replies "message not delivered", keeps
the binding and lets the next message retry. A restart while waiting leaves the spawned session idle
and unbound (it received no chat message); no cleanup, documented. No `toolPolicy` → no guard → unchanged
(documented full access). Attached sessions unchanged (owner-trusted).

**Alternatives.** (b) pre-spawn static resolution of the ref (cheap, replicates pi's package
resolution rules; `shared/src/pi-package-resolver.ts` covers `packages[]` only, not `-e`
refs). (c) docs only (a typo still yields an ungated session). Recommend (a); it is the
lowest-severity item and may be dropped without affecting the others (tasks 6.x are
self-contained).

**Compat.** An operator-supplied custom guard that never announces is now refused: the
`guardExtension` contract gains one duty, documented (README/`docs/chat-gateway.md`); this is
BREAKING item 4. When the host plugin context has no `registerPiHandler` (older host), the
gateway refuses the spawn when a guard is configured (fail closed); it does not fall back to
today's unverified spawn. No guard configured: unchanged.

### D7 — TOOL-05: one shared sensitive list (Decision D7 (confirmed by operator 2026-10-26))

**Choice.** Extend `forbiddenGrantSubjects().sensitive` (`forbidden-subjects.ts:113`) with
`~/.aws`, `~/.config/gh`, `~/.gnupg`, `~/.kube`, `~/.docker`, `~/.netrc` and the browser
user-data roots of the running platform (starting set, confirmed against
`shared/src/chrome-profiles.ts:20-30` in task 4.1: macOS `~/Library/Application Support/
{Google/Chrome,Chromium,Microsoft Edge,BraveSoftware,Firefox}`, Linux `~/.config/
{google-chrome,chromium,microsoft-edge,BraveSoftware}` and `~/.mozilla`, Windows
`%LOCALAPPDATA%\{Google\Chrome\User Data,Microsoft\Edge\User Data,BraveSoftware}` and
`%APPDATA%\Mozilla`; this table is NORMATIVE, one test row per browser and platform, Brave entries
are the vendor root, which contains `Brave-Browser\User Data`; snap/flatpak locations are a
residual). Because every consumer funnels through `isUngrantableSubject`, the
single edit makes these: marked sensitive at the agent gate (Allow once/Deny only), refused
as grant subjects, dropped as ladder rungs, refused as YOLO roots, and excluded from YOLO
auto-allow (`yolo-session.ts:325`, no YOLO change needed: spec scenario pins it).

Side effects (accepted, listed): a directory that **contains** one of these becomes
ungrantable (`~/.config`, macOS `~/Library/Application Support`, Windows `%LOCALAPPDATA%`),
so they stop appearing as ladder rungs and cannot be a YOLO/cwd-plane root. The true
browse-roots rule (`lib/browse-roots.ts:86-89`) drops a NON-home source root (pinned, session
cwd, workspace folder, worktree root, project grant) that equals or contains a listed subject,
or lies at/under a sensitive one; `$HOME` is added unconditionally (`:71`), which is why
`$HOME` surviving does not conflict with it containing `~/.ssh` today. Newly dropped non-home
roots: `~/.config`, `~/Library`, `~/Library/Application Support`, `%LOCALAPPDATA%`, `%APPDATA%`
and anything at/under a listed directory when pinned; this matters only for roots outside
`$HOME`, since `$HOME` still covers the rest. Newly refused for non-local requests
(`isWithinBrowseRoots` `:112-114`, sensitive subtrees stay refused even under `$HOME`):
`~/.aws`, `~/.config/gh`, `~/.gnupg`, `~/.kube`, `~/.docker`, `~/.netrc` and the browser
profile dirs; persisted grants
that now match, including one for a directory that contains a credential dir (`~/.config`), are
**not admitted and not deleted** (task 4.4: filtered at load, and the write paths preserve the raw
rows; today the load filter plus the full rewrite would drop them, see Rollback), logged once per
subject. Whole-file states: an invalid-JSON or `version !== 1` store is moved aside to
`<file>.corrupt-<UTC ts>` by a record, a revoke writes nothing; a file over 1 MiB
(`GRANT_STORE_MAX_BYTES`, bounds the preserved rows) is neither loaded nor rewritten and the write
fails with one log line;
`pi-trust-mirror` deny rules, which build on this function (`pi-trust-mirror.ts:106`),
widen accordingly (superset of the shipped requirement; no contradiction).

**Alternatives.** (b) a second, agent-gate-only list (no effect on server grant surfaces;
a second list to drift, and YOLO needs a surface special case like `inSystemDir`).
(c) leave unchanged (YOLO unscoped keeps auto-allowing `~/.aws`). Recommend (a); the three
existing lists already drift and this does not add a fourth.

### D8 — TOOL-03: document, do not pin (Decision D8 (confirmed by operator 2026-10-26))

**Choice.** No code. Record in the register and `tool-call-guards.md`: self-disable via
`bash` adds nothing while `bash` is ungated; the hand-off for a restricted-`bash` mode is
"pin `agentPathGate`/supervised state at session start, or refuse a disable made by a file
write during the session" (to be owned by `add-supervised-tool-approval`, which keeps its
toggle in the same config class).

**Alternatives.** (b) pin gate state at session start now: breaks the intentional live
toggle (`index.ts:64-83` re-reads on signature change; the Settings switch relies on it) for
a gain of zero. (c) block `bash` writes to `~/.pi/dashboard/config.json` in the credential
guard text rules: a pattern list on an ungated tool, bypassable, adds noise. Recommend (a).

## Risks / Trade-offs

- **ACP road is outside the D3 rule** (verified at apply time from code): `spawnAcpSession`
  (`server/src/spawn-process/acp-spawn.ts`) starts either the in-process host A
  (`acp-bridge/local-host.ts`, no child but the agent) or, for a durable agent, the adapter
  `bin/acp-bridge.mjs` over the external agent command, whose env drops `PI_*`, `NODE_OPTIONS`
  (`acp-bridge/child-env.ts`). Neither runs pi nor the bridge extension, so no `project_trust`
  fires and "does not load `x.ts`" has no observable; the spec list drops ACP, no test row. Residual:
  an ACP agent applies its own project-config trust, outside dashboard control.
- **Orphaned guarded chat session after a gateway/server restart** (D6): the spawned session stays
  idle and unbound, having received no chat message; not cleaned up (state is in memory), documented.
- **Residuals recorded** (D7): `~/.netrc.*` siblings and Windows `_netrc` are not sensitive; snap/flatpak
  browser profile locations are not listed.
- **Dashboard spawns into unpinned, non-workspace, ungranted folders lose project `.pi/`
  resources** (D3), whoever spawns. Mitigation: pin the folder, add it to a workspace, record
  trust in `trust.json` (`/trust` in a terminal pi); the spawn still succeeds and the
  withheld trust is logged with the existing reason codes.
- **Agents that read `mcp.json`/`models.json`/other sessions now prompt** (D1/D2); headless
  sessions with no UI block (existing gate behaviour). Own-project session files stay silent.
- **Credential-guard false positives** (D1): `bash` text rule blocks `.pi/agent/auth.json`
  mentions in commands (e.g. `cat`, `rg ... ~/.pi/agent/auth.json`). Bare `auth.json` in a
  repo search is not matched (spec scenario).
- **Newly ungrantable ancestors** (D7): `~/.config` etc. cannot be granted or YOLO roots;
  persisted grants are filtered, not destroyed (rollback restores them); a whole-file corrupt or
  future-version store is moved aside, never overwritten.
- **Guard readiness (D6)** refuses a spawn on a host without `registerPiHandler` (fail closed)
  and adds a start-up wait (≤ a few hundred ms in practice, 30 s cap);
  the first chat turn is delayed until the guard is up. A custom guard that never announces
  is refused.
- **`selfConfirming` / taint reset / source narrowness stay open** (D5): a registered
  extension or an input-event follow-up can still bypass the guard. Recorded, not solved.
- **Credential guard remains best-effort** (spec): shell indirection reads the files.

## Migration / Rollback / Compatibility

- No data migration, no schema change, no new route, no config key. Server restart not needed
  for extension-only items; the extension items need `npm run reload`; server + shared +
  chat-gateway items need the server restart
  (`restart-server.ts`); the untrusted-content-guard is a separate npm package (release).
- **BREAKING (user-visible, four):** (1) agent `read` of `auth.json`/`mcp-auth.json`/
  `providers.json`/`system-one/auth.json` is blocked (no operator override) and of
  `models.json`/`mcp.json`/other sessions' transcripts prompts; (2) a dashboard spawn into
  a folder dashboard trust does not cover no longer auto-trusts it; (3) credential
  dirs/browser profiles can no longer be granted/YOLO-admitted, and a project can no longer
  lower the untrusted-content guard (a project-level `mode:"off"` or `allowHosts` is ignored);
  (4) a custom chat `guardExtension` must announce readiness or its spawns are refused, and a
  host without plugin-message handlers refuses guarded chat spawns. Also: non-local file browse
  of `~/.aws`, `~/.config/gh`, `~/.gnupg`, `~/.kube`, `~/.docker`, `~/.netrc` and browser profile
  dirs is refused, and `~/.config`-like roots outside `$HOME` stop being shared roots.
- **Rollback:** each item is independent and revertable by commit. Persisted grants are never
  deleted by D7: the load filter (`access-grants.ts:213`) hides them, and the write paths
  (`recordGrant` `:373-428`, `revokeGrant` `:438-466`) rewrite the file from the filtered cache
  today, which would drop them (the rollback claim was false at HEAD). Task 4.4 keeps the raw
  filtered-out entries and writes them back verbatim, so reverting the build restores them.
  The D3 change is one branch in `project-trust.ts` (revert restores the unconditional yes);
  no stored state depends on it or on the credential-guard set.
- **Compatibility:** D3 touches only the bridge extension. The shared constants
  are additive exports. `close-security-map-high-findings` (server HTTP side, same files by
  name) and this change are independent; whichever lands second de-duplicates the name
  sets (task 1.9). `add-supervised-tool-approval` gates `bash`/MCP and is `related`
  (TOOL-03 hand-off).
