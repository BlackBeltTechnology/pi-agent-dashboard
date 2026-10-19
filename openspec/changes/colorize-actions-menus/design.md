## Context

See proposal.md for the motivation. The contracts are in `specs/session-actions-menu`, `specs/folder-actions-menu` and `specs/plugin-ui-primitive-registry`.

Current state (cited):
- **Session menu.** `SessionActionsPanel.tsx:311-345` (`MenuEntry`) renders every item with one text colour (`--text-secondary`). The icon inherits that colour: `<Icon … className="shrink-0" />`.
  - NEXT uses `bg-[var(--accent-soft)]` with `--text-primary` (`:331-332`).
  - The lifecycle row (`:350-394`) shows letters only: done = `--tint-green-fg` text, current = `--accent-blue` border.
  - The item model is `SessionMenuItem` (`session-menu-items.ts:96-114`), which has no tone field.
- **Folder menu.**
  - Item rows render at `FolderActionsMenu.tsx:321-335`, in the same monochrome scheme.
  - The badge uses raw `text-amber-400` (`:332`).
  - The host item type is `FolderMenuItem` (`:74-94`). Host items are built in `SessionList.tsx` (around `:1725-1920`).
- **Plugin folder items.** These go through `FolderMenuContribution` (`dashboard-plugin-runtime/src/folder-menu-contributions.tsx:42-56`). Registration **whitelists** fields by destructuring (`:160-161`), so unknown keys such as `node` cannot smuggle markup at runtime. The hook variant re-reads fields (`:262-279`).
- **Plugin session items** (PLUGINS group): `ui:action-list` intents rendered by `client-utils/src/ActionList.tsx`. In menu mode (`:46-66`) the buttons use `--text-primary`. The item type is `UiActionListItem` (`shared/src/dashboard-plugin/ui-primitives.ts:234-245`). Intent props pass through the server untouched.
- **Lifecycle colours on the card.** `OpenSpecStepper.tsx` takes its colours from `client-utils/src/statusPresentation.ts:27-30`: done `--status-idle`, current `--status-working`, todo `--text-muted`.
- **Tokens.** `--tint-{green,blue,orange,red}-{fg,bg,border}` (`index.css:198-210`) are `color-mix` derivations of the per-palette `--accent-*`, so every palette gets them for free. `--accent-amber` does not exist; it was mockup-only.
- **Menu surfaces.** Both menus render on `--bg-secondary`. Measured contrast of `--tint-*-fg` on base dark `--bg-secondary`: green 10.80, blue 9.07, orange 9.86, red 8.46.
- **Tailwind sources.** Tailwind v4 scans `client-utils/src` and `dashboard-plugin-runtime/src` (`index.css:16-17`), so static class literals there are generated.

## Goals / Non-Goals

**Goals:**
- One tone vocabulary and one tone → class mapping, shared by all three renderers (session `MenuEntry`, folder row, `ActionList`).
- Purely additive public API. Existing plugins keep compiling and rendering identically.

**Non-Goals:**
- No new colour tokens and no palette edits.
- No colour on labels.
- No tone for React claim output, card inline controls, or the mobile kebab.
- No tone on `menuitemradio`.

## Decisions

### D1: Semantic tone names, not colour names
`UiTone = "go" | "create" | "caution" | "danger"`.
- Plugins declare *intent*, and the host owns the palette. A future palette can remap `caution` without breaking any plugin.
- *Alternative:* colour names (`"green"`). Rejected: these couple the plugin API to today's palette.
- *Alternative:* a free `className`/`color` string. Rejected: it reopens the arbitrary-styling hole the folder-menu whitelist exists to close (`folder-menu-contributions.tsx:150-160`).

### D2: One shared helper in client-utils; static class literals only
`client-utils/src/tone.ts` exports:
- `isUiTone(v): v is UiTone`, a runtime guard for untyped intent payloads and `as any` plugins;
- `toneIconClass(tone, { disabled })`, returning `text-[var(--tint-green-fg)]`, … or `""`;
- `toneRowHoverClass(tone, { disabled })`, which returns the danger hover/focus `bg-[var(--tint-red-bg)]` or `""`.

Each mapping is a `Record<UiTone, string>` of complete literals. The raw tone value is only ever a lookup key and is **never interpolated** into a class string. That keeps Tailwind's scanner able to see every class, and rules out class injection from an untrusted value. An invalid or missing value gives `""`, which means neutral.
- `UiTone` itself lives in `shared` (`dashboard-plugin/ui-primitives.ts`), because both public types (`UiActionListItem`, and `FolderMenuContribution` via its import) need it and `shared` is the leaf package.
- *Alternative:* per-renderer maps. Rejected under DRY: three copies would drift.

### D3: `data-tone` as the stable test and styling hook
Every item with a valid tone renders `data-tone="<tone>"`, whether enabled or disabled. Items with no tone or an invalid tone render no attribute. Tests assert the attribute plus the computed colour, never the class string.
- A disabled toned item keeps `data-tone` for traceability but uses neither the icon colour nor the danger hover. The spec requires only that the colour drops.

### D4: Runtime forwarding keeps the whitelist
`folder-menu-contributions.tsx`:
- registration (`:160-161`) destructures `tone` and stores `tone: isUiTone(tone) ? tone : undefined`;
- the hook (`:262-279`) adds `tone` to its fields and its dependency list.

Validation happens at the boundary, so the host renderer only ever sees a valid tone or `undefined`. Invalid values are dropped silently, consistent with "unknown tone renders neutral".

### D5: Host tone assignment lives next to item construction
- **Session:** `tone` is set inline where each item is pushed in `session-menu-items.ts`. The NEXT copy (`{ ...mergeItem, emphasis }`) carries the tone, but `MenuEntry` lets `emphasis` win. The NEXT row uses the blue tint triple, and its icon is `--tint-blue-fg` regardless of tone, so NEXT always reads as one consistent primary.
- **Folder:** `tone` is set inline in `SessionList.tsx`'s folder item builders. Project setup gets `caution` only when `initStatus` reports a pending update; that is the same predicate that already adds the `● update` label suffix.
- **Plugins:** goal, automation, team and kb add `tone` to their contribution objects (one field each).

### D6: Lifecycle row reuses `statusPresentation`
The menu's `LifecycleRow` gets a bar per segment with `style={{ "--seg-color": tokenVar }}`. `tokenVar` comes from the same `statusPresentation` the card's `OpenSpecStepper` uses, and skipped maps to done + `–`, exactly as `OpenSpecStepper.tsx:69-71` does. Both surfaces therefore follow one source.
- *Alternative:* new menu-specific colours (the mockup's green/amber). Rejected: amber has no token, and the menu would diverge from the card.

### D7: NEXT tint
`MenuEntry`'s emphasis branch becomes `bg-[var(--tint-blue-bg)] text-[var(--tint-blue-fg)] border border-[var(--tint-blue-border)]`, applied only when enabled. When disabled, NEXT falls through to the existing inert styling.

### D8: Contrast guard
A unit test computes the contrast of every `--tint-*-fg` against `--bg-secondary` for base dark/light and each `themes.ts` palette × mode. It resolves the `color-mix(in srgb, accent 46%, text-primary)` itself and asserts ≥ 3:1. A synthetic low-contrast fixture proves that the assertion can fail.

## Risks / Trade-offs

- **[Risk] A published API field is hard to rename.** → Mitigations: semantic names (D1), optional field, a closed union, and an `isUiTone` guard. This is the `doubt-driven-review` target named in the proposal.
- **[Risk] An older host receives a newer plugin's `tone`.** → Old `ActionList` ignores unknown props, and the old runtime's whitelist drops `tone`. Both degrade to neutral; nothing breaks.
- **[Risk] Colour overload, a "Christmas tree" menu.** → Colour is icon-only, most items stay neutral (about 4 of 15 typical items are toned), and only `danger` changes the row background, on hover. F-manual visual review in the test plan.
- **[Risk] A palette whose `--accent-*` is close to `--bg-secondary`** could fail 3:1. → D8 runs over every palette, and a failure is a palette bug fixed by its own token.
- **[Trade-off] Disabled toned items lose colour** and look like neutral disabled items. → Intended: an inactive red icon would suggest a live destructive action.

## Migration Plan

Additive.
- Ship order within one release: `shared` (type) → `client-utils` (helper, `ActionList`) → `dashboard-plugin-runtime` (forwarding) → `client` (renderers, host tones) → first-party plugins (tone fields).
- CHANGELOG `## [Unreleased]` gets one "Added" entry naming the two new optional plugin API fields. Versions bump at release cut, per `release-cut`.
- Rollback is a revert. Plugins that already set `tone` keep compiling against the reverted types only if the field remains, so revert the plugin tone fields in the same commit.
