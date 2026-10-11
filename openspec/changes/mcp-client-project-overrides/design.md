## Context

pi 1.1.0 `loadMcpConfig` (`@earendil-works/pi-coding-agent/dist/extensions/mcp/config.js`):

- `OVERRIDE_KEYS = ["enabled", "exposure", "toolExposure"]` (`:36`). `isOverride(v)` ⇔ `v.command === undefined && v.url === undefined && v.type === undefined` (`:38-40`). Note that `null` and `""` count as *set*.
- The global file is read first. Invalid global entries (`:83-86`) and namespace-colliding ones (`:89-93`) are **not** stored, so they can never be an override base.
- Project override block (`:65-82`): there is a base only if `servers.get(name)` exists, meaning a *kept* global entry. Without one: `needs "command" or "url", or a global server to override`. Extra keys: `an override can only set enabled, exposure, toolExposure`. Otherwise `validateMcpServerConfig(name, { ...base.config, ...value })`, stored with `override: <path>`. The override path skips the namespace-clash check and the project-`auth` check.
- Full project entries (`:83-97`): validated, clash-checked, `auth` refused, and they replace the global entry whole.
- `updateMcpServerConfig(..., { override: true })` (`:123-145`): a missing override is created as `{}`. On an override, enabling writes `enabled: true` instead of deleting.
- pi's `/mcp` UI offers per-project on/off only for global servers without an override (`dist/extensions/mcp/index.js:703-704`).

Dashboard today (`packages/mcp-client-plugin/src/`):

- `core/pi-rules.ts:182`: `validatePiEntry` returns `needs either "command" (stdio) or "url"` for transport-less entries.
- `core/effective-view.ts:127-136`: **every** global entry goes into `byName`, invalid and collided ones included (they carry `piError` / `name-collision`). A folder entry with `piError` becomes a separate folder row, and the global row stays (`:159-162`). A valid folder entry replaces the global row (`:177-179`). In a project view global rows are redacted (`describe(..., isProject)`, call at `:128`).
- `core/config-writer.ts`:
  - `folderCopyOf` (`:77-92`) strips `headers`, `env`, `auth` and `oauth.clientSecret`.
  - `collisionCandidates` (`:129-147`) adds every key of the global file and of every known trusted folder file.
  - `validateEntry` (`:150-191`) runs `validatePiEntry`, the transport, clash and project-`auth` checks.
  - `setEnabled` (`:308-356`): the project-scope copy path is at `:340-349`, and `needs-choice` at `:324-330`.
- `core/types.ts:73-80`: closed `ConfigRefusalCode`. `core/schema-validation.ts:41`: `validateServerEntry(entry)` compiled from `$defs.ServerEntry` (no `required`, so an override-shaped entry passes).
- `server/routes.ts`: `PUT /servers/:name` (`:230`, calls `validateServerEntry` at `:241`), `DELETE` (`:261`), `PUT …/enabled` (`:280`, boolean checked before scope parsing), `POST …/convert` (`:298`, adapter leftovers).
- `client/`: `ServerList.tsx` chips at `:77-78, :218-226`, `omitted` handling at `:123`. `FolderMcpPage.tsx` undo re-PUTs the removed raw entry (`:166-179`). `FolderMcpSection.tsx:195-196`: pill `count = servers.length`, `off = !enabled || !active`.
- Dependents: apple-tools uses `ensureServerEntry` at global scope only (`packages/apple-tools/src/install.ts:190`). The Radius route writes global only.

## Goals / Non-Goals

**Goals**
- Show exactly what pi loads, for overrides and replaces alike.
- Per-project on/off and exposure for a global server, with no copying and no dropped credentials.
- A safe way out for copies written by the old disable path.

**Non-Goals**
- Editing `toolExposure` in the UI (it is shown and preserved; the API accepts it for restore).
- Finding overrides in other folders when a global server is renamed or deleted.
- `autoEnableCodemode` UI, and any change to the Settings (Pi-global) page.

## Decisions

**D1: Mirror pi's two-pass load in the core.** The effective view first computes the **kept global set**: global entries with no `piError` that were not deactivated as name collisions. `classifyProjectEntry(name, value, keptGlobal?)` returns one of:
- `{kind: "replace"}` when `isProjectOverride` is false (`=== undefined` checks, exactly pi);
- `{kind: "orphan", message}` when there is no kept base;
- `{kind: "bad-keys", message}` for keys outside `OVERRIDE_KEYS`;
- `{kind: "invalid", message}` when `validatePiEntry(name, {...base, ...value})` fails;
- `{kind: "override", merged}`.

Messages are pi 1.1.0's text without the path prefix, and the view and UI show the folder file path separately (as `layers[]` does today). This is a pure function in `pi-rules.ts`; `./core` stays host-free and never imports pi. The kept global set comes from one shared helper, `keptGlobalOf(globalLayer)` (valid, first-wins on namespace collision, as `effective-view.ts:123-136` and pi `config.js:83-93` do), which the view **and** every writer use. The writer therefore never accepts an override that the view would show as orphaned. Exposure aliases in the merged entry (`exposure`, `toolExposure` values such as `codemode-deferred`) are displayed resolved, as pi resolves them (`dist/core/mcp-servers.js:114-124`), and the file bytes keep the literal (existing alias rule).

**D2: A valid override is one row.** The global server's row keeps `provenance: "pi-global"`, takes `entry = merged`, redacted exactly like any global row in a project view, and gains `projectOverride: { path, keys, raw }`. `raw` holds only override keys, which the schema guarantees carry no secrets. `overridesGlobal` stays for whole-entry replaces. "Layer provenance" is MODIFIED to say so.

**D3: Untrusted project.** pi doesn't read the file. The global row stays unchanged, and an override shows as an inactive folder row (`project-not-trusted`), same as any untrusted folder entry today. The per-project controls stay usable, because the existing spec allows editing an untrusted folder. After a write, the row states "Saved — applies once the project is trusted", so a switch that appears not to take effect is explained.

**D4: Toggle = effective state, smallest write.** At folder scope, for a kept global server:

| Global `enabled` | User sets | Write |
|---|---|---|
| on | Off | override `enabled: false` |
| on | On | delete override `enabled` |
| off | On | override `enabled: true` |
| off | Off | delete override `enabled` |

States compare on the effective value: `enabled ?? true` (a global entry without `enabled` is on). Every write is a read-modify-write of the existing override, so keys it doesn't touch (`exposure`, `toolExposure`) survive. When the required key change is none, the write touches no file and creates no `.pi/mcp.json`. That covers a matching toggle, Reset with no override, and an all-`null` patch on a missing entry. Rows for orphaned, bad-key or invalid overrides offer only **Remove**: their switch is disabled, and a project-override write for them is refused (`no-global-server`, or pi's message). An override left `{}` is deleted. A no-op, where there is no override and the requested state equals the effective state, touches no file and creates no `.pi/mcp.json`. **Reset to global** deletes the override entry. The panel's Inherit/On/Off writes exactly what is chosen. Mirroring pi's always-explicit `/mcp` writes was considered and rejected: the project state would freeze, and later global changes would stop applying.

**D5: Writer paths.**
- `setProjectOverride(name, patch, scope)`, where `patch: { enabled?, exposure?, toolExposure? }` (absent = unchanged, `null` = delete key). It validates through `classifyProjectEntry` on the merged result, and does **not** run `validateEntry`'s clash or project-`auth` checks (pi skips them for overrides). It refuses `no-global-server` when there is no kept base. It writes atomically like every other write.
- `setEnabled` at project scope for a kept global server with no folder entry goes to `setProjectOverride` (D4). For an existing whole-entry folder entry, the current behaviour is unchanged, `needs-choice` included. For an existing override, it goes to `setProjectOverride`. The copy path (`config-writer.ts:340-349`) and new `omitted` results are deleted.
- `saveServer` (generic PUT) keeps full entries only. At project scope, a body for which `isProjectOverride` is true (the `=== undefined` rule; `{url: null}` is **not** an override) is refused as `invalid-entry` with the message "use the project-override route". A rename (`previousName`) where either side is an override is refused the same way. This leaves exactly one override write path.
- Refusal precedence: an unparseable target or global file (`unparseable`) wins over `no-global-server`, so corruption is never masked.
- `collisionCandidates` at global scope ignores folder entries for which `isProjectOverride` is true, because pi never clash-checks them. A consequence that is intended for pi fidelity: adding global `dev_radius` while a folder holds the override `dev-radius` now succeeds, and that folder's row becomes an orphaned override (pi bases overrides on the exact name).
- `ConfigRefusalCode` gains `no-global-server`. "Writes are atomic…" is MODIFIED.

**D6: Routes.**
- `PUT /api/mcp-client/servers/:name/project-override`, body `ScopeInput & { enabled?: boolean|null, exposure?: Exposure|null, toolExposure?: Record<string, Exposure>|null }`. Every field's type and enum, `toolExposure` values included, with pi's aliases accepted, is validated **before** `parseScope`, mirroring `/enabled` (`routes.ts:280-287`). A bad body then can't reveal whether a folder is admitted. Project scope only (global → `400`). The response is `{ ok: true, override: <raw> }`, or `{ ok: true, removed: true }`. The undo for Reset, and for **Remove of any override-shaped row** (orphaned or invalid included), re-PUTs the prior raw keys through this route (absent keys sent as `null`), which restores the identical entry. The client picks the undo route by `isProjectOverride(removed)`: overrides go here, full entries go to `PUT /servers/:name` as today. An empty `{}` override counts as absent.
- `POST /api/mcp-client/servers/:name/convert-to-override` (project scope): converts a legacy copy (D7) and returns `{ ok: true, previous: <raw entry> }`. Undo re-PUTs `previous` via `PUT /servers/:name`, which is valid because it is a full entry.
- Both routes have the same `guard`, authentication and known-folder admission as the existing routes. "HTTP surface" is MODIFIED.

**D7: Legacy-copy detection is exact and veto-safe.** A *full* entry is one with a string `command` or a string `url`, defined once and reused in the spec, task 1.2 and task 3.4. `isLegacyFolderCopy(folderRaw, globalRaw)` is true only when all of these hold:
- both are full entries;
- **the folder entry carries none** of `headers`, `env`, `auth`, `oauth.clientSecret`;
- `omit(folderRaw, OVERRIDE_KEYS)` deep-equals `omit(folderCopyOf(globalRaw).copy, OVERRIDE_KEYS)`.

Any secret on the folder side (for example a re-entered header) vetoes conversion. Conversion keeps only the override keys whose value **differs from the global value** (copied `exposure`/`toolExposure` equal to global are dropped, so they inherit again), and deletes the entry when none remain. This happens only on the operator's action, with undo.

**D8: Schema.** Add `$defs.ProjectOverride` (`enabled`, `exposure`, `toolExposure`; `additionalProperties: false`). `validateServerEntry(entry, { kind: "server" | "override" })`, with default `"server"` for existing callers (`routes.ts:241`, `schema.test.ts`). The project-override route validates its resulting raw against `"override"`. `client/schema.ts` keeps rendering `ServerEntry` only, because the panel is hand-built (two fields).

**D9: Client presentation (mockup `mockups/mcp-project-override/`).**
- **Global row at folder scope:** the switch shows the effective state. A text badge shows when an override key is set: `Off in this folder` / `On in this folder` / `Exposure: <v> in this folder`. **Reset to global** sits next to the badge. The existing `overrides Pi global` chip stays for whole-entry replaces.
- **Overflow:** **Project settings…** opens a panel with a `radiogroup` Inherit/On/Off (arrow keys) and an exposure select whose first option is "Inherit (<global value>)", plus `toolExposure` read-only. **Replace with folder entry…** is the old Override… editor.
- **Orphaned or invalid override:** a folder row with pi's message and **Remove**.
- **Legacy copy:** an info strip, "Copied from Pi global by an older dashboard — credentials not included", with **Convert to project override**. The `omitted` note UI is removed, because new writes never return `omitted`.
- **Mobile (< 640 px):** the panel opens as a bottom sheet. Badges are display-only. Reset and Convert move into the row's sheet. Every action keeps a **44 px** hit area (live "Mobile presentation" floor; MODIFIED to cover the new controls).
- **Pill:** rows carrying an orphaned, bad-key or invalid override (a dedicated marker on the row, not bare `!active`, so untrusted rows still count as today) are excluded from both the server count and the off count (`FolderMcpSection.tsx:195-196`).

## Risks / Trade-offs

- [pi changes the override rule again] → A pure mirror plus golden tests using pi's message strings, and `update-pi-core-*` reviews `config.js` on each bump.
- [An operator relied on "Override…" copying the whole entry] → It stays available as "Replace with folder entry…".
- [`toolExposure`-only overrides made by hand] → Shown, preserved, removed by Reset, restorable through the API.
- [A merged entry leaks folder-only data into a global row] → Override keys can't hold secrets (schema), and merged rows go through `redactEntry`.
- [pi `/mcp` and the dashboard write the same file concurrently] → Unchanged: atomic rename, last writer wins, same shapes.
- [A registered (extension) server shares a name with a folder override] → pi's `registerMcpServer` servers are not part of `loadMcpConfig`. Interaction is `unverified` and out of scope; the dashboard view is file-based, as today.

## Migration Plan

No automatic file migration. New writes use overrides. Legacy copies keep working and are offered conversion. Rollback: revert the plugin. Override entries stay valid pi config, and a reverted dashboard shows them as invalid folder rows (pre-change behaviour). Recovery: Reset in pi's `/mcp`, or delete the key by hand.
