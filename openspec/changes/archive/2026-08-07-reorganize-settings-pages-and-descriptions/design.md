## Context

An audit of every field call site in `SettingsPanel.tsx` found **8 of 52** shared-component fields carry a description (**15%**). The cause is mechanical: a description is a hand-rolled sibling `<p>` at the call site, so `ToggleField` / `SelectField` / `NumberField` / `TextField` (`:2272–2406`) have no notion descriptions exist. Filling the gaps without changing the mechanism resets a counter that will drift back down.

A second defect sits underneath: **none of the four components associate their `<label>` with their control** — no `htmlFor`, no `id`. The only `htmlFor` in the file is the listen-interface radio group (`:2224`). So the controls have neither an accessible name nor an accessible description today.

Constraints discovered while designing (all verified against source):

- `CONFIG_FIELD_PAGE` (`:161`, *not* `PAGE_OF_KEY`) maps **top-level** config keys to pages. `dirtyPages` (`:546–556`) iterates `Object.keys(configPartial)` and looks up that map — there is **no nested-key attribution**.
- `computeConfigPartial` (`:214–224`) emits `partial.tunnel = { enabled?, watchdog? }` as **one** key.
- The leave guard is panel-global `isDirty` plus a plugin-page rail guard (`:651–662`). `CONFIG_FIELD_PAGE` drives **chips and dots only** — not the guard.
- `spawnRegisterTimeoutMs` (`:1216`) is a hand-rolled `<input>` whose bounds check blocks the write *and* disables the Save button (`:1615`). Shared `NumberField` (`:2281`) is `parseInt(…) || 0` with no bounds.
- `debugTools` has **two** live controls: `DisplayPrefsSection`'s buffered toggle (`:1865`) and `DebugToolsToggle`'s `@deprecated` instant-apply toggle (`:1720`).
- The four components are **module-local** (only `SettingsPanel`, `addTrustedEntry`, `removeTrustedEntry`, `shouldShowLegacyHint`, `LlmProviderCard` are exported), so sibling sections cannot use them.
- 12 bespoke `<input>`/`<select>`/`<textarea>` live in the same file alongside the 52 component call sites.

## Goals / Non-Goals

**Goals:**
- Make an undescribed setting **impossible to add silently** in the four shared components.
- Give those controls an accessible **name** (label association) and **description** (`aria-describedby`) — the a11y fix the description work makes cheap.
- Regroup General / Server / Sessions / OpenSpec by concern, with gated controls visibly nested.
- Remove the duplicate `debugTools` control.
- Move `dashboardName` to General without breaking its Save Bar chip.

**Non-Goals:**
- No config-schema change, key rename, or behavior change.
- **The `tunnel.watchdog.*` page move is dropped** — see D2.
- The 12 bespoke controls do not gain the props (D3).
- Sibling first-party sections (`RetrySettingsSection`, `ModelProxySection`, `ToolsSection`, `DiagnosticsSection`) are out of scope — they have their own field components.
- Plugin sections render through the `settings-section` slot; unreachable.
- Toggle hit area unchanged.

## Decisions

### D1 — `hint` is a **required** prop; the compiler is the gate

Making `hint: React.ReactNode` required is stronger and cheaper than an optional prop plus a source-scanning test:

- `tsc` names every site. No AST walk, no regex over multiline JSX.
- An intentional omission becomes an explicit, greppable `hint={null}` in the diff — a decision the author had to make and a reviewer can see. No separate allowlist file to drift.
- Zero runtime cost.

*Alternatives:* optional prop + a source-scanning vitest test (modelled on `themes.test.ts`, which reads `index.css`) — brittle exactly where JSX is multiline, and the allowlist lives away from the code it exempts. A Biome custom rule — `biome.json` has no plugin setup; disproportionate for one rule. A runtime "every control has `aria-describedby`" test — kept as a *secondary* check (D4), not the gate: it fails at test time rather than compile time.

*Scope honesty:* the gate covers the **52 shared-component sites only**. The 12 bespoke controls and the sibling sections are outside it. The spec requirement is scoped to match — claiming "every settings field" would be false.

*Trade-off:* a required prop cannot land incrementally. Accepted; `tsc` enumerates the work exhaustively.

### D2 — the `tunnel.watchdog.*` move is **dropped**, not deferred to implementation

Originally planned as "move watchdog to the Gateway page, drop it if that page doesn't participate in the save contract." The evidence resolves it — drop it now:

- `partial.tunnel` is one top-level key, and `dirtyPages` attributes per top-level key. A watchdog edit lights the **Server** chip regardless of where the JSX renders. `CONFIG_FIELD_PAGE` cannot split one key across two pages.
- Making it work requires a different PUT payload shape → violates C1 (no schema change).
- `GatewayPage` self-manages `GET`/`PUT /api/config` with its own dirty state and Save button; it does not register a draft source. Hosting Save-Bar-driven fields there would put two save paradigms on one page.

Leaving the "Gateway" section on the Server page is a real wart, but fixing it is a save-contract change, not a presentation change. Filed as a follow-up.

### D3 — bespoke controls get label/unit cleanup only, never a conversion

`spawnRegisterTimeoutMs` is the canonical trap: its `isNaN(v) || v < 5000 || v > 120000` check **blocks the write** and **disables Save** (`:1219`, `:1615`). Converting it to the shared `NumberField` would turn an *enforced* bound into *advisory* hint text — a behavior change (violates C7) hiding inside a copy refactor.

Rule: a bespoke control may have its label text and unit cleaned up in place. It may not be swapped for a shared component in this change. If a shared field ever needs validation, that is its own change with its own spec.

### D4 — label association + `aria-describedby`, proven by a runtime test

Each component generates ids with `useId()`, sets `htmlFor`/`id` to associate label and control, and sets `aria-describedby` to the hint element when `hint` is non-null. A test renders one instance of each component and asserts both the accessible name (from the label, including the unit chip) and the accessible description (from the hint).

Without the association half, the `unit`-in-label decision (D5) delivers nothing to assistive tech — the chip would be decorative pixels.

### D5 — `unit` renders **inside** the `<label>`

`unit` belongs to the accessible **name** ("Session register timeout, ms"), not the description; ranges and defaults belong in the hint. Labels lose their parentheticals: `Poll Interval (seconds, 5–3600)` → label `Poll interval` + `unit="s"` + hint carrying `Range 5–3600`.

**This is not English-only.** The zh-CN and hu dictionaries embed units in the *translated* strings (`settings.probeInterval`, `settings.pollIntervalSeconds53600`, `settings.jitterSeconds060`, `session.maxConcurrentSessions116`, `session.askUserPromptTimeoutSeconds`). Stripping the unit from the English fallback alone leaves those locales rendering the unit twice — once in the label, once in the chip. Every unit-bearing key must be updated in **all** dictionaries, or a new key introduced and the old one retired.

### D6 — the two wrapper toggles thread `hint` through

`WorktreeAutoInitToggle` (`:1735`) and `AutoNameSessionsToggle` (`:1767`) render `ToggleField` internally while their descriptions sit as siblings at the **outer** call site (`:1268`, `:1276`). A mechanical `hint={null}` pass would satisfy the compiler and orphan the description outside the component. Each wrapper takes a `hint` prop and forwards it. This is a real refactor, not a mechanical edit — task it separately.

### D7 — the `debugTools` work is a **duplicate deletion**, not a section merge

`DisplayPrefsSection` already owns `debugTools` through the buffered `display-prefs` draft source. `DebugToolsToggle` is a second control on the same field via the `@deprecated` `useDebugToolsVisible` hook, PATCHing immediately outside the Save Bar. The two desync until reload.

So: delete `DebugToolsToggle` and the Developer "Chat Display" section that hosts it. `useDebugToolsVisible` itself stays — `DEBUG_TOOL_NAMES` has other readers.

**User-visible consequence:** anyone who used the Developer toggle gets save-bar-buffered persistence instead of instant-apply. That is the intended unification, but it is a behavior change to *how* the preference is committed and must be stated, not smuggled.

### D8 — `DisplayPrefsSection` splits visually, stays one draft source

Three sections registering three draft sources would triple the dirty-chip noise for one preference blob. The single `useSettingsDraftSource({ id: "display-prefs", page: "general" })` registration is preserved.

### D9 — nesting a gated control is presentational only

`shutdownIdleSeconds` under `autoShutdown`, the reasoning pair, the OpenSpec knobs. The existing `disabled` prop already encodes the dependency; the indent makes it visible. **No change to the disabled logic.** Note the hint inherits the root's `opacity-50` when disabled, where today's sibling `<p>` stays full opacity — accept the dimming (it correctly signals the control is inert).

### D10 — the `+Session` prefix survives where it names the button

`+Session Strategy` / `+Session register timeout` reference the dashboard's `+Session` spawn button. Keep the prefix where the label genuinely means "for the +Session button"; drop it where it is noise. Not a gated-control marker.

## Risks / Trade-offs

- **[Required `hint` forces one large mechanical commit]** → `tsc` enumerates every site; split the commit per page if review drags.
- **[Step-order regression]** → landing "add `hint={null}` everywhere" alone leaves the 8 existing hints rendered in their old location with a null hint. Mitigation: for those 8 sites, add the prop and delete the sibling `<p>` in the **same** commit; only the 44 undescribed sites get a transient `null`.
- **[Deleting the instant-apply toggle changes persistence timing]** → covered by an explicit test and called out in the change summary (D7).
- **[Unit stripping breaks zh-CN/hu]** → every unit-bearing key updated across all dictionaries (D5), with a test asserting no locale renders a doubled unit for those keys.
- **[Existing tests use DOM proximity]** → `SettingsPanel.test.tsx:577–580` does `getByText(…).closest("div")` then `within(row).getByRole("button")`; the indent wrapper changes which `div` resolves. Re-run and repair, do not assume green. Page-attribution assertions (`:236–242`) must be re-checked for `dashboardName`.
- **[Root restructure]** → the field roots are `flex items-center justify-between`; rendering a hint below requires wrapping. Touches all four components' markup.
- **[Copy quality is load-bearing]** → a required prop guarantees a hint *exists*, not that it *helps*. `hint={null}` is the honest answer when there is nothing to add.
- **[C5 is aspirational, not the status quo]** → `ToggleField` uses `bg-blue-600` / `bg-white`, the save bar uses raw Tailwind. New markup uses tokens; existing raw-Tailwind neighbors are not in scope. State the exception rather than claiming the panel is token-pure.
- **[Regrouping moves familiar controls]** → accepted; the alternative is preserving a defect.

## Migration Plan

1. Field components gain `htmlFor`/`id` association, `hint` (required), `unit`; the 8 described sites migrate their `<p>` in the same commit; the 44 others get `hint={null}`.
2. Thread `hint` through the two wrapper toggles.
3. Replace the 44 `null`s with real copy; update unit-bearing i18n keys in all dictionaries.
4. Structural moves (sections, nesting, `dashboardName` relocation, `DebugToolsToggle` deletion) last, so the prop migration stays separable in review.

Rollback: each step is an independent commit; 3–4 revert without touching the field contract.

## Open Questions

None blocking. The two that existed are resolved: `GatewayPage` does **not** participate in the unified save contract (→ D2, move dropped), and `hint` is `ReactNode` because the existing descriptions embed `<code>`/`<strong>` and dynamic values (e.g. the git-source readout at `:1276`).
