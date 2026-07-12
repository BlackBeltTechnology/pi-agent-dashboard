## Context

The backend for user-defined roles shipped in `2026-07-08-add-agent-role-model-tools`. This change is a thin **human-UI delta** on top of it. The design work is almost entirely about (a) how the client learns the built-in vs custom split, (b) reconciling the "add a new name" flow with the unified Settings Save contract, and (c) where the one new destructive path (`role_remove`) sits.

A visual storyboard of the six UI states (baseline, grouping, naming+validation, model-assign, result, subagent-spawn usage) accompanies this design at [`mockup/index.html`](mockup/index.html) — a standalone dark-theme HTML file styled with the real `index.css` tokens; open it directly or via `serve_mockup`.

Existing primitives reused verbatim (no change):
- `roles:set` (`role-manager.ts`) — `cfg.roles[role] = modelId` for ANY name → auto-creates a role on assignment.
- `removeRoleFromSchema(cfg, role)` — purges from schema + active map + every preset in one atomic write.
- `effectiveRoleNames(cfg)` / `overlayRoles(cfg)` — `(defaults ∪ roleNames ∪ assigned) − removedRoles`.
- `ui:model-selector` primitive — the model picker.
- `useSettingsDraftSource` — the unified Save/Reset contract (`pending` → `commit` flushes `role_set`).

## Decisions

### D1 — Atomic add, no `role_add` message (locked)
A custom role is created by assigning a model to a new name. The add flow is: **＋ Add custom role** → inline name input → validate → `ui:model-selector` opens → on select, stage `pending[newName] = modelLabel`. Save flushes it as a `role_set`, which auto-creates the role. There is no persisted "empty custom role" and therefore no `role_add` WS message. This keeps the protocol addition to exactly one message (`role_remove`, D3).

Consequence for the grid: today it renders `Object.keys(rolesMap)`. A pending-only custom name is not yet in `rolesMap`, so the grid MUST render the **union** `Object.keys(rolesMap) ∪ Object.keys(pending)` (deduped) so the in-flight custom pill shows with its dirty marker before Save. `computeDirtyRoles` already treats `pending[r] !== rolesMap[r]` (undefined) as dirty, so no change there.

### D2 — Built-in vs custom classification via payload, not a duplicated const
The client must know which names are built-in to (a) place them in the Built-in group and (b) suppress the **×** on them. Two options:

| Option | How | Verdict |
|---|---|---|
| A. Hardcode the 6 names client-side | copy `DEFAULT_ROLE_NAMES` into the plugin | ✗ brittle — silently drifts if defaults change |
| **B. Send `builtinRoleNames` in `roles_list`** | `roles:get-all` adds `builtinRoleNames: [...DEFAULT_ROLE_NAMES]`; bridge forwards it | ✓ single source of truth, future-proof |

**Chosen: B.** A role is "custom" iff its name ∉ `builtinRoleNames`. The field is additive; older clients ignore it (and simply render one flat group).

### D3 — `role_remove` is the one new message; immediate + confirmed
`roles:set` can only set values, not delete keys, so removing a custom role needs a new path. Add `role_remove { sessionId, role }` → bridge emits `roles:remove` → `removeRoleFromSchema` + save → re-emit `roles_list`.

Removal is **immediate and confirmed** (`window.confirm`), NOT staged through `pending`, mirroring the existing preset-delete UX (also immediate). Rationale: removal is a cross-preset purge — coupling it to the model-assignment Save buffer would make a destructive op silently pending and easy to trigger by accident. On remove, any `pending[role]` entry for that role is also dropped so a staged model pick can't resurrect a just-removed name.

Guard: `roles:remove` MUST reject a built-in name server-side (defense-in-depth) even though the UI never shows **×** on built-ins — the locked decision is "built-ins permanent".

### D4 — Validation is shared, enforced twice
`isValidRoleName(name, existingNames)` lives in `@blackbelt-technology/pi-dashboard-shared`. Rules:
- non-empty after trim;
- matches `^[A-Za-z0-9][A-Za-z0-9_-]*$` (starts alnum; letters/digits/`-`/`_`; **no** `/`, whitespace, `@`, `.`);
- not already in `existingNames` (built-in or custom, case-sensitive to match on-disk keys).

The client uses it for the inline ✓/✗ hint and to disable the confirm control; the bridge `roles:set`/`roles:remove` re-validates and rejects on failure. `/` is reserved because role values are `provider/id`; `@` is reserved because refs are `@role`.

### D5 — Preset-load-drops-custom is accepted, documented, not fixed here
`roles:preset-load` does `cfg.roles = { ...preset.roles }` (wholesale replace). A preset saved before a custom role existed will, on load, drop that role from the **active map**. But the name persists in `roleNames`, so `overlayRoles` keeps it visible as an empty slot — it degrades to "unconfigured", not "vanished". This matches the shipped `dashboard-roles-ownership` behavior ("Added role appears empty in all presets"). No change here; called out so it isn't mistaken for a regression.

## Open questions
- None blocking. (Considered and deferred to future changes: name-only placeholder roles, tier/parameterized role families, hiding built-ins.)

## Risks
- **Accidental purge.** Mitigated by `window.confirm` + `×`-on-custom-only + server-side built-in guard.
- **Client/bridge validation drift.** Mitigated by the single shared `isValidRoleName` helper (one implementation, imported by both).
- **Union-render bug.** Rendering `rolesMap ∪ pending` must dedupe and keep group placement stable; covered by unit tests on the render-set helper.
