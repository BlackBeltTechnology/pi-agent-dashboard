## Context

pi ships no MCP support (`@earendil-works/pi-coding-agent/README.md:492`). [iMCP](https://github.com/mattt/iMCP) exposes Apple PIM (Calendar, Contacts, Reminders, Messages, Location, Maps, Weather) over stdio MCP, brokered by a macOS menu-bar app that owns the TCC permission grants. `pi-mcp-adapter` (npm, v2.19.0) is the client that lets a pi session speak to it.

Three moving parts must line up before a single tool call works:

```
 ┌── provisioning (this change) ────────────────────────────────┐
 │                                                              │
 │  1. iMCP.app installed      brew --cask mattt/tap/iMCP       │
 │  2. pi-mcp-adapter loaded   settings.json packages[]         │
 │  3. mcp.json entry present  ~/.pi/agent/mcp.json             │
 │  4. TCC grants              MANUAL — menu-bar clicks         │
 └──────────────────────────────────────────────────────────────┘
              │
              ▼
 pi session ─stdio─▶ imcp-server ─Bonjour(_mcp._tcp)─▶ iMCP.app ─▶ EventKit/Contacts/…
```

Step 4 is unautomatable by design (Apple's security model). Steps 1–3 are automatable and are what this change owns.

**Existing machinery this rides on.** The repo already has: a dashboard-plugin loader with declarative `PluginRequirements` probing (`packages/dashboard-plugin-runtime/src/server/requirement-probes.ts`), a `RECOMMENDED_EXTENSIONS` manifest with a `dashboardPlugin` companion field (`packages/shared/src/recommended-extensions.ts:76`), a `settings-section` slot with a page-id registry, and a one-click `[Install]` path for unsatisfied `piExtensions` requirements (`specs/dashboard-plugin-loader/spec.md:1229`). Nothing here needs new infrastructure — except one gap (see Decision 1).

**Constraint that shapes everything:** `imcp-server` lives at `/Applications/iMCP.app/Contents/MacOS/imcp-server`. It is not on `PATH`, so the existing `binaries` probe cannot see it, and `services` is a closed registry plugins may not extend.

## Goals / Non-Goals

**Goals:**

- Reduce a ~20-minute error-prone setup ritual to one command plus a documented manual click-through.
- Make the provisioning state legible from the dashboard (status readout + `[Run installer]`) and from the CLI (`--check`) and from the existing `doctor` skill.
- Make iMCP.app presence expressible *declaratively*, reusably, for any future `.app`-bundled or non-PATH dependency.
- Fail clean and loud on non-macOS and on macOS < 15.3 — never half-provision.
- Give the agent a skill that knows what iMCP can and cannot do, so it stops trying to reach Mail through it.

**Non-Goals:**

- **Apple Mail.** iMCP has no Mail service; "Messages" is iMessage/SMS. Mail stays with the existing `apple-mail-fast-export` skill. Not a deferral — a permanent boundary of this integration.
- **Toggling iMCP services from the dashboard.** TCC grants are menu-bar-only with no API. The settings panel must not imply otherwise.
- **A general MCP-server management UI.** This provisions exactly one server. `pi-mcp-adapter`'s own `/mcp` commands own the general case.
- **Bundling `pi-mcp-adapter`** into our tarball (see Decision 3).
- **Windows/Linux support.** Structurally impossible; the installer no-ops with a clear message.

## Decisions

### 1. Extend `PluginRequirements` with a `paths` category

**Decision.** Add a fourth category to the declarative requirement schema:

```ts
export interface PluginRequirements {
  piExtensions?: string[];
  binaries?: string[];
  services?: string[];
  /** Absolute filesystem paths that must exist (e.g. .app-bundled binaries). */
  paths?: string[];
}
```

with a matching `paths: { name: string; satisfied: boolean }[]` on `PluginRequirementReport`, a `probePath()` in `requirement-probes.ts`, and inclusion in `missingFromReport()`.

**Config interpolation (resolves a surface divergence).** A bare literal path cannot express what the installer actually resolves — an ordered candidate list plus an operator override. Without this, a host with iMCP in `~/Applications`, or with an override configured, shows an unsatisfied requirement pill while the panel simultaneously reports the host provisioned: two surfaces disagreeing about one machine. A `paths` entry therefore MAY contain a single `${<configKey>}` placeholder resolved from the plugin's own **validated** config before probing:

```ts
requires: { paths: ["${imcpServerPath}"] }
```

Resolution rules: the key must exist in the plugin's `configSchema`; the resolved value must be an absolute path; an unresolved or non-absolute value makes the requirement unsatisfied rather than throwing. This is a config read, never a shell expansion.

**Interpolation alone is insufficient — the discovered path must be reconciled back.** The config default is the canonical `/Applications` location, but discovery resolves an *ordered candidate list*. On an unconfigured host where iMCP lives only in `~/Applications`, the checker reports provisioned while the requirement resolves the default and reports unsatisfied — the identical divergence, merely narrowed to the unconfigured case.

Reconciliation therefore happens **in the plugin's server component, not the CLI installer**. The plugin config store is server-owned — `updatePluginConfig` is a dep-injected server callback (`packages/dashboard-plugin-runtime/src/server/server-context.ts:269`) that a standalone CLI process cannot reach. Putting the write-back in the installer would mean a third write target with no location, no schema, and no terminal state; would be unreachable on a CLI-only host; and would let a server restart clobber a CLI-written store from stale in-memory state.

Siting it server-side dissolves all three problems, and the scoping is exactly right: the divergence is a *dashboard* symptom (a pill contradicting a panel), so it only needs fixing where a dashboard exists. A CLI-only host has no pill to disagree with.

Two guards: reconciliation writes only when the configured value is unset or still at the schema default — never overwriting an explicit operator override, whose file may be legitimately absent at check time.

**Why.** The three existing categories each answer a different "where does this live" question — PATH, npm, network service. A `.app`-bundled binary is a fourth, and iMCP is not the only instance (any macOS app shipping a CLI, any Windows `Program Files` binary). Encoding it once in shared means the existing missing-requirement pill UI, the 30s TTL cache, and the `missingRequirements` flattening all work unchanged.

**Alternatives considered.**

| Option | Rejected because |
|---|---|
| Plugin-local probe in our `server/` entry | Works, but the result can't flow through `PluginStatus.requirements`, so we'd hand-roll a parallel status channel and a parallel UI. Dead weight nobody else can reuse. |
| Petition the closed `services` registry for an `imcp` name | Semantically wrong — a service probe means "is something answering", not "does a file exist". Also requires the same core edit while being *less* general. |
| Symlink `imcp-server` onto PATH during install | Mutates the user's PATH-visible surface for our convenience; breaks on app upgrade/uninstall; a lie to every other PATH consumer. |
| Declare a literal `/Applications/…` path and accept the divergence | The requirement pill and the panel would contradict each other on any non-default install — precisely the confusion a declarative requirement exists to remove. |

**Trade-off accepted.** This promotes the change from a leaf package to one touching shared core, widening the blast radius and requiring the `dashboard-plugin-loader` capability spec to change. Judged worth it for a genuinely reusable primitive.

**Security note.** `probePath` does `fs.existsSync`-class checks only. It MUST NOT execute the path, MUST NOT follow into the file, and MUST treat the declared path as untrusted manifest input (no shell interpolation anywhere downstream).

### 2. Installer is a pure state machine with `--check` as the write-suppressed twin

**Decision.** One traversal, two modes. `--check` runs the identical graph with every mutation suppressed and reports the terminal state. The same function backs the CLI `bin`, the `doctor` skill probe, and the settings panel's status readout — one implementation, three surfaces.

```
              pi-apple-tools-install [--check]
                       │
              ┌────────▼────────┐
              │ process.platform│
              └───┬─────────┬───┘
             darwin         other ──▶ exit 0  UNSUPPORTED_PLATFORM
                 │
        ┌────────▼────────┐
        │ sw_vers ≥ 15.3? │──no──▶ exit 1  OS_TOO_OLD
        └────────┬────────┘
        ┌────────▼──────────────────┐   override → ~/Applications
        │ discover imcp-server      │   → /Applications  (ordered)
        └───┬───────────────────┬───┘
         found            not found
            │          ┌────────▼────────┐
            │          │ brew present?   │
            │          └──┬───────────┬──┘
            │           yes           no ──▶ exit 1  NO_INSTALL_METHOD
            │             │                          (+ download link)
            │   brew install --cask mattt/tap/iMCP
            │             │
            │    ┌────────▼───────┐
            │    │ brew exit 0?   │──no──▶ exit 1  INSTALL_FAILED
            │    └────────┬───────┘        (verbatim brew stderr,
            │             │                 no retry, no config write)
            │    ┌────────▼───────────┐
            │    │ RE-DISCOVER binary │──absent──▶ exit 1  INSTALL_FAILED
            │    └────────┬───────────┘   (app present, binary moved/missing)
            └─────────────┤
        ┌─────────────────▼──────────────┐  merge-only; command =
        │ ensure mcp.json iMCP entry     │  the *re-discovered* path
        └─────────────────┬──────────────┘  unparseable ─▶ CONFIG_UNPARSEABLE
        ┌─────────────────▼──────────────┐
        │ ensure settings.json packages[]│  headless fallback only
        └─────────────────┬──────────────┘  unparseable ─▶ CONFIG_UNPARSEABLE
        ┌─────────────────▼──────────────┐
        │ exit 0  READY_PENDING_GRANTS   │  print manual TCC step
        └────────────────────────────────┘
```

Terminal states are a closed enum of **nine**: `UNSUPPORTED_PLATFORM`, `OS_VERSION_UNKNOWN`, `OS_TOO_OLD`, `NO_INSTALL_METHOD`, `INSTALL_FAILED`, `CONFIG_UNPARSEABLE`, `CONFIG_WRITE_FAILED`, `READY_PENDING_GRANTS`, `READY`. All three surfaces render the same vocabulary.

Two members exist because an earlier seven-member draft could not express real failures: `OS_VERSION_UNKNOWN` (absent or non-zero `sw_vers` — the OS is not *too old*, its version is *unknown*, and the remediation differs; the `OS_TOO_OLD` message also cannot name a detected version that was never read) and `CONFIG_WRITE_FAILED` (a parseable config that cannot be written — `EACCES`, `ENOSPC`, an uncreatable parent directory — which is neither `CONFIG_UNPARSEABLE` nor `INSTALL_FAILED`). Collapsing either into a neighbour makes the doctor lie about the remediation. `READY` vs `READY_PENDING_GRANTS` cannot be distinguished without a successful tool call — the installer never claims `READY`; only a live adapter round-trip can.

**Post-brew re-discovery is a gate, not a formality.** After a successful cask install the traversal re-runs discovery and writes `mcpServers.iMCP.command` from the *re-discovered* path. An app that installed to a non-default prefix, or whose bundled binary moved between iMCP releases, terminates `INSTALL_FAILED` rather than writing a config entry pointing at a nonexistent binary — the silent-broken-entry failure the Risks section claims to prevent.

**Why a state machine rather than imperative steps.** Every state is independently reachable on a re-run (user deleted the app, user upgraded macOS, user hand-edited `mcp.json`). Modelling it as a traversal makes idempotency structural rather than a property we have to remember to preserve in each step.

### 3. `pi-mcp-adapter` declared twice, bundled never

**Decision.** Declare it in `dependencies` (legible, npm-resolvable) **and** in `requires.piExtensions` (probed, one-click install). Do **not** add it to `bundledDependencies`, and do **not** reference its `index.ts` from our `pi.extensions`.

**Why not bundle**, despite `docs/packages.md:173` sanctioning exactly that for pi-package deps:

| | Bundle | Chosen |
|---|---|---|
| native module | ✗ vendors `@napi-rs/keyring` prebuilds into a tarball published from CI runners for all OSes | ✓ npm resolves per-machine |
| duplicate instance | ✗ pi loads packages with separate module roots — a bundled copy alongside a user's own `npm:pi-mcp-adapter` registers the `mcp` tool **twice** | ✓ deduped by npm package name (`docs/packages.md` §Scope and Deduplication) |
| adapter updates | pinned to our release cadence | tracks upstream |

**Known cost, accepted.** The `dependencies` entry pulls a copy (with its native binding) into `packages/apple-tools/node_modules/` that pi will never load. ~2 MB and a native build for a declaration. Kept because it makes the requirement legible in the manifest and survives `requires` being refactored. Reverting is a one-line manifest edit if the cost bites.

**Which path actually loads the adapter — corrected.** An earlier draft called the dashboard the primary route and the installer's `settings.json` write a "headless fallback". That is backwards. `installedMatchesName()` (`requirement-probes.ts:80`) matches against `listInstalled("global")` — the pi settings `packages[]` plus global installs — **not** nested npm dependencies. So the npm copy in `packages/apple-tools/node_modules/`:

- does **not** satisfy `requires.piExtensions: ["pi-mcp-adapter"]` (the pill stays unsatisfied), and
- is **never loaded** by pi (not in `pi.extensions`, not in `packages[]`).

The installer's `settings.json` `packages[]` write is therefore the **only functional path** that makes the adapter live. The dashboard surface is a *diagnostic*: the pill reports the gap and links to the Packages tab (`[Install via Packages tab]`, not an inline `[Install]` — `PluginsSection.tsx:166` gates the button on a `RECOMMENDED_EXTENSIONS.id` match, and `pi-mcp-adapter` has no curated entry).

This makes the `dependencies` declaration purely documentary — legible in the manifest, functionally inert. That cost was accepted knowingly; it is recorded here so no reader mistakes it for the mechanism.

### 4. Config writes are merge-only, never rewrite

**Decision.** The `mcp.json` writer reads, deep-merges exactly the `mcpServers.iMCP` key, and writes back — preserving every sibling server, unknown key, and the user's formatting where practical. Same discipline for the `settings.json` `packages[]` append (append-if-absent, never reorder, never remove).

**Why.** `~/.pi/agent/mcp.json` and `~/.pi/agent/settings.json` are user-owned files this repo does not exclusively control — the local `settings.json` already carries 23 packages. A clobbering write is unrecoverable data loss of hand-tuned config.

**Hardening requirements** (drive the `security-hardening` pass):

- Write via temp-file + atomic rename; never leave a truncated config on crash.
- Refuse to write if the existing file is present but unparseable — surface the parse error, do not "fix" it by overwriting.
- Never copy credentials between config layers (the adapter's precedence chain includes files with secrets).
- No probed value (app path, brew output, `sw_vers` output) is ever interpolated into a shell string. `brew` is invoked with an argv array, never through a shell.

### 5. Settings panel is a provisioning surface, not a service switchboard

**Decision.** `configSchema` (JSON Schema 7) + a `settings-section` claim rendered **inline under the plugin's own row in the Plugins tab**, reached through that row's settings-gear affordance. Contents:

| Control | Backed by |
|---|---|
| Provisioning status readout (terminal state from Decision 2) | plugin `server/` calling the shared checker |
| `[Run installer]` action | same, write mode |
| iMCP server enable/disable | adapter's `disabled` field, written to the **project-local `.pi/mcp.json`** — the adapter's highest-precedence layer and its documented write target for that flag. Deliberately a different file from `~/.pi/agent/mcp.json`, where the installer writes `command`: the flag *overrides* the lower layer rather than editing it, so disabling never mutates the installer's entry. |
| `directTools` selection | adapter setting — promotes hot iMCP tools to direct pi tools |
| `imcp-server` path override | our `configSchema`; also the value interpolated into the `paths` requirement (Decision 1) |

**Explicitly absent:** per-service toggles (Calendar on, Messages off). TCC-only, no API. The panel links out to the menu bar instead of faking a control it cannot honour.

**Why under the plugin row** rather than a dedicated settings page: `openspec/specs/dashboard-plugin-loader/spec.md:1043` requires plugin `settings-section` claims to render only beneath the owning plugin's row, keeps `claim.tab` inert at runtime, and forbids `SettingsPanel.tsx` from importing `SettingsSectionSlot`. An earlier draft of this design specified a dedicated `apple-tools` page; that would have required amending a deliberate recent decision and adding a `SettingsTab` union member — both outside this change's scope. Conforming costs this panel nothing it needs.

### 6. Skill checks provisioning on load

**Decision.** The skill runs the `--check` traversal when it loads, costing one `sw_vers` and a few `stat` calls per session.

**Why.** The failure mode it prevents is the expensive one: the agent discovers the gap mid-task by calling an MCP tool that fails opaquely, then has to diagnose. Fast-fail at load turns that into a one-line "iMCP not provisioned, run `pi-apple-tools-install`" before any work is planned. The alternative (check only after a first tool failure) is free but strictly worse at exactly the moment it matters.

**Mitigation for the cost.** Results cache for the session; the traversal short-circuits on the first non-`darwin` platform check, so non-macOS users pay approximately nothing.

## Risks / Trade-offs

- **Core-schema change widens blast radius** → `paths` is additive and optional; every existing manifest stays valid. Contract tests must assert an absent `paths` behaves exactly as today, and that `missingFromReport` ordering is unchanged for existing categories.
- **Bundle-completeness gate is a hard CI failure, not a warning** → `packages/shared/src/__tests__/bundled-plugins-complete.test.ts` requires every non-fixture `pi-dashboard-plugin` under `packages/*` to appear in `BUNDLED_PLUGINS` (`packages/electron/scripts/bundle-server.mjs:122`). Adding the entry is a task, not an afterthought; omitting it reds CI and, if forced through, ships a plugin whose entire dashboard surface exists only in dev builds — production discovery reads `resources/plugins/`.
- **The existing pill UI does NOT render a fourth category — a client edit is required** → `packages/client/src/components/packages/PluginsSection.tsx:152` derives its rendered lists from `requirements.{piExtensions,binaries,services}` and uses `missingRequirements` only as an early-return guard. An unsatisfied `paths` entry passes the guard and renders an empty block. `PluginsSection.tsx` is therefore inside this change's surface, not "unchanged"; the delta's warning-pill scenario fails without it.
- **`sourcesMatch()` lives in a package the installer does not yet depend on** → it is at `packages/shared/src/source-matching.ts`. `packages/apple-tools` must declare `@blackbelt-technology/pi-dashboard-shared` as a dependency and import it; a local reimplementation would diverge from the matcher every other consumer uses — exactly the drift the git-sourced-adapter scenario exists to catch.
- **The adapter's required `mcpServers.<id>` field set is taken on faith** → this design specifies only `command`. If `pi-mcp-adapter` requires `type: "stdio"` or an `args` array, a `command`-only entry is silently non-functional. MUST be verified against the installed adapter at implementation time and the written shape pinned by a test — not inferred from the iMCP README's Claude Desktop example.
- **No install affordance for non-package requirements** → `packages/client/src/components/packages/PluginsSection.tsx:168` renders the inline `[Install]` button only for names matching a `RECOMMENDED_EXTENSIONS.id`. A `paths` requirement has no package source, so it correctly falls back to a non-actionable pill; the `pi-mcp-adapter` requirement falls back to `[Install via Packages tab]` because this change does not add a third-party entry to the curated manifest. Neither is one-click.
- **`brew install --cask` is a long, network-bound, failure-prone shell-out** → never invoked implicitly. Opt-in `bin` only, no `postinstall`. On failure the installer surfaces brew's own output verbatim and falls back to printing the direct download link rather than retrying.
- **`/Applications/iMCP.app` is not the only valid location** (user-local `~/Applications`, homebrew prefix variance) → path override in `configSchema`; the probe checks a small ordered candidate list before declaring absence.
- **Upstream `imcp-server` path could move between iMCP releases** → the path is data (`configSchema` + candidate list), not a hardcoded constant, and the failure is a legible `NO_INSTALL_METHOD`-class state rather than a silent broken MCP entry.
- **`pi-mcp-adapter` is a third-party package on a fast cadence** (v2.19.0, ~242k downloads/mo) → we depend on its config-file contract (`~/.pi/agent/mcp.json`, `mcpServers.<id>.command`), which is documented and shared across MCP hosts, not on its internals. A breaking change there degrades to "server not found", not data loss.
- **TCC grants can be revoked at any time**, out of band → tool calls fail with the app's own error; the skill's load-time check cannot detect revocation (no API). Documented as a known limitation, with the settings panel's status readout as the manual recovery path.
- **Redundant `pi-mcp-adapter` install** (Decision 3) → accepted, documented, one-line revert.
- **Non-macOS contributors run the test suite** → all installer tests must inject the platform/version/FS probes; zero tests may touch a real `/Applications` path or invoke `brew`.
- **Naive metacharacter rejection false-negatives legitimate paths** → macOS application paths routinely contain spaces. The `paths` probe MUST NOT reject on a character denylist; it treats the value as an opaque filesystem path, never builds a shell string from it, and rejects only non-absolute values. Safety comes from never reaching a shell, not from character filtering.
- **`packages[]` dedup by exact string match misses a git-sourced adapter** → the append-if-absent check must reuse the repo's existing `sourcesMatch()` cross-kind matcher (npm ↔ git), not `===`, or a user who installed `pi-mcp-adapter` from git receives a second, npm-sourced entry — violating the idempotency invariant.

## Migration Plan

Additive throughout — no existing behaviour changes, nothing to migrate.

1. Land the `paths` category in shared + runtime first (self-contained, independently testable, no consumer yet).
2. Land `packages/apple-tools/` consuming it.
3. Land the `RECOMMENDED_EXTENSIONS` entry last — it is the only user-visible surface, so it gates on the other two being real.

**Rollback.** Remove the `RECOMMENDED_EXTENSIONS` entry (the plugin disappears from the install browser) and set `plugins["apple-tools"].enabled = false`. The `paths` category can stay — it is inert with no manifest declaring it. No user data is touched by rollback; a provisioned machine keeps its working `mcp.json` entry and its TCC grants.

## Open Questions

None. All seven decisions are resolved and recorded in `proposal.md` §Resolved Decisions.
