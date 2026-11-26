# Proposal: card-sections-global-pointer

## Why

Session-card section visibility has two scopes, and users confuse them:

- per-folder overrides: Directory Settings › Session cards (`CardSectionsPage`)
- global defaults: Settings › General › Session card sections (`CardSectionsSection`)

Three things cause the confusion:

- The folder page says "everything else follows global defaults", and each row offers
  `Default (Show)`. It never says where those defaults live, and nothing on it leads to
  them. Its only Settings link is the context-bar `Open display settings`, which opens
  the top of General, not the defaults block.
- The session actions menu has two near-identical VIEW items, `Card sections…` and
  `Card section defaults…`, and their scope is unclear from the names.
- `Card section defaults…` opens `/settings/general` at the top of a long page, not at
  the block.

The live mock (`mockups/2026-11-23-card-sections-global-pointer/`) was reviewed and
accepted. It has three frames: the folder page, the VIEW group, and a click-through.

## What Changes

Mockup: mockups/2026-11-23-card-sections-global-pointer (in this change)

- **Folder page points to global.** The override summary strip says unset sections
  follow the global defaults. It gains an `Edit global defaults →` control next to
  `Reset to global`. That control navigates to Settings › General, scrolls the
  `Session card sections` block into view, and pushes history, so browser Back returns
  to the folder page.
- **`Default (…)` → `Global (…)`.** The per-row inherit option names its source and
  matches the existing `Reset to global` wording. This covers labels and i18n
  (en/hu/zh-CN).
- **One VIEW menu item.** Remove `Card section defaults…` (`card-defaults`,
  `openCardDefaults`) from the session actions menu. `Card sections…` becomes the single
  entry, and the global defaults are reached through the folder page.
- **Settings deep-link.** Today Settings has no way to open at a given section from an
  external URL; scroll targets exist only inside `SettingsPanel`
  (`requestRailNavigate`), and the `settings-panel` spec forbids route-encoded targets.
  Add a one-shot `?scroll=<testid>` parameter on `/settings/:page` for navigation from
  outside the panel. It is consumed after settings load, then removed with a replace.
  The new control uses it.
- **Out of scope:** the folder page's `Open display settings` link (context usage bar)
  still opens General at the top. Its target is a different block; a follow-up can
  reuse the parameter.

## Capabilities

### Modified Capabilities
- `session-card-section-visibility`: the Directory Settings "Session cards" page gets
  the global pointer and the `Global (…)` label. The "Inline legend menu" requirement
  now routes global defaults through the folder page.
- `session-actions-menu`: the VIEW group holds exactly one item, `Card sections…`.
- `settings-panel`: "Page navigation accepts an optional section scroll target" also
  accepts a one-shot external `?scroll=` parameter; the internal helper stays route-free.

## Impact

- Client:
  - `components/DirectorySettings/CardSectionsPage.tsx`
  - `components/settings/SettingsPanel.tsx` (deep-link scroll)
  - `components/settings/CardSectionsSection.tsx` (scroll offset only; the
    `card-sections-settings` testid already exists)
  - `lib/session/session-menu-items.ts`
  - `components/session/SessionCard.tsx`
  - `lib/i18n/i18n-hu.ts`, `lib/i18n/i18n-zh-CN.ts`
- Tests:
  - `components/__tests__/CardSectionsPage.test.tsx`
  - `components/__tests__/SessionCard.card-sections.test.tsx`
  - `lib/session/__tests__/session-menu-items.test.ts`
  - a `SettingsPanel` scroll-param test, including a hostile value (`"]`, over-long) that
    must not throw
  - a Playwright spec for the folder → Settings → Back click-through
- Docs: `docs/session-actions-menu.md` (VIEW group; DocScribe). Update the `AGENTS.md`
  rows for `components/settings/` (`SettingsPanel.tsx`), `components/DirectorySettings/`
  (`CardSectionsPage.tsx`), `lib/session/` (`session-menu-items.ts`) and
  `components/session/` (`SessionCard.tsx`). Archived changes are not edited.
- No server, protocol or persistence change. Stored preferences are untouched.

## Discipline Skills

- `review-code`: before commit, since the change touches 3+ client modules and a
  user-facing menu.
- `security-hardening`: the `?scroll=` value is untrusted URL input fed to a DOM
  selector (D4: allowlist pattern + `CSS.escape` + `try`/`catch`).
- `doubt-driven-review`: `?scroll=` is a new external URL surface. It ran during
  planning (plan-proposal).
- No performance or observability signals: client-only UI, no new endpoint, no data
  migration.
