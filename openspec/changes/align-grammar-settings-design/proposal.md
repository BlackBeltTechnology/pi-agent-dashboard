## Why

`GrammarSettings` diverges from the plugin-settings convention set by the newest
first-party plugins (`blackhole`, `hermes-memory`). It carries 23 inline
`style={{}}` blocks instead of theme-token Tailwind classes (`blackhole` has
zero; `hermes` all but one), renders its own Save/Reload buttons + "unsaved"
chip instead of joining the host's **unified Save Bar**
(`useSettingsDraftSource`), and lays every control out flat instead of grouping
them into `<details>` accordions. The result looks and behaves unlike
every other plugin settings section. This change aligns it and adds a small
inline recommended-models quick-reference by the model picker.

## What Changes

- **Restyle** `GrammarSettings.tsx` — replace every inline `style={{}}` with
  theme-token Tailwind classes (the `blackhole`/`hermes` idiom). Every
  interactive control keeps the shared `focus-ring`; adapts across all four
  `data-theme` values at WCAG-AA.
- **Join the host unified Save Bar** — adopt
  `useSettingsDraftSource({ id:"plugin:grammar", isDirty, commit, reset })`.
  `commit` still `POST`s `/api/config/plugins/grammar` then reloads (and now
  throws on `!res.ok` per the draft-source contract — today's `save()` has no
  `res.ok` check); `reset` re-loads. The plugin's own Save/Reload buttons and
  "unsaved" chip are removed — the host bar owns the change count + Save action
  (matching `blackhole`).
- **Group into accordions** — wrap the fields in `<details>`/`<summary>`
  sections (General · Model · Advanced), matching the pattern.
- **Recommended-models disclosure** — a collapsed-by-default `<details>` next to
  the model picker listing a short curated set (recommended `claude-haiku-4-5`;
  also `claude-sonnet-4-5`, `claude-opus-4-5`, `gemini-flash-latest`; note
  `gemini-flash-lite-latest` is too weak). Localized. The existing inline hint +
  link to `docs/grammar-model-guidance.md` stay.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `grammar-settings-plugin`: the settings controls persist through the host
  unified Save Bar (`useSettingsDraftSource`) rather than local Save/Reload;
  fields are grouped into collapsible accordions; the section carries no inline
  style literals; the model-guidance surface gains an inline recommended-models
  disclosure. The prior standalone "unsaved status marker" behavior is dropped
  (the host bar owns unsaved state).

## Impact

- **Modified:** `packages/grammar-plugin/src/GrammarSettings.tsx` (styling +
  save integration + accordions + disclosure), `src/i18n.ts` (accordion titles +
  recommended-model labels; drop the now-unused `save`/`reload`/`saving`/
  `unsaved` keys the host bar owns), `src/__tests__/GrammarSettings.test.tsx`
  (rework to the `useSettingsDraftSource` contract, per the RetrySettingsSection
  / RolesSettingsSection / SubagentsSettings tests — which actually mount the
  draft-source provider), the `GrammarSettings.tsx` module docblock (currently
  describes the pre-plugin `config.grammar`/PUT/local-Save reality), and the
  `GrammarSettings.tsx` + `GrammarSettings.test.tsx` + `i18n.ts` rows in
  `AGENTS.md`.
- **Behavior change:** users save grammar settings via the shared Save Bar, not
  the section's own buttons; the standalone "unsaved" chip is gone.
- **No persistence rewrite:** `commit` keeps the existing
  `POST /api/config/plugins/grammar` path; only the trigger moves.
- **Not touched:** the server backend, config schema, wire types, dialogs, and
  `docs/grammar-model-guidance.md` (still linked).

## Discipline Skills

- `doubt-driven-review` — removing the plugin's own Save/Reload + "unsaved" chip
  in favour of the host Save Bar is a user-facing behavior change crossing the
  plugin/host boundary; the decision is stress-tested before it stands.
- `review-code` — non-trivial single-component rewrite; inline review before
  commit.
