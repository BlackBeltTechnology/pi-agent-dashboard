## Context

The dashboard owns roles + model resolution (specs `dashboard-roles-ownership`, `dashboard-model-resolution`) but exposes them only via WebSocket messages driven by the human Settings UI (`RolesSettingsSection.tsx`). An in-session agent has no way to see or wire roles/models.

Two live resolvers exist plus one deprecated:
- `model:resolve` (provider-register.ts) — full resolver: `@role` → literal → `registry.find` → `Model` + `auth`. Primary.
- `role:resolve-model` (role-manager.ts) — narrow adapter for the `pi-dashboard-subagents` harness: `@role` → literal string only, stops there (lenient).
- `flow:resolve-model` (provider-register.ts) — deprecated alias, no `@role`.

Session-log evidence (prior "model resolve wrong" session) established the real resolution bug: `getModelRegistry()` falls back to `pi.modelRegistry`, which does **not exist** on `ExtensionAPI` in pi-coding-agent 0.80 (only on `ExtensionContext`). In spawned/headless subagent sessions `modelRegistryRef` is never captured, the fallback yields `undefined`, and resolution fails uniformly — even for models the session runs. The registry itself holds ~1000 models; the handle is the problem. The current `dashboard-model-resolution` spec actively *mandates* this dead fallback, so this change corrects the spec.

The role-name set is a hardcoded `DEFAULT_ROLE_NAMES` const overlaid at read time (`overlayDefaultRoles`), making defaults un-removable — blocking user-defined roles.

## Goals / Non-Goals

**Goals:**
- Two agent-facing tools: `list_roles` (read) and `update_roles` (write, confirmed, action-dispatched).
- Editable role-name schema; new roles surface as empty slots across all presets; removal purges.
- Consolidate resolution onto `model:resolve`: single `lookupRole()` accessor; `role:resolve-model` demoted to a one-release alias (legacy `probe.resolved` string-consumers only).
- Fix the dead registry handle so `model:resolve` works in spawned/headless sessions (the actual "resolution is still an issue").
- Delete the subagents harness's own dead `pi.modelRegistry` fallback; bump its installed build (it already emits `model:resolve` / reads `probe.model`).

**Non-Goals:**
- Per-session role scoping — roles stay global in `providers.json`.
- Changing `agent-model-introspection`'s `GET /api/models` requirements; that REST surface stays for out-of-process/HTTP callers.
- Keeping any `flow:role-*` compatibility alias — the rename is atomic (no external emitters).

## Decisions

**D0. `list_models` is a TOOL (in-process Registry #1), added alongside the existing REST surface.** `GET /api/models` + the `dashboard-list-models` slash command already exist but read the dashboard server's registry (Registry #2) over HTTP. The tool reads the session's own registry (Registry #1) in-process, so its `ref`s are guaranteed consistent with what `set_role` persists and `model:resolve` resolves — and it matches the human ModelSelector exactly. The tool SUPERSEDES `dashboard-list-models` for in-session agents; the REST endpoint + command stay for out-of-process/HTTP consumers. *Alt:* reuse the command only — rejected (Registry #2 can drift from the session's actual registry). *Alt:* retire the command — rejected (still needed for browser/external).

**D1. Three tools; read/write split AND model/role decouple.** `list_models` (read), `list_roles` (read), `update_roles` (dispatched write). A safe read and a global-mutating write behind one call would muddy the schema + confirmation story (write split). Model listing is a lower-level primitive with an independent failure mode from roles — an agent may want the catalogue when roles are absent/unconfigured/malformed — so `list_models` is its own tool that never touches the role slice (model/role decouple). *Alt considered:* bundle models into `list_roles` (a single read) — rejected: couples model listing to role-slice health, so a malformed `providers.json#roles` would break model discovery too. *Alt:* single `roles` tool with a mode flag — rejected (conflates safety tiers).

**D2. `update_roles` uses a discriminated `action` schema.** Mirrors the repo's existing `ask_user` discriminator pattern (`ask-user-schema-discriminator.test.ts`) — clean per-action arg shapes instead of a bag of optionals. Actions: `set_role`, `remove_role`, `create_preset`, `load_preset`, `delete_preset`.

**D3. Global writes require `ask_user` confirmation.** `providers.json` is shared by every session/process; a silent rebind of `coding` hits all of them. Confirm each mutating action. *Alt:* silent writes — rejected (blast radius). *Alt:* per-session role store — rejected (Non-Goal; large).

**D4. `set_role` on a new name implicitly creates the role; only removal needs a dedicated action.** Fewer actions, matches natural agent phrasing. `preset?` optional arg lets the agent wire a named preset without loading it first — making today's implicit "active preset gets mirrored" behavior explicit.

**D5. Role-name schema is shared across presets (Model 1), not per-preset bags.** Roles are resolution targets that flows/agent configs depend on; a role must mean the same thing regardless of active preset. Adding a role surfaces an empty slot everywhere. *Alt (Model 2):* independent per-preset key bags — rejected (`@role` could silently vanish on preset switch, breaking configs).

**D6. `remove_role` purges from every preset (confirmed).** Orphaned bindings confuse the next reader and re-appear unexpectedly. *Alt:* orphan/recoverable dead data — rejected (cruft, surprise).

**D7. Registry-handle fix = acquire `ctx.modelRegistry`, drop the dead fallback (Option A). This is sufficient — Option B (threading) is NOT needed to fix the bug.** Resolution runs in the PARENT session: the harness's `resolveModelFromRef` fires on a mid-session tool call (long after the parent's `session_start`), emits `model:resolve` on the parent's bus, and reads back `probe.model`; the resolved `Model` is then passed into `createAgentSession` and the child never resolves itself. So a registry IS available parent-side — the bug was only that the dashboard's `getModelRegistry()` reached for the dead `pi.modelRegistry` (via a `(piRef as any)` cast) when `modelRegistryRef` hadn't been captured. Fix: capture `ctx.modelRegistry` across the parent's lifecycle points, drop the dead fallback, so `probe.model` fills reliably. *Alt (Option B):* resolve fully in the parent and thread `Model`+`auth` into the spawn so the child needs no registry — architecturally cleaner but unnecessary here (no registry-less resolve exists in the real flow); filed as a deferred insurance task only.

**D8. No `probe.resolved` leniency reorder — subagents read `probe.model`, not `probe.resolved`.** The harness (verified in source) reads `probe.model` (a real registry-resolved Model), then `probe.error`; it never reads `probe.resolved`. A lenient string therefore does nothing for it — the fix must fill `probe.model`, which D7 does. Setting `probe.resolved` early would only benefit a *legacy* `role:resolve-model` string-consumer, which the deprecated alias already covers. Dropped from scope. *Alt considered:* keep the early-`probe.resolved` assignment for cold-start string survival — rejected (no current consumer reads it; adds surface for nothing).

**D9. `role:resolve-model` kept one release as a thin alias over the shared resolve path.** Same one-release pattern already used for `flow:resolve-model`; avoids a flag day where an un-migrated subagents build hard-fails. Delete at next major.

**D11. Atomic `flow:role-*` → `roles:*` rename, no alias; delete `flow:resolve-model` now.** Roles are 100% dashboard-owned; the `flow:` prefix is a cosmetic legacy holdover from when the code lived in pi-flows. pi-flows now has zero role code, and every `flow:role-*` emitter (bridge.ts, ~11 sites) and handler (role-manager.ts, 5) is in-repo, so there is no external producer to break — the base spec's "preserve for one release" shim is obsolete and its window expired. Rename all producers + consumers in one commit; no `flow:` alias retained. `flow:resolve-model` (deprecated, replacement `model:resolve`, zero in-repo emitters) is deleted in the same pass rather than deferred. *Contrast with D9:* `role:resolve-model` DOES keep a one-release alias because it has a known external consumer (older installed subagents-harness builds); `flow:role-*` has none. *Alt:* keep `flow:` aliases one release — rejected (no consumer to protect; keeps dead surface).

**D10. Single `lookupRole()` accessor.** The `@role` → `providers.json#roles[name]` lookup is currently duplicated (`getModelRole()` vs `loadRoleConfig().roles[name]`). Collapse into one accessor consumed by the resolver, the alias, and both tools — no fourth independent reader.

## Risks / Trade-offs

- **Agent mutates global machine config** → `ask_user` confirmation on every write (D3); `security-hardening` review of the gate + blast radius.
- **Subagents harness/dashboard version coupling** → one-release `role:resolve-model` alias (D9); no lockstep flag day.
- **Editable schema breaks the UI's never-empty overlay** → overlay must key off the effective schema (defaults minus removals), not the hardcoded const; covered in tasks + `RolesSettingsSection` tests.
- **Removal markers vs. "defaults re-inject on read"** → need a way to record that a default was removed so the read-time overlay does not re-add it; simplest is a persisted schema/removed-set, resolved during design of the accessor.
- **Custom-provider async discovery races** → resolution is parent-side and mid-session, so custom-provider registration has normally completed by spawn time; if a `registry.find` miss still occurs, `probe.error` surfaces a clear "not registered/authenticated" message (harness behavior). Option B (deferred) would remove any residual race by resolving in the parent before spawn.

## Migration Plan

1. Land Option A registry-handle fix in the dashboard (`ctx.modelRegistry` capture, drop dead fallback) so `probe.model` fills reliably (bugfix; independently valuable).
2. Add `lookupRole()`; route resolver + alias + tools through it.
3. Add `list_roles` / `update_roles` tools; editable schema + purge.
4. Delete the harness's dead `pi.modelRegistry` fallback + bump its build. Keep `role:resolve-model` as a deprecated alias for legacy harness builds.
5. Rename `flow:role-*` → `roles:*` atomically across `bridge.ts` (emitters) + `role-manager.ts` (handlers) + comments (`App.tsx`, `provider-register.ts`) + tests, in one commit; delete `flow:resolve-model`.
6. Next major: delete `role:resolve-model`.

Rollback: tools and alias are additive; reverting the extension restores prior behavior. The registry-handle fix is a strict correction (dead code removed) — low rollback risk.

## Open Questions

- Exact persistence shape for the editable role-name schema + removal markers (new `roleNames` array? a `removedRoles` set?) — resolve when implementing `lookupRole()`.
- Confirmation UX for batch wiring (agent setting 6 roles) — one confirm per action is safe but chatty; a single batched confirm is out of scope for v1.
