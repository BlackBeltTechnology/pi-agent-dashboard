## Why

pi 1.0.1 added **project overrides** for Pi-global MCP servers. A `<cwd>/.pi/mcp.json` entry with no `command`, `url` or `type` changes only `enabled`, `exposure` and `toolExposure` of the global server with the same name, and keeps everything else, credentials included (`dist/extensions/mcp/config.js:9-12, 38-40, 65-82` in pi 1.1.0; overrides exist since pi 1.0.1, and the mirrored text is from 1.1.0). The `mcp-client` plugin still mirrors pi 1.0.0, where a project entry always replaced the global one, and dashboard sessions already run pi 1.1.0. Two problems follow:

1. **Wrong state shown.** `validatePiEntry` rejects `{ "enabled": false }` ("needs either command or url", `packages/mcp-client-plugin/src/core/pi-rules.ts:182`). `effective-view.ts:160` then assumes "pi drops an invalid project entry; the global one stays in effect", so the folder page shows a server as **enabled** that pi has turned off for that project.
2. **Lossy disable.** Disabling a global server from a folder writes a **copy** of the whole global entry, minus `headers`, `env`, `oauth.clientSecret` and `auth` (`config-writer.ts:340-349`). The copy shadows the global entry, and re-enabling needs a "remove or re-enter secrets" choice (`needs-choice`). With pi's overrides, a project disable is just `{ "enabled": false }`, and nothing is copied or lost.

## What Changes

- **Effective view mirrors pi's override rule.** A project entry without `command`/`url`/`type` is an override. It is valid only when a same-name global entry exists and its keys are a subset of `enabled`, `exposure` and `toolExposure`. Its effect is `{ ...global, ...override }`, validated as pi does. A project override's base is a global entry pi *keeps* (valid and not collided). A valid override shows as **one** row (the global server, marked "project override" with the overridden keys). An invalid override shows as a folder row carrying pi's own error message. A full project entry still replaces the global one as a whole, as before.
- **Per-project on/off control (tri-state).** On the folder page every global server gets a per-project setting: **Inherit** (no override key), **On** (`enabled: true`), **Off** (`enabled: false`). The row switch sets the effective state with the smallest override. Turning a server off writes `enabled: false`. Turning it on removes the key when the global entry is enabled, and writes `enabled: true` when the global entry is disabled. Other override keys survive, and a no-op creates no file. An explicit **Reset to global** removes the override, with exact undo. When the last key goes, the entry goes too. In an untrusted folder, a saved change is labelled "applies once the project is trusted".
- **Per-project exposure override.** Global rows gain a "Project settings…" panel for `enabled` (tri-state) and `exposure` (Inherit or one value). `toolExposure` on an existing override is shown and preserved, not edited (the same scope as pi's `/mcp`).
- **Whole-entry replace stays available.** "Override…" on a global row is renamed **"Replace with folder entry…"**. It keeps today's whole-entry editor and its secret rules for operators who need a different transport or URL.
- **Legacy copies are offered conversion.** A folder entry that is exactly a copy of the global entry made by the old disable path shows **"Convert to project override"**. To qualify, the folder entry must carry no secrets of its own, and must equal the global entry once `enabled`/`exposure`/`toolExposure` and the omitted secret fields are removed. Conversion keeps only the override keys that differ from global, and restores the global credentials, with undo.
- **BREAKING (dashboard behaviour, not file format):** disabling a global-only server from a folder no longer writes a whole-entry copy and no longer returns `omitted`. The `needs-choice` path stays only for legacy copies that were not converted.
- The published schema gains `$defs.ProjectOverride` (`enabled`, `exposure`, `toolExposure`, `additionalProperties: false`). The writer validates each project entry against the schema for its kind.
- New routes, project scope only, with the same `networkGuard`, authentication and known-folder admission as the existing ones:
  - `PUT /api/mcp-client/servers/:name/project-override`, body `{ enabled?, exposure?, toolExposure? }`, where `null` means inherit; validated before scope parsing.
  - `POST /api/mcp-client/servers/:name/convert-to-override`.
- The closed refusal set gains `no-global-server`. The `mcp-client.config` service gains `setProjectOverride` and `convertLegacyCopy`. Existing signatures are unchanged, so apple-tools and Radius (both global-scope) are unaffected.
- Folder pill: orphaned and invalid override rows are not counted as servers.
- Mockup: `mockups/mcp-project-override/` (in this change), covering the tri-state, override marker, project-settings panel, legacy-copy conversion and orphaned override.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `mcp-client-config`: the effective-view rule (override merge on pi's kept global set), layer provenance (an override keeps Pi global), atomic writes (the `no-global-server` code, overrides not clash-checked), the enabled-flag rule at project scope, the published schema (`ProjectOverride`), the in-process service (two operations), and the HTTP surface (two routes).
- `mcp-client-folder-section`: the folder page's override presentation and pill counting, mobile presentation of the new controls, the per-project tri-state and exposure override, legacy-copy conversion, and "Replace with folder entry…" replacing the whole-entry "Override…" requirement.

## Impact

- Core: `packages/mcp-client-plugin/src/core/pi-rules.ts` (override classification and validation, mirroring pi's messages), `effective-view.ts` (merge), `config-writer.ts` (`setProjectOverride`, project `setEnabled` → override, `convertLegacyCopy`), `schema-validation.ts`, `types.ts`, `service.ts`.
- Schema: `packages/mcp-client-plugin/schema/mcp-config.schema.json` (`$defs.ProjectOverride`; description bumped from "pi 1.0.0" to "pi 1.1.0").
- Server: `src/server/routes.ts` (new PUT route).
- Client: `ServerList.tsx` (override badge, tri-state, Reset), `FolderMcpPage.tsx` (project-settings panel, convert action, needs-choice limited to legacy), `folder-view.ts`, `api.ts`, `hooks.ts`.
- The folder pill counts need no logic change: they read the merged effective `enabled`.
- Files: writes stay atomic (`config-io.ts`), merge-only, and limited to one layer. Existing whole-entry copies are never rewritten without an explicit operator action.
- Rollback: revert the plugin. Override entries already written are valid pi config and keep working in pi. On a reverted dashboard they show as "invalid entry", which is today's behaviour.

## Discipline Skills

- `security-hardening`: the effective view returns credentials, and the change touches secret redaction for merged rows and a new write route behind the same guard and admission.
- `doubt-driven-review`: the writer stops creating whole-entry copies and adds a conversion of existing files (irreversible file edits on operator action).
