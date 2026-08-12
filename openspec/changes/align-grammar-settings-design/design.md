# Design — align-grammar-settings-design

## Context

`GrammarSettings` is a `settings-section` slot component. It predates the
`useSettingsDraftSource` convention and was styled with ad-hoc inline styles. The
newest first-party plugins (`blackhole`, `hermes-memory`) establish the current
idiom: theme-token Tailwind classes, `<details>` accordion groups, and the host
**unified Save Bar** via `useSettingsDraftSource`. This change converges
`GrammarSettings` onto that idiom and adds an inline recommended-models
disclosure. No server, schema, or wire change.

## Decisions

### D1 — Adopt `useSettingsDraftSource`, keep the plugin's own persistence

`useSettingsDraftSource({ id, isDirty, commit, reset })` registers the section
with the host Save Bar; the plugin still owns `commit` (its existing
`POST /api/config/plugins/grammar` + reload) and `reset` (reload). Persistence
is unchanged — only the *trigger* moves from the section's own button to the
shared bar.

**`commit` MUST reject on failure.** The runtime contract is
`commit: () => Promise<void>` that MUST reject on a failed write so the host
keeps the source dirty + retryable; `SettingsPanel` reports "saved" only for
fulfilled commits. Today's `save()` does `await fetch(...)` with NO `res.ok`
check, so joining the bar as-is would falsely report success and clear dirty on
a 4xx/5xx. `commit` must throw on `!res.ok` (mirroring `blackhole-api.ts`
`putConfig`).

- **Consequence:** the section no longer renders `grammar-save`/`grammar-reload`
  buttons or a `grammar-dirty` chip. Tests that clicked those must drive the
  draft-source contract instead (assert `isDirty` flips on edit, `commit` POSTs
  the plugin endpoint + rejects on `!res.ok`, `reset` reloads). Exemplars that
  actually mount the draft-source provider + registry harness:
  `packages/client/src/components/__tests__/RetrySettingsSection.test.tsx`,
  `packages/roles-plugin/src/__tests__/RolesSettingsSection.test.tsx`,
  `packages/subagents-plugin/src/client/__tests__/SubagentsSettings.test.tsx`.
  (`BlackholeSettings.test.tsx` unit-tests `buildPayload` directly and is NOT a
  draft-source harness.) `dashboard-plugin-runtime/test-support` exports only
  `withUiPrimitiveProvider`, so the test's `wrap()` must add the draft-source
  provider explicitly (see those exemplars).

### D2 — The standalone "unsaved" marker is dropped, not restyled

The prior spec required a section-local "unsaved" marker in
`--severity-warning-fg`. With the host Save Bar owning unsaved state, that marker
is removed. In the spec this is an intentional scenario removal, so the
theme-token requirement is expressed as REMOVED + ADDED under a new name
(renamed to avoid the archiver's silent-scenario-drop guard and the validator's
ADDED/REMOVED same-name rule — the lesson from `grammar-llm-only-with-explore`).

### D3 — Accordion grouping via native `<details>`/`<summary>`

Match `blackhole`/`hermes`: native `<details>` (no new dependency), theme-token
classes, a rotate-on-open caret guarded by `motion-reduce`. Groups: **General**
(enabled, auto-check, correction view, capitalize), **Model** (picker + hint +
link + recommended-models disclosure + required prompt), **Advanced**
(debounce, min/max chars, language). Grouping is presentation-only; every
SURVIVING control keeps its existing `data-testid`.

Two caveats the cited idiom does NOT cover:
- **Focus on `<summary>`.** blackhole/hermes `<summary>` elements carry no focus
  affordance; the a11y requirement here needs each `<summary>` (and the new
  recommended-models one) to show a visible focus indicator, so add `focus-ring`
  explicitly rather than copying the idiom verbatim.
- **`<details>` is flow content, not valid inside a `<label>`.** The current
  Model group wraps picker + hint + link + prompt in one `<label>`; the
  recommended-models `<details>` MUST be a sibling of (not inside) that label,
  which means restructuring the Model group so the label wraps only its control.

### D4 — Recommended-models disclosure = static curated list, not the full table

A collapsed `<details>` by the picker lists a SHORT curated set
(`claude-haiku-4-5` recommended + `claude-sonnet-4-5`, `claude-opus-4-5`,
`gemini-flash-latest`, with a "avoid `gemini-flash-lite-latest`" note). The data
is a small static array in the component with localized labels — not fetched,
not the full benchmark table (which stays in `docs/grammar-model-guidance.md`,
still linked). Keeps the surface light and the doc the single source of the full
tradeoff table.

### D5 — The "no inline style" invariant is scoped to plugin-owned elements

The restyle drops the plugin's own inline styles, but the section renders the
host `ui:model-selector` primitive, whose dropdown carries its own inline
`style` (`ModelSelector.tsx`) and is not portaled. The plugin cannot control
that subtree, so the "no inline `style` attribute" scenario (and any DOM scan
asserting it) is scoped to elements the plugin owns — excluding the
`[data-testid="grammar-llm-model-selector"]` descendants.

- **Rejected:** rendering the whole benchmark table inline — duplicates the doc
  and bloats the section.

## Risks / Trade-offs

- **Host Save Bar only renders in the host `SettingsPanel`.** In the isolated
  component test the bar is absent by design; tests assert the
  `useSettingsDraftSource` registration + `commit`/`reset`/`isDirty` contract
  directly (as `blackhole` does), not a rendered Save button.
- **Behavior change for users.** Saving moves to the shared bar. Acceptable —
  it is the whole point (consistency), and every other plugin already behaves
  this way.
- **i18n key churn.** `save`/`reload`/`saving`/`unsaved` become unused; removing
  them keeps the catalog honest (the "all strings localized" requirement still
  holds for the remaining surface).

## Migration

None — pure UI/interaction change. Existing persisted `plugins.grammar` config
is read and written by the same endpoint.

## Open questions

_None — scope locked during exploration (full alignment; short recommended-models
disclosure + keep the doc link; single change)._
