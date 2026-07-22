## Context

`pi-hermes-memory` is configured only through a hand-edited
`hermes-memory-config.json`. The extension **reads** that file once via
`loadConfig()` at extension-load; it never writes it and exposes no config
command, tool, `provide()`, or HTTP route. It is an external published npm
package (not in this monorepo), so it cannot be modified here.

The dashboard already ships a plugin system (`dashboard-plugin-runtime`) whose
`ServerPluginContext` exposes the shared `fastify` instance, letting a plugin
register its own HTTP routes. `goal-plugin` is the reference for a plugin that
targets a required-but-external pi extension (`requires.piExtensions`) and
contributes a `settings-section` claim.

This change adds a plugin that reads and writes the real config file directly,
plus a settings form covering every `MemoryConfig` field.

## Goals / Non-Goals

**Goals:**
- One dashboard settings surface to view + edit **every** `MemoryConfig` field.
- Show each field's effective value; when unset on disk, show the resolved
  **default** and mark it (DEFAULT badge) so users can tell them apart.
- Persist edits to the exact file the extension loads, writing the **full
  resolved config** on save.
- Validate submitted config server-side before writing (never trust the
  browser); write atomically.
- Activate only when `pi-hermes-memory` is installed.

**Non-Goals:**
- Modifying the `pi-hermes-memory` extension or adding an API to it.
- Hot-reloading running sessions (hermes reads config at load; edits apply to
  new sessions — surfaced as a notice, not engineered around).
- Editing memory *content* (MEMORY.md/USER.md/failures) — this is config only.
- Remote/multi-host config sync — the file is read/written on the server host.

## Decisions

### D1 — Direct file I/O, no extension API (forced)
The extension exposes nothing to read/write config, so the on-disk file is the
sole interface. The plugin server owns read/write. *Alternative rejected:*
routing a slash command into a live session — there is no config command, it
needs a running session, and output is human text.

### D2 — Path resolution mirrors the extension exactly
Resolve `PI_CODING_AGENT_DIR` (trimmed, `~` expanded) else
`os.homedir()/.pi/agent`, then join `hermes-memory-config.json`. This is a copy
of hermes `resolveAgentRoot()`. The filename is **fixed** (never user-supplied),
eliminating path-traversal risk. *Alternative rejected:* a configurable path —
adds traversal surface for no user benefit.

### D3 — Re-declare `MemoryConfig` + defaults in the plugin's shared module
Mirror goal-plugin's treatment of pi-goal-hermes: the plugin does not depend on
the external package. `src/shared/hermes-config.ts` re-declares the field set,
their types, and the `DEFAULTS` map (the values in the extension's
`DEFAULT_CONFIG`). A drift risk exists (D-R1) and is accepted + documented.

### D4 — GET returns effective + default + isDefault per field
```
GET /api/plugins/hermes-memory/config →
{
  filePath: string,
  exists: boolean,
  fields: {
    <key>: { value: <effective>, default: <default>, isDefault: boolean }
  },
  raw: <resolved config object>   // for the raw-JSON view
}
```
`value` = on-disk value when the key is present, else the default. `isDefault` =
key absent on disk. This is exactly what the form needs to render "current, else
default + badge" without client-side default knowledge.

### D5 — PUT writes the full resolved config (per user decision)
The body is the complete config object. The server **validates** it, then writes
every field's effective value (defaults included), making on-disk state
explicit. *Alternative rejected:* minimal/diff writes — the user chose explicit
full writes; defaults are frozen at save time, which is acceptable and visible.

### D6 — Server-side validation is the security boundary
`validateHermesConfig(body)` before any write:
- **Unknown keys rejected** (allowlist = the declared field set).
- **Types/enums** checked (`memoryMode ∈ {policy-only,legacy-inject}`, numbers
  finite ≥ 0 / integer where required, thinking level ∈ the enum, etc.).
- **Regex arrays** (`correction*Patterns`) each entry must compile (`new RegExp`)
  — reject on failure with the offending line.
- On any failure → `400` with a field-scoped message; **no file write**.
This is the `security-hardening` checkpoint: browser input flows to a filesystem
write, so it must be schema-validated and bounded.

### D7 — Atomic write
Write to `${file}.tmp` then `fs.rename` into place (same dir → atomic on POSIX).
Preserve pretty JSON (2-space) so hand-editors still get a readable file. Create
the parent dir if missing.

### D8 — Client: grouped accordion form (validated mockup)
Promote the approved `mockups/hermes-settings.html` direction into React under
the `settings-section` claim (`tab: "general"`), tokens mapped 1:1 to
`index.css` vars. Nine collapsible groups (progressive disclosure), per-field
DEFAULT badge + Reset, sticky save bar with change counter, raw-JSON view, and
the "applies to new sessions" notice. Folds the UX-review deferrals: inline
validation (numbers/regex), reveal `memoryPolicyCustomText` only when
`memoryPolicyStyle=custom`, `prefers-reduced-motion` guard.

### D9 — Observability
Structured `logger.info` on successful read/write (path + field count, **never**
field values — config may hold model/provider hints) and `logger.warn`/`error`
with the failure reason on validation/IO errors. Satisfies the
`observability-instrumentation` checkpoint for the two new endpoints.

## Risks / Trade-offs

- **[D-R1] Schema drift** — the extension adds/renames a field; the plugin's
  re-declared set lags. → Unknown on-disk keys are preserved in the raw view and
  round-tripped; a `tasks` note pins the source `types.ts` version to re-check on
  hermes upgrades. Same accepted pattern as goal-plugin.
- **[D-R2] Full-write freezes defaults** — a later hermes default change won't
  reach a file saved by this UI. → Documented in the UI ("fields left at default
  track the extension's value" applies until first save); acceptable per D5.
- **[D-R3] Server-host file, not the browser's** — for a remote-only pi the page
  edits the server host's file. → Correct for local + docker (same host); the
  path pill shows exactly which file is written.
- **[D-R4] Concurrent edits** — two browsers save → last-writer-wins. → Acceptable
  for a single-operator settings page; atomic write prevents partial files.
- **[D-R5] Invalid regex bricking correction detection** — mitigated by D6
  compile-check before write + client inline validation.

## Migration Plan

Additive: new package only. Add to the workspace + generated plugin registry.
No data migration. Rollback = remove the plugin; the config file and the
extension are untouched. If the file was never present, GET reports
`exists:false` and returns all-default fields; the first PUT creates it.

## Open Questions

- None blocking. (Resolved: new dedicated package; full-write on save; all
  fields incl. regex arrays; reset + raw-JSON included — per proposal Q&A.)
