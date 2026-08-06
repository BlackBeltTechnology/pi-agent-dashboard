# add-apple-tools-imcp-plugin

## Why

pi ships **no MCP support** — `node_modules/@earendil-works/pi-coding-agent/README.md:492` states *"No MCP. Build CLI tools with READMEs, or build an extension that adds MCP support."* Apple PIM data (Calendar, Contacts, Reminders, Messages, Location, Maps, Weather) is therefore unreachable from a pi session today.

[iMCP](https://github.com/mattt/iMCP) (mattt, macOS 15.3+) closes that gap: a menu-bar app that acts as a TCC permission broker, paired with a bundled `imcp-server` CLI speaking **stdio** MCP. App and CLI rendezvous over Bonjour (`_mcp._tcp`).

```
 pi session                imcp-server (CLI)              iMCP.app
 ──────────                ─────────────────              ────────
 pi-mcp-adapter ─stdio──▶  StdioProxy  ──Bonjour──▶  TCC permission broker
                                        _mcp._tcp          │
                                                    EventKit, Contacts,
                                                    Messages db, MapKit…
```

The friction is setup, not capability: install a cask, verify an OS floor, locate a binary inside an `.app` bundle, merge an MCP server entry into the right config file (of six precedence layers), ensure the MCP adapter package is loaded, then hand-grant seven TCC permissions. That is a ~20-minute error-prone ritual we should reduce to one command plus a documented manual click-through.

**Scope boundary — no Mail.** iMCP's capability set is Calendar, Contacts, Location, Maps, Messages, Reminders, Weather. "Messages" is iMessage/SMS, **not Apple Mail**. Mail access is explicitly out of scope for this change; the existing `apple-mail-fast-export` hermes skill (direct `.emlx` copy) remains the mail path. This is recorded here so the gap is not rediscovered later.

## What Changes

- **NEW** `packages/apple-tools/` — pi package **and** `pi-dashboard-plugin` (id `apple-tools`), `@blackbelt-technology/pi-dashboard-apple-tools`, matching existing monorepo conventions (`kb-extension`, `document-converter`).
  - `.pi/skills/apple-tools/SKILL.md` — the agent-facing surface: how to reach Apple PIM via the adapter's `mcp({search})` / `mcp({tool, args})` two-call pattern, which services exist, what each needs, and the explicit "Mail is not here → use `apple-mail-fast-export`" redirect.
  - `src/detect.ts` — pure probes: `process.platform`, `sw_vers -productVersion`, `/Applications/iMCP.app` presence, `imcp-server` binary path, `brew` availability, current `mcp.json` state. No side effects.
  - `src/mcp-config.ts` — merge-only writer for the iMCP entry in `~/.pi/agent/mcp.json` (or `$PI_CODING_AGENT_DIR/mcp.json`). Never clobbers sibling `mcpServers` entries.
  - `src/install.ts` — installer/doctor CLI, exposed as `bin: { "pi-apple-tools-install": ... }`.
  - `server/` — plugin server entry; owns the provisioning probe and the `[Run installer]` action.
  - `client/` — `AppleToolsSettings.tsx`, claiming `settings-section`. Per `openspec/specs/dashboard-plugin-loader/spec.md:1043` this renders **inline under the plugin's own row in the Plugins tab**, reached via that row's settings-gear affordance. `claim.tab` is inert at runtime and SHALL NOT be set.
  - `config.schema.json` — JSON Schema 7 for `configSchema`.
  - `README.md`, `AGENTS.md` (directory tree node per the Documentation Update Protocol).

- **NEW** installer contract:

  ```
                pi-apple-tools-install [--check]
                         │
                ┌────────▼────────┐
                │ process.platform│
                └───┬─────────┬───┘
               darwin         other ──▶ exit 0, "iMCP is macOS-only, skipped"
                   │
          ┌────────▼────────┐
          │ sw_vers ≥ 15.3? │──no──▶ exit 1, upgrade required
          └────────┬────────┘
          ┌────────▼──────────────────┐
          │ /Applications/iMCP.app ?  │
          └───┬───────────────────┬───┘
            yes                  no
              │          ┌────────▼────────┐
              │          │ brew present?   │
              │          └──┬───────────┬──┘
              │           yes           no ──▶ print iMCP.app/download link, exit 1
              │             │
              │   brew install --cask mattt/tap/iMCP
              └─────────────┤
          ┌─────────────────▼─────────────────────────────┐
          │ ensure npm:pi-mcp-adapter in settings.json    │
          │ packages[]  (merge, idempotent)               │
          └─────────────────┬─────────────────────────────┘
          ┌─────────────────▼─────────────────────────────┐
          │ merge mcpServers.iMCP.command =               │
          │  /Applications/iMCP.app/Contents/MacOS/       │
          │  imcp-server        → ~/.pi/agent/mcp.json    │
          └─────────────────┬─────────────────────────────┘
          ┌─────────────────▼─────────────────────────────┐
          │ print MANUAL step: open -a iMCP, click each   │
          │ service in the menu bar to fire TCC dialogs.  │
          │ NOT automatable (Apple security model).       │
          └───────────────────────────────────────────────┘
  ```

  `--check` is the same graph with every write suppressed — an idempotent doctor. Re-running without `--check` is also idempotent (merge semantics, no duplicate entries).

  **`--check` is additionally wired as a probe into the repo's existing `doctor` skill** (`packages/extension/.pi/skills/doctor`), so a half-provisioned machine is diagnosable from the standard entry point. The standalone flag remains.

  **The skill runs `--check` on load** — a `sw_vers` + `stat` per session, accepted for fast-fail over a first-tool-failure diagnosis.

- **NEW** `PluginRequirements.paths` — **core change** to `packages/shared/src/dashboard-plugin/manifest-types.ts`. `binaries` resolves PATH only; `imcp-server` lives at `/Applications/iMCP.app/Contents/MacOS/imcp-server`, and `services` is a closed registry plugins may not extend. A new declarative category:

  ```ts
  export interface PluginRequirements {
    piExtensions?: string[];
    binaries?: string[];
    services?: string[];
    /** Absolute filesystem paths that must exist (e.g. .app-bundled binaries). */
    paths?: string[];
  }
  ```

  Probed by the same server-side machinery as the other categories and surfaced through `PluginStatus.requirements` / `missingRequirements`, so the existing missing-requirement pill UI works unchanged. Generally useful for any `.app`-bundled or non-PATH dependency — not an iMCP special case.

- **NEW** `RECOMMENDED_EXTENSIONS` entry (`packages/shared/src/recommended-extensions.ts`), status **`optional`** (macOS-only, niche):

  ```ts
  {
    id: "@blackbelt-technology/pi-dashboard-apple-tools",
    source: "npm:@blackbelt-technology/pi-dashboard-apple-tools",
    displayName: "pi-dashboard-apple-tools",
    status: "optional",
    dashboardPlugin: "apple-tools",
    requires: { piExtensions: ["pi-mcp-adapter"] },
    unlocks: [
      "Calendar / Contacts / Reminders / iMessage via MCP",
      "Location / Maps / Weather via MCP",
    ],
  }
  ```

  `requires.piExtensions` is probed server-side and renders a missing-requirement warning pill. **The pill's action is `[Install via Packages tab]`, NOT one-click install** — `packages/client/src/components/packages/PluginsSection.tsx:168` renders the inline `[Install]` button only when the missing name matches a `RECOMMENDED_EXTENSIONS.id`, and `pi-mcp-adapter` is a third-party package this change does **not** add to that curated manifest.

- **NEW** settings panel — `configSchema` + a `settings-section` claim rendered **inline under the plugin's row in the Plugins tab**. Contents: provisioning status readout, `[Run installer]` action, adapter `disabled` toggle, `directTools` selection, `imcp-server` path override. **Explicitly NOT settable**: which iMCP services are active — that is menu-bar + TCC only, with no API. The panel must not imply otherwise.

- **NEW** bundle registration — `packages/electron/scripts/bundle-server.mjs:122` `BUNDLED_PLUGINS` gains `"apple-tools"`. `packages/shared/src/__tests__/bundled-plugins-complete.test.ts` asserts every non-fixture `pi-dashboard-plugin` package under `packages/*` appears in that list; without the entry CI fails, and the plugin's entire dashboard surface would exist only in dev builds (production discovery reads `resources/plugins/`).

- **NEW** dependency wiring — **hybrid**, deliberately not the bundling recipe in `docs/packages.md:173`:

  ```json
  {
    "dependencies": { "pi-mcp-adapter": "^2.19.0" },
    "pi": { "skills": [".pi/skills/apple-tools"] }
  }
  ```

  `pi-mcp-adapter` is declared as a plain npm `dependency` (so `pi install` resolves it per-machine and the requirement is legible in the manifest), but is **NOT** listed in `bundledDependencies` and its `index.ts` is **NOT** referenced from our `pi.extensions`. The installer instead appends `"npm:pi-mcp-adapter"` to the user's `settings.json` `packages[]`.

  Rationale — the two rejected alternatives:

  | | Bundle (doc-canonical) | Hybrid (chosen) |
  |---|---|---|
  | native module | ✗ vendors `@napi-rs/keyring` prebuilds into a tarball published from CI | ✓ npm resolves per-machine |
  | duplicate instance | ✗ pi loads packages with separate module roots — a bundled copy alongside a user's own `npm:pi-mcp-adapter` registers the `mcp` tool twice | ✓ deduped by npm package name (pi's **vendored** `node_modules/@earendil-works/pi-coding-agent/docs/packages.md` §Scope and Deduplication — not a repo file) |
  | adapter updates | pinned to our release cadence | tracks upstream |

  **Decided: `pi-mcp-adapter` stays in `dependencies` AND is declared in `requires.piExtensions`** — belt-and-braces. The npm dependency keeps the requirement legible and npm-resolvable; `requires` drives the probe + one-click install UI. Caveat to carry into `design.md`: the npm copy lands in our `node_modules` but is never loaded from there (not bundled, not in `pi.extensions`), so it is a declaration that costs a redundant install. The installer's `settings.json` `packages[]` write is retained as the non-UI fallback path (headless / CLI-only provisioning), but the dashboard route is `requires` + `[Install]`.

- **NEW** root wiring: `packages/apple-tools` added to `pnpm-workspace.yaml` coverage (glob already covers it), version `0.7.0` to match the workspace, `publishConfig.access: public`, `keywords: ["pi-package", "pi-skill", "macos", "mcp", "imcp"]`.

- **CHANGED (core, minimal)**: `packages/shared/src/dashboard-plugin/manifest-types.ts` (`paths` category), `packages/shared/src/dashboard-plugin/plugin-status.ts` (report field), `packages/dashboard-plugin-runtime/src/server/requirement-probes.ts` (the prober), `packages/shared/src/recommended-extensions.ts` (one entry; the `dashboardPlugin` field is at line 76), and `packages/electron/scripts/bundle-server.mjs` (one `BUNDLED_PLUGINS` entry).

- **UNCHANGED**: `openspec/specs/settings-panel/` and the `SettingsTab` union — this change does **not** introduce a settings page id and does **not** re-enable `claim.tab` routing.

## Capabilities

### New Capabilities

- `apple-tools-provisioning` — platform-gated, idempotent provisioning of the iMCP app + MCP adapter + MCP server config, with a non-macOS no-op path and an explicit manual-permission handoff.
- `apple-pim-access` — the skill-level contract for reaching Apple PIM services through the adapter, including the documented Mail exclusion and redirect.

### Modified Capabilities

- `dashboard-plugin-loader` — `PluginRequirements` gains a `paths` category; the requirement prober and `missingRequirements` flattening must handle it.
- `doctor-skill` — gains an Apple-tools provisioning probe.

**Not modified:** `settings-panel`. An earlier draft proposed a dedicated `apple-tools` page; that is forbidden by `dashboard-plugin-loader` spec:1043 (`settings-section` renders only under the owning plugin's row; `claim.tab` inert at runtime). The panel conforms to the current contract instead.

## Discipline Skills

- `security-hardening` — the installer writes to two user-global config files (`~/.pi/agent/settings.json`, `~/.pi/agent/mcp.json`) and shells out to `brew`. Merge-not-clobber, no command injection from probed values, and no credential copying are hard requirements.
- `scenario-design` — the platform/version/app/brew matrix is the whole feature; scenarios must cover non-macOS, macOS < 15.3, app-present, app-absent-with-brew, app-absent-without-brew, re-run idempotency, and pre-existing-sibling-`mcpServers` preservation.
- `observability-instrumentation` — `--check` is the doctor surface; its output must be sufficient to diagnose a half-provisioned machine without reading code.

## Resolved Decisions

| # | Question | Decision |
|---|---|---|
| 1 | How to probe iMCP.app presence | Extend `PluginRequirements` with a `paths` category (core change, reusable) |
| 2 | Drop `pi-mcp-adapter` from npm `dependencies` | No — keep it, *and* declare `requires.piExtensions` |
| 3 | Where `--check` lives | Standalone bin **and** wired into the existing `doctor` skill |
| 4 | When the skill verifies provisioning | On skill load (fast fail) |
| 5 | `RECOMMENDED_EXTENSIONS` status | `optional` (macOS-only, niche) |
| 6 | `settings-section` target | ~~New dedicated `apple-tools` page~~ → **CORRECTED** (doubt-review): renders inline under the plugin's row in the Plugins tab. The dedicated-page option was offered in error — `dashboard-plugin-loader` spec:1043 makes `claim.tab` inert at runtime. Conforming keeps scope smallest and avoids amending a deliberate recent decision. |
| 7 | Installer trigger | **Strictly opt-in via the `bin`** — no `postinstall` hook |

On #7: a `postinstall` that shells out to `brew install --cask` would fire on every CI runner, every Linux dev box, and every `pnpm install` in the monorepo. The installer runs only when a human invokes `pi-apple-tools-install`, or when the settings panel's `[Run installer]` action calls it.

## Open Questions

None. All decisions resolved; ready for `design.md`.
