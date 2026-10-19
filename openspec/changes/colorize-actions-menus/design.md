## Context

See proposal.md for the motivation. The contracts are in `specs/session-actions-menu`, `specs/folder-actions-menu` and `specs/plugin-ui-primitive-registry`.

Current state (cited):

**Session menu**
- `SessionActionsPanel.tsx:311-345` (`MenuEntry`) renders every item in `--text-secondary`. The icon inherits it (`<Icon … className="shrink-0" />`).
- `ITEM_BASE` (`:27-28`) already sets `focus:bg-[var(--bg-hover)]`, and the neutral branch adds `hover:bg-[var(--bg-hover)]`.
- NEXT uses `bg-[var(--accent-soft)]` with `--text-primary` (`:331-332`).
- The lifecycle row (`:350-394`) shows letters only.
- Items come from `session-menu-items.ts`:
  - pushed inline for SESSION/GIT (`:427-510`);
  - OpenSpec actions mapped through `OPENSPEC_LABEL` / the action map (`:184-198`, `:249`, `:287`);
  - NEXT copied as `{ ...mergeItem | primary, emphasis }` (`:524-532`).
- There is no host Stop item.

**Folder menu**
- Rows render at `FolderActionsMenu.tsx:321-335`.
- The badge uses raw `text-amber-400` (`:332`).
- The same component renders a sheet form on narrow viewports (`:246`).
- Host items are built in `SessionList.tsx` (around `:1725-1920`). Add-to-workspace renders through the host-only `node` escape hatch.

**Plugin folder items**
- `FolderMenuContribution` (`dashboard-plugin-runtime/src/folder-menu-contributions.tsx:42-56`).
- Registration whitelists fields by destructuring (`:160-161`), so unknown keys such as `node` cannot smuggle markup at runtime. The hook re-reads fields (`:262-279`).
- **Layering:** the runtime sits *below* `client-utils` (`settings-fields.tsx:17`: "Must not import from `packages/client` or `client-utils`"). Its dependencies are `app-kit`, `shared`, `@mdi/*` and `ajv`. `client-utils` imports the runtime (`ActionList.tsx:11`).

**Plugin session items** (PLUGINS group)
- `ui:action-list` intents, rendered by `client-utils/src/ActionList.tsx`.
- Menu mode (`:46-66`): rows use `hover:bg-[var(--bg-tertiary)]` and the icon goes through `IconByKey` (`:107-111`), which accepts no `className`. The local `ExtendedActionItem` type (`:26-38`) mirrors the public `UiActionListItem` (`shared/src/dashboard-plugin/ui-primitives.ts:234-245`).
- `IntentNode.props` is `Record<string, unknown>` (`shared/src/dashboard-plugin/intent-types.ts:26-34`), so `tone` needs no wire change.
- `client-utils` publishes subpath exports only (`package.json` `exports`), with no barrel.

**Accent roles** (`lib/theme/themes.ts:86-100`)
- `--accent-<hue>` is the FILL role, with no contrast guarantee.
- `--accent-<hue>-text` is the TEXT role, derived to reach 4.5:1 on the app surfaces. "New coloured text MUST use `-text`", which `scripts/theme-token-guard.mjs` (arm `accentText`) ratchets.
- Measured on `--bg-secondary`, the surface of both menus, across all 18 palette/mode pairs:

  | Token | Minimum | Palette |
  |---|---|---|
  | `--accent-{green,blue,orange,red}-text` | ≥ 5.64:1 | dracula light |
  | `--tint-*-fg` | 3.38:1 | tokyo-night light |
  | `--tint-blue-fg` on `--tint-blue-bg` | 2.71:1 | tokyo-night light |
  | `--text-primary` on `--tint-blue-bg` | 3.23:1 | tokyo-night light |
  | `--accent-red-text` on `--tint-red-bg` | 4.57:1 | catppuccin light |
  | `--text-secondary` on `--tint-red-bg` | 5.37:1 | gruvbox light |
  | `--accent-green-text` / `--accent-yellow-text` | ≥ 5.64:1 | |
  | `--text-tertiary` | ≥ 5.72:1 | |
  | fill `--status-idle` / `--status-working` | 2.18:1 / 1.84:1 | base light |

**Card lifecycle bar:** `components/openspec/OpenSpecStepper.tsx:68-71,133,150` uses `statusPresentation` fill tokens and renders a glyph only for done (`✓`) and skipped (`–`). `SegmentState` is `done | current | todo | skipped` (`OpenSpecStepper.tsx:20`).

**Project setup pending flag:** `status?.setupOutdated === true`, inline in `projectSetupLabel` (`components/folder/folder-menu-labels.ts:24`), not exported.

**Existing danger vocabulary:** `UiDialogIntent = "primary" | "danger" | "neutral"` (`ui-primitives.ts:167`) styles dialog *buttons*.

**`data-tone`** is already used with a different value set (`success|warning|error|info|neutral`) by plugin pills (e.g. `goal-plugin` settings tests).

**In-flight overlap:** `align-ui-contract-recipes` modifies the `session-actions-menu` spec and `SessionActionsPanel.tsx` `MenuEntry`. That covers host labels in primary text, disabled reason on its own line, and 4.5:1 for enabled menu text in base dark, base light and nord dark.

## Goals / Non-Goals

**Goals:**
- One tone vocabulary, one validation guard and one tone → class mapping, shared by all three renderers (session `MenuEntry`, folder row, `ActionList`).
- A purely additive public API. Existing plugins keep compiling and rendering identically.
- Every new coloured pixel passes its WCAG floor in every palette and mode.

**Non-Goals:**
- No new colour tokens and no palette edits.
- No colour on labels.
- No tone for React claim output, card inline controls, or the mobile kebab.
- No tone on `menuitemradio`.
- No change to the card's lifecycle bar. Its fill tokens fall below 3:1 in base light, a pre-existing gap to be filed as a follow-up.

## Decisions

### D1: Semantic tone names, not colour names
`UiTone = "go" | "create" | "caution" | "danger"`. Plugins declare *intent*, and the host owns the palette.
- *Alternative:* colour names. Rejected: they couple the API to today's palette.
- *Alternative:* a free `className` or colour string. Rejected: it reopens the arbitrary-styling hole the whitelist closes (`folder-menu-contributions.tsx:150-160`).
- *Alternative:* reuse `UiDialogIntent`. Rejected: it describes button emphasis (primary / neutral), not action semantics, and it has no go, create or caution. `danger` means the same thing in both, which is intentional.

### D2: Vocabulary and guard in `shared`, classes in `client-utils`
- **`shared/src/dashboard-plugin/ui-primitives.ts`:** `UI_TONES` (readonly tuple), `UiTone`, and `isUiTone(v: unknown): v is UiTone`. `shared` is the one package every layer, the runtime included, may import, which avoids the runtime → client-utils cycle.
- **`client-utils/src/tone.ts`** (new subpath export `./tone`):
  - `toneIconClass(tone: unknown, { disabled })` returns `text-[var(--accent-<hue>-text)]` or `""`.
  - `toneRowClass(tone: unknown, { disabled })` returns, for an enabled `danger`, `hover:bg-[var(--tint-red-bg)] focus:bg-[var(--tint-red-bg)] hover:text-[var(--accent-red-text)] focus:text-[var(--accent-red-text)]`, otherwise `""`. Pinning the label to `--accent-red-text` (≥ 4.57:1 on `--tint-red-bg`) makes overlay contrast independent of the neutral label colour, which `align-ui-contract-recipes` moves to `--text-primary`. That token measures only 3.13:1 on `--tint-red-bg` on tokyo-night light.
  - Both are **total and prototype-safe**: `isUiTone(tone) ? MAP[tone] : ""`. `isUiTone` is a strict membership test (`UI_TONES.includes`), so `constructor`, `__proto__` and non-strings fall through to `""`. The maps hold complete class literals, and a tone is never interpolated, so Tailwind sees every class and an untrusted value cannot inject one.
  - `toneAttr(tone)` returns the validated tone or `undefined`, for `data-action-tone`.
- Tailwind scans `client-utils/src` (`index.css:16`), so the literals are generated.
- **Row interaction classes come from a three-way branch**, never appended:
  - `enabledDanger ? toneRowClass(…)`;
  - `: enabled ? NEUTRAL_INTERACTION` (today's `hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus:bg-[var(--bg-hover)]`);
  - `: INERT` (today's muted, no-hover classes plus `focus:bg-[var(--bg-hover)]`, so keyboard focus stays visible).

  Disabled rows never get hover styling. `focus:bg` leaves `ITEM_BASE` and is re-added by every non-danger branch, including the enabled NEXT branch and the `More…` row (`SessionActionsPanel.tsx:300`), which uses `ITEM_BASE` outside `MenuEntry`.

### D3: Text-role tokens for every coloured glyph
Icons, NEXT, lifecycle bars and letters, and the badge all use `--accent-<hue>-text`, never the fill role or `--tint-*-fg`.
- `-text` is the only accent family with a guaranteed floor (≥ 5.64:1 measured on the menu surface), and using it for glyph colour satisfies the `accentText` guard.
- *Alternative:* `--tint-*-fg`, as in the mockup. Rejected: 3.38:1 is only marginal, and it is unguarded.

### D4: `data-action-tone` hook
- Every item with a valid tone, enabled or disabled, renders `data-action-tone="<tone>"`. Neutral and invalid items do not.
- It is named `data-action-tone` to avoid colliding with the existing pill `data-tone` vocabulary.
- Tests assert the attribute plus the computed colour, never class strings.

### D5: Runtime forwarding keeps the whitelist
In `folder-menu-contributions.tsx`, `tone` is threaded through every place a field is named:
- the `FolderMenuContribution` type (`:42-56`);
- the registration whitelist destructure (`:160-161`), which stores `isUiTone(tone) ? tone : undefined`, importing the guard from `shared`;
- the `useFolderMenuItem` destructure and effect dependency list (`:262-279`), so a live tone change re-registers while the menu is open.

`isValidFolderMenuContribution` gets a comment: `tone` is optional and presentational, an invalid value is neutralised, and the item is never rejected. Validation happens at the boundary, so renderers only ever see a valid tone or `undefined`.

### D6: Where host tones are assigned
- **Session, SESSION/GIT:** inline at each `items.push`.
- **Session, OPENSPEC:** an `OPENSPEC_TONE: Partial<Record<OpenSpecActionKey, UiTone>>` map next to `OPENSPEC_ICON` (declared at `session-menu-items.ts:192`, applied at `:249`), giving Verify → go, New change / Propose → create, Archive anyway → caution.
- **NEXT precedence:** the deriver strips tone when it builds the NEXT copy: `{ ...item, tone: undefined, emphasis: !item.disabled }` (`session-menu-items.ts:524-532`). A NEXT item therefore never carries a tone, even while disabled (streaming). `MenuEntry` renders `emphasis` with the NEXT style (D7). The home-group copy of the OpenSpec primary keeps its tone.
- **Danger principle:** `danger` marks actions that end a process or discard work: Exit pi session (ends the pi process), Close worktree (removes the checkout), Disable team. State changes that discard nothing stay neutral: Archive session, Push, Detach, and Remove from workspace (preference-only, `server/src/browser-handlers/directory-handler.ts:373-385`).
- **Folder:** inline in `SessionList.tsx` builders. Project setup's predicate (`setupOutdated === true`) is extracted from `projectSetupLabel` into an exported `isProjectSetupOutdated(status)` in `folder-menu-labels.ts`, and both the label and the tone use it. The `node` item ignores tone.
- **Plugins:** goal, automation and team add a static `tone: "…" as const`; object literals in `useMemo` widen otherwise, as `group: "create" as const` already shows. kb computes `tone` from `kind`, caution for `index`, `reindex` and `retry` and otherwise none, and adds it to the memo dependencies (`FolderKbSection.tsx:293-306`).

### D7: NEXT outlined, not filled
When enabled, NEXT gets `border border-[var(--tint-blue-border)] font-semibold text-[var(--text-primary)]` plus `NEUTRAL_INTERACTION`, an `--accent-blue-text` icon, and the menu surface. The border measures 1.5–3:1 and is decorative: NEXT is identified by its `NEXT` heading, semibold label and blue icon.
- *Alternative:* the mockup's `--tint-blue-bg` fill. Rejected: label contrast is 3.23:1 on tokyo-night light.
- *Alternative:* keep `--accent-soft`. Rejected: its label contrast is unmeasured, and the outline is unambiguous.

### D8: Lifecycle row
Each segment gets a state bar, a glyph and its letter, in one text-role colour: done `✓` and skipped `–` in `--accent-green-text`, current `▸` in `--accent-yellow-text`, todo `○` in `--text-tertiary`.
- Every state has a distinct glyph, so no two states differ by colour alone. That fixes the WCAG 1.4.1 gap the card still has for current/todo; the card is out of scope here.
- The glyph set matches `statusPresentation`'s `✓ ▸ ○`, plus the stepper's `–`.
- The accessible name stays `<label>, <state>`.
- The hues match the card's states. Only the token role differs, chosen for contrast. `statusPresentation`'s fill tokens are deliberately **not** reused: they measure 1.84–2.18:1 in base light.

### D9: `ActionList` honours tone
- `ExtendedActionItem` becomes `UiActionListItem & { dataAction?: …; … }` instead of a hand mirror, so new shared fields such as `tone` flow through without drift.
- `ActionList` passes the raw `tone` only through the total helpers (D2) and `toneAttr`, never directly to the DOM.
- Tone applies wherever the primitive renders, inline or in a menu. Today `ui:action-list` ships only into the session menu (`flows-plugin/src/server/render-actions.ts:85`, rendered through `SessionCard.tsx:1712`). The "card inline controls" non-goal covers host-rendered card controls only.
- `IconByKey` gains an optional `className`, spread only when non-empty, so untoned output gains no `class=""`.
- Both modes apply `toneIconClass` and `data-action-tone`.
- Menu-mode rows use `enabledDanger ? toneRowClass : "hover:bg-[var(--bg-tertiary)]"`, where disabled rows keep their existing `aria-disabled:` styling.
- Output for untoned items stays byte-identical.

### D10: Contrast guard test
A unit test walks base dark/light from `index.css` plus every `themes.ts` palette × mode. It resolves `color-mix` itself and asserts:
- each `--accent-<hue>-text` ≥ 3:1 on `--bg-secondary`;
- `--accent-red-text` ≥ 3:1 on `--tint-red-bg`;
- `--accent-red-text` ≥ 4.5:1 on `--tint-red-bg` (danger hover/focus label);
- `--accent-orange-text` ≥ 4.5:1 on `--bg-secondary` (badge text);
- `--accent-green-text`, `--accent-yellow-text` and `--text-tertiary` ≥ 3:1 on `--bg-secondary`.

A synthetic failing fixture proves the assertions can fail. Exemplar: `lib/__tests__/theme-body-text-contrast.test.ts`, which already resolves the palette tokens in-process. An L3 computed-style check backs it against the browser's actual `color-mix` resolution. It runs on base dark, base light, and the two lowest-margin palettes, tokyo-night light (icons) and catppuccin light (danger overlay).

### D11: Coordination with `align-ui-contract-recipes`
Overlapping lines: `SessionActionsPanel.tsx` `ITEM_BASE` (`:27-28`), the `MenuEntry` class builder and reason span (`:330-345`), and the `More…` row (`:300`), which both touch: align-ui for sizing, this change for `focus:bg`. Both add requirements to the `session-actions-menu` spec, on different subjects.
- **Contrast:** independent of order, because the danger overlay pins its own label colour (D2) and every other new colour is measured against the menu surface.
- **Merge rule** for whichever lands second:
  - `ITEM_BASE` = align-ui's sizing, minus `focus:bg`;
  - each branch = align-ui's label and disabled classes plus this change's three-way interaction split and icon colour;
  - the disabled reason = align-ui's block layout with `aria-describedby`, replacing the trailing `ml-auto text-[10px]` span;
  - the NEXT branch = this change's outline plus align-ui's sizing;
  - lifecycle segment letters keep this change's state colours. They are status glyphs, not item labels, so align-ui's "item labels use the primary text colour" rule does not apply to them.
- **Order:** whichever archives second rebases its spec copy onto the other's archived text.

## Risks / Trade-offs

- **[Risk] A published API field is hard to rename.** → Semantic names (D1), an optional field, a closed union, and one guard in `shared`. `doubt-driven-review` target.
- **[Risk] An untyped intent payload carries a hostile `tone`.** → The value is only a map key (D2), and anything that fails `isUiTone` renders neutral. It can never reach a class string or the DOM, except as `data-action-tone` after validation. `security-hardening` checkpoint.
- **[Risk] An older host receives a newer plugin's `tone`.** → Old `ActionList` ignores unknown props, and the old runtime whitelist drops it. Both degrade to neutral.
- **[Risk] Colour overload.** → Colour is icon-only and about 4 of 15 typical items are toned. Only `danger` changes a row background, and only on hover or focus. There is a manual visual review.
- **[Trade-off] Disabled toned items lose their colour.** → Intended.
- **[Trade-off] The menu lifecycle bar uses text-role tokens while the card's uses fill tokens.** → Same hues, slightly different lightness in light palettes. The card's light-mode bar contrast is a pre-existing gap and is out of scope.

## Migration Plan

Additive.
- **Implementation order:** `shared` (vocabulary and guard) → `client-utils` (`tone.ts`, `ActionList`) → `dashboard-plugin-runtime` (forwarding) → `client` (renderers, host tones) → first-party plugins.
- **CHANGELOG:** one entry in the root CHANGELOG under `## [Unreleased]` → "Added", naming the two optional plugin API fields. Package versions bump at release cut (`release-cut` skill). There are no per-package CHANGELOGs.
- **Rollback:** revert as one commit, including the plugin tone fields.
