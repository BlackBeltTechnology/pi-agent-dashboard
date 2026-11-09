# Design

## Context

- `AutomationCard` holds the selection styling. The root `<li>` switches the border to `border-[var(--accent)]` when `selected` is true (`packages/automation-plugin/src/client/AutomationBoard.tsx:435-440`), then renders three FX layers: `GLOW_FX_CLASS + GLOW_FX_OUTER_CLASS`, `GLOW_FX_CLASS` and `RING_FX_CLASS` (`AutomationBoard.tsx:441-443`).
- `selected` is board state (`useState<string | null>`, `AutomationBoard.tsx:128`), set by `onSelect` on any card click (`AutomationBoard.tsx:328-329`, root `onClick` at `:436`).
- The FX constants are aliases of `HOST_FX_CLASSES.glow/glowOuter/ring` (`packages/automation-plugin/src/client/automation-card-visuals.ts:148-151`). The underlying CSS is the session card's rotating conic gradient in `packages/client/src/index.css`, and `SessionCard` still uses it (`packages/client/src/components/session/SessionCard.tsx:1367-1376`).
- `polish-automation-board` kept this glow on purpose (`openspec/changes/archive/2026-11-06-polish-automation-board/design.md:112`, D10: "the selected-card neon glow stays"). The current spec requires it (`openspec/specs/automation-content-view/spec.md:157`).
- The selected-chip recipe is `--text-primary` on `--accent-soft` with an `--accent` border (`ui-contract.md:120`). theme-system guarantees `--text-primary` on `--accent-soft` at ≥ 4.5:1 in both scopes (`openspec/specs/theme-system/spec.md:182-196`). It does not guarantee `--accent-text` on `--accent-soft`; dark default measures 4.49:1 (`--accent-text #60a5fa` on `--accent-soft #1d3a63`, `packages/client/src/index.css:146-148`).
- The card body holds `--accent-text` links (orphan session link, run-history Monitor/Result/Log; `AutomationBoard.tsx:600,654,725`).

## Goals / Non-Goals

**Goals:**
- The selected automation card reads like the other selectors in the dashboard: accent border, soft fill, stronger label.
- Selection is exposed to assistive technology through `aria-current`.
- No text on the selected card drops below its unselected contrast.

**Non-Goals:**
- Changing the session card's iridescent selection or the host FX CSS.
- Changing what selection *does*. It is still only a visual focus marker, with no keyboard selection model added.
- Building the two other adopted mocks (add-ons hub, flows folder edit mode).

## Decisions

### D1. Fill the header row only, not the whole card
The `--accent-soft` fill goes on the first row of the content column (icon, dot, name, scope, pill, actions). The card root is `flex`, with the 4px status rail (`w-1`) as the first child and the `p-3` content column as the second (`AutomationBoard.tsx:445,449`). The header row must stay the column's first child: it bleeds out of the column padding with `-mx-3 -mt-3 px-3 pt-3 pb-1.5`, so the band spans from the rail to the right and top border. The column's `gap-1.5` (6px) then separates the band from the body, and `pb-1.5` gives the band the same 6px of fill below the row content, so the row does not look clipped. The rail stays visible on its left. The body keeps `--bg-secondary`.
- *Why:* the header's content was measured on `--accent-soft` (all palette blocks in `packages/client/src/lib/theme/themes.ts`, and `--accent-soft` is not overridden there, so it comes from `index.css:146,296`). `--text-primary` measures ≥ 4.80:1 (already guaranteed by theme-system). `--text-secondary` (source icon, scope text) measures ≥ 5.27:1, the lowest being base dark. Status pills and the scope badge paint their own opaque backgrounds: `--severity-*-bg` is `color-mix(... var(--bg-tertiary))`, neutral is `--bg-tertiary` (`index.css:185-213`), and the badge is `--bg-surface`. Buttons paint `--bg-tertiary` or the red tint (`automation-card-visuals.ts:142-143`). Buttons with `disabled:opacity-60` (Stop while pending) blend toward the fill; disabled controls are exempt from WCAG 1.4.3, as on the unselected card. The body holds `--accent-text` links, which measure 4.49:1 on the soft fill in the dark scope. Neither `--accent-text` nor `--accent-soft` is overridden per palette, so every dark palette inherits that 4.49:1, while light scopes measure 5.49:1. A whole scope below the floor rules out a full-card fill.
- *Alternatives:* a full-card fill (the first mock) fails the link contrast. A full-card fill with recoloured links adds per-state link rules and more test surface. A border-only ring (2px accent) is calmer but drops the "fill" half of the selector recipe that the user approved. The user chose the header-row option when asked.

### D2. Remove the FX constants from the plugin instead of leaving them unused
`GLOW_FX_CLASS`, `GLOW_FX_OUTER_CLASS` and `RING_FX_CLASS` are deleted from `automation-card-visuals.ts`, and their imports are deleted from `AutomationBoard.tsx`.
- *Why:* they have no other consumer in `packages/automation-plugin/src` (the only importer is `AutomationBoard.tsx`). Keeping them would invite the glow back. `HOST_FX_CLASSES` in the runtime SDK stays, because it is a shared contract.

### D3. `aria-current="true"` on the selected `<li>`
- *Why:* it is the standard way to mark "the current item in a set" without implying a listbox/option model. A `role="listbox"` would need full arrow-key handling, which this change does not add.
- *Alternatives:* `aria-selected` needs a `listbox`/`grid` role with its keyboard model. Putting `aria-current` on the name button is wrong because that button opens the editor rather than selecting the card. Support for `aria-current` on a list item varies between screen readers. It is still the only marker that matches the semantics without a role change, and it costs nothing when it is ignored.
- *Limit:* selection is still mouse-driven (the `<li>` `onClick`, `AutomationBoard.tsx:436`). The marker exposes the selected state where assistive technology supports it; it does not make selection keyboard-operable. That gap existed before this change and stays a non-goal.

### D4. Bold name on selection (accepted reflow)
The name button switches from `font-semibold` to `font-bold` when the card is selected. This gives a non-colour cue in addition to the border and fill (WCAG 1.4.1). The weight change widens the 13px mono name by a few pixels. The header is `flex-wrap`, so on a very tight row the action group can wrap to a second line on selection. That is accepted; the alternative of reserving width with a hidden bold copy adds markup for a sub-pixel cue.

### D5. Record the card use of the recipe in `ui-contract.md`
`ui-contract.md:120` lists the selected-chip recipe for pressed chips only. A line is added for selectable cards that are not session cards: `--accent` border plus `--accent-soft` on the header row only, because card bodies hold `--accent-text` links. Without it, the next card would either copy the neon or fill the whole card.

### D6. Keep `relative isolate overflow-hidden` on the root
`overflow-hidden` still clips the header fill to the `rounded-xl` corners and keeps the rail stripe inside the card. The comment at `AutomationBoard.tsx:506-508` about clipping "decorative FX layers" is reworded to describe the remaining reason.

## Risks / Trade-offs

- [Some palettes may make `--accent-soft` faint against `--bg-secondary`] → The `--accent` border (non-text ≥ 3:1 per `index.css:145`) and the bold name carry the selection even where the fill is subtle.
- [The automation card no longer matches the session card's selected look] → This is intended. Automation cards adopt the session status language (rail, dot, pill, stripe) but use the general selector style for selection, as the rest of the non-session UI does.
- [Other specs mention a "selected card" treatment] → `panel-elevation` "Selected-card treatment unchanged" and `session-card-selection` are about the session card and stay true. `plugin-host-api` "Host CSS contract" keeps `HOST_FX_CLASSES` exported; this change only stops one plugin from using three of its keys.
- [The adopted add-ons and flows mocks live in a change that does not build them] → The proposal lists them as non-goals; a later change can move them again or link to them.
