## Context

See proposal.md — Why. Current state that shapes the approach (pi paths relative to the installed `@earendil-works/pi-coding-agent`):

- pi's order (`dist/core/project-trust.js` `resolveProjectTrusted`, `dist/main.js:581-627`): CLI `trustOverride` → a cwd without trust-requiring resources is trusted → extension `project_trust` handlers, serially, **first** yes/no wins (`dist/core/extensions/runner.js:107-131`) → nearest saved decision (`dist/core/trust-manager.js:21-34`) → `defaultProjectTrust`. Only personal and command-line extensions take part (`docs/extensions.md:50`); the bridge is personal (`~/.pi/agent/settings.json` `extensions`). The event carries `cwd` (`dist/core/extensions/types.d.ts:535-550`). Today's bridge "yes" already overrides a saved "no" for its activation cwd (`packages/extension/src/project-trust.ts:40-45`, `bridge-handlers/lifecycle.ts:186-205`).
- Store: key `normalizeCwd = canonicalizePath(resolvePath(cwd))`, no options (`trust-manager.js:18-20`; Unicode-space normalisation is opt-in, `dist/utils/paths.js:59-62`). In-place `writeFileSync` under a separate `trust.json.lock` (`trust-manager.js:104`); reader throws on parse failure and on values other than true/false/null (`:83-91`); absent → `{}` (`:72-74`).
- `pi mcp list` accepts only `--json` (`dist/extensions/mcp/cli.js:84-103`) and reads trust only from the store (`:135`).
- Bridge: handlers wrapped by `safe()` (`packages/extension/src/bridge.ts:1006-1020`); config loaded at `bridge.ts:1024-1025`; spawn token single-use, scrubbed at first register after `project_trust` (`session-sync.ts:66-73,143-149`); `dashboardSpawned` captured once (`session-sync.ts:156`).
- Server: `host.isProjectTrusted` `(cwd) => boolean` (`packages/mcp-client-plugin/src/core/service.ts:25-26`), implemented in `packages/server/src/pi/host-project-trust.ts:28-60` with a fixed `AGENT_DIR` and a silent `() => false` boot fallback; `PI_CODING_AGENT_DIR` is honoured elsewhere (`packages/shared/src/dashboard-paths.ts:54-57`). One server per HOME (home lock, `packages/server/src/lifecycle/home-lock.ts`).
- Sources: `packages/server/src/git-worktree/worktree-init-trust.ts` (`Record<string,true>` keyed `path.resolve(configRoot)\0hookDefHash`, `:33-35`; write errors only warned, `:61-69`); hook read/normalise/hash in `git-worktree/worktree-init.ts:68-93,424-435`; `packages/server/src/persistence/preferences-store.ts` (pins, folder-`workspaces`, Docker seeding `:507-520`); YOLO `access/yolo-session.ts:169,212-222` (unscoped has no roots; env-scoped roots have `expiresAt: null`); `access/access-grants.ts:55` (`scope`). Deny rules: `packages/shared/src/forbidden-subjects.ts:41-140` (platform-aware; `whole` exact, `sensitive` subtree).

## Goals / Non-Goals

**Goals:**
- One pure folder decision shared by bridge and server. Disclosed exceptions: per-session CLI overrides, sessions outside `coverInteractive`, the bridge's exact-cwd per-run rule, and pi's CLI (`pi mcp list`) which reads only `trust.json`.
- Nothing in this change writes `trust.json`; revoking a source takes effect at the next pi start.
- No server round trip on pi's startup path; every doubt → undecided.

**Non-Goals:**
- Server-lifetime trust ("until dashboard restarts" worktree trust, session access grants, every YOLO session) and bridges on other machines (follow-up change).
- Bulk-exporting into `trust.json`; changing pi's prompt, `/trust`, its startup failure on an unreadable store, or `defaultProjectTrust` inside pi.
- Coverage that stops at nested project roots (a covered subtree trusts folders created or cloned into it later — documented).
- Defending against same-user forging of the snapshot (equivalent to writing `trust.json`).

## Decisions

### D1 — Decide at `project_trust` from a snapshot; never write `trust.json`
Alternatives rejected: bulk-copy into `trust.json` (entries outlive sources, enrols every pi process); live WS query (startup budget, connection timing, rate limits — deferred with server-lifetime trust); auto-record in the toggle gate (leaks into terminal pi and survives revocation — replaced by a pre-selected prompt, D7).

### D2 — Shared pure core in `packages/shared`
- `piTrustKey(path, { home })`: reimplements `canonicalizePath(resolvePath(path))` with no options; rejects relative input; golden cases against the installed pi's `ProjectTrustStore` (tilde, symlink, missing leaf, NBSP-not-normalised, macOS `/tmp` → `/private/tmp`). Worktree-store keys (`path.resolve`) are translated through it on read.
- `decidePiTrust({ hasTrustRequiringResources, recordedEntry, mirrorEntry, piDefault })` → `{ trusted, source }` (CLI override is pi's, outside the core). `hasTrustRequiringResources` comes from pi's own `hasTrustRequiringProjectResources` via `getPiCore()` on the server (it also walks ancestor `.agents/skills`); the bridge never needs it because pi decides implicit trust before the event.
- `filterMirrorEntries(entries, settings, facts)` → counted + ignored-with-reason. `mirrorDenyRules` is a separate list (it reuses `forbidden-subjects` values read-only and never changes them, because `sensitive`/`whole` also drive the path gate and grant ladders — `extension/src/path-gate/index.ts:108`, `ancestor-ladder.ts:28`): `whole` + ancestors of `$HOME` + platform broad parents (exact); `sensitive` + `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.docker`, temp dirs, `~/.cache`, `~/Downloads` (subtree).
- Pure hook `normalizeHook` / `canonicalize` / `hookDefHash` move to shared; the file read (`readInitHook`) stays in each runtime (server, bridge) — shared stays I/O-free for the browser bundle.

### D3 — Durable source registry on the server

| Source | Default | Counted entries | Rationale |
|---|---|---|---|
| `worktreeInit` | on | persisted, current hook hash | explicit consent to run repo code |
| `workflow` | on | slot for `add-project-workflows` | same consent class |
| `pinned` | on | pins incl. Docker-seeded | operator chose the folder as a working project |
| `folderWorkspaces` | on | folders in folder-workspaces | same act as pinning |
| `accessGrants` | off | persisted, project-root subjects | read/write consent is not code-execution consent |

Excluded (follow-up): session-scoped worktree trust, session access grants, every YOLO session — `yolo-session.ts` keeps YOLO in memory only (`:11`, `:101-130`), so it is server-lifetime even with an expiry. KB source trust (`access-routes.ts:78-92`) names content sources, not folders. `workflow` reports "source not installed" until `add-project-workflows` lands. Worktree hook trust is widened into full project trust for the subtree (see Risks). The bridge's exact-cwd rule is disclosed on the Access page, not a source.

### D4 — Snapshot and same-folder identity
Snapshot `{ generation, entries: [{key, sourceKind, dev, ino, birthtimeMs?, configRoot?, hookHash?}] }`, tmp+rename, mode 0600 at creation, written only by the home-lock holder, rebuilt from the persisted stores at boot and rewritten on every source/choice/`sources` change. Revocation: rewrite the snapshot without the entry, then write the source store synchronously (pins flush past the 1 s debounce, `preferences-store.ts:664-673`; `worktree-init-trust` revoke surfaces write errors instead of warning, `:61-69`); success only when both complete. A crash in between is healed at boot, when the snapshot is rebuilt from the stores — the UI then shows the entry still present, consistent with what the bridge sees. Grant: source store + choice first (either failing fails the grant), then snapshot. Identity check in the bridge at decision time: canonical path of the cwd or an ancestor equals `key`, `dev` and `ino` equal the entry's, and `birthtimeMs` equals the entry's when the entry recorded one (recorded only when the filesystem reported a birth time distinct from ctime at write time). Access-grant entries also re-check the `.git`/`.pi` marker. Same machine, same container, or a genuinely shared folder pass; other machines and re-created folders fail closed.

### D5 — Bridge decision (no server contact)
Activation (first in the process, `prev` guard): capture `dashboardSpawned`, keep a non-empty token on `BridgeState` (survives `/reload`), then delete it from `process.env` — replacing the register-time scrub in `session-sync.ts:143-149`. Both register paths (`sendStateSync`, `session_start` register at `bridge-handlers/lifecycle.ts:552`) call one consume-once operation on the kept token (MODIFIED `spawn-correlation`). At `project_trust`: read `piTrustMirror` from `config.json`; read `trust.json` of the running pi's agent dir without the lock using pi's rules (BOM stripped, `null` = absent, other non-boolean → failure → undecided; absent file → none recorded) — best-effort at read time, pi re-reads under its lock later; nearest recorded entry → undecided; implicit/no-resources handled by pi before the event; activation-cwd rule (dashboard-spawned, headless, canonical `eventCwd` = canonical `activationCwd`, not denied) → yes; else, if allowed by `coverInteractive`, snapshot entry passing filters + identity + hook recompute (bridge reads the entry's `configRoot` hook) → yes; else undecided. Kept inside `safe()`; the handler body has its own try/catch returning undecided. No module-level caches (`bridge-decomposition` rule); every read is per event. Denials of previously-auto-trusted cases are logged with the reason.

### D6 — Server consumers
`host.isProjectTrusted` → `decidePiTrust` with pi's agent dir resolved via `PI_CODING_AGENT_DIR`; optional `host.projectTrustSource` (absent → view omits the source). Boot failure to resolve pi logs once. MCP view: dashboard-only trust → project servers active, live state "not checked by pi". The mcp-client config-writer's global-write collision set (`config-writer.ts:197,250`) keeps a pi-only predicate, so dashboard trust does not change which global writes collide (no spec change to that requirement).

### D7 — Toggle gate pre-selection
`resolveToggleTrust`: exact recorded decision → as today (`false` refuses); inherited refusal → today's prompt; durable dashboard trust with nothing recorded → prompt (even when the default is `never`) with `preselected: "trust"`, the source named, and the lasting effect stated; record only via the operator's choice through `persistTrustDecision`.

### D8 — Config and per-entry choice
`piTrustMirror` in `~/.pi/dashboard/config.json` (shared-config schema). Choices in `~/.pi/dashboard/pi-trust-overrides.json` keyed `<sourceId>\0<piTrustKey>`, written in the same server handler as the entry (failure fails the grant) before the snapshot rewrite; an unreadable choices file makes entries not count; orphan choices are ignored; source stores keep their formats. Consent surfaces: worktree-init "Always trust", workflow trust, pin, Add Folder (folder-workspaces), access-grant "always"; pre-existing entries follow the default and are marked "by default".

## Risks / Trade-offs

- [Default ON widens auto-load on upgrade and overrides `defaultProjectTrust: never`] → operator decision; release note; Access page states precedence and lists effective entries; access grants default off; `enabled:false` rollback works with the server down.
- [Subtree covers repos created or cloned later inside a covered folder] → documented; broad parents and `$HOME` ancestors exact-denied; recorded pi `false` wins; per-entry choice.
- [Hook trust is widened into full project trust (all extensions/MCP, including later additions)] → the checkbox text names this explicitly; the hook hash pins only the hook, like pi's folder trust pins nothing; documented.
- [Bridge "yes" pre-empts later user extensions; earlier ones bypass the mirror] → documented.
- [Three bridge behaviour changes] → listed as BREAKING in the proposal and bridge delta; (a)–(b) are not behind `piTrustMirror.enabled` (rollback of those needs a downgrade).
- [`--no-extensions` sessions never consult the mirror] → disclosed on the Access page and folder page.
- [Birth time unavailable or equal to ctime (some Linux filesystems)] → path + device + inode only; residual inode-reuse window documented.
- [Docker Desktop file sharing] → server and sessions inside one container see one view; host-side sessions against a container dashboard are other machines (fail closed).
- [Lockless read of an in-place-written `trust.json`] → torn or invalid content fails validation → undecided (pi's own later read may still fail startup — unchanged); a grant/revoke racing a startup is decided by whichever state the bridge read.

## Migration Plan

1. Ship shared + server + bridge together. An old bridge ignores the snapshot (today's behaviour); a new bridge without a snapshot behaves as today minus the three documented bridge changes.
2. First boot writes the snapshot; choices start empty (source defaults apply).
3. Rollback: `piTrustMirror.enabled=false`, or downgrade and delete `pi-trust-mirror.json` / `pi-trust-overrides.json`. `trust.json` is never touched by this change.
