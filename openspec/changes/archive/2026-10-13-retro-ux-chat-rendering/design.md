## Context

Shared method: `retro-ux-identity-connectivity` design.md (D1–D5). This file records only what differs.

Concrete findings:
- `MermaidBlock.tsx:299`: `text-red-400 bg-red-900/20`; `:529` `border-blue-500/60`.
- `MermaidBlock.tsx:104`: `FALLBACK_ACCENTS` hex list, tinted through `rgba()` (`:128-167`). `:203` resolves `--text-primary` with a hex fallback.
- `WebSearchEntryCard.tsx:96,144,194`: `text-red-400`.
- `ui-contract.md:60,88,170`: severity family and callout pattern.

## Decisions

### D1. Show the rows in context
The board places each row between a real assistant message and a tool card. Chat rows are judged by how they read in the stream, not on their own.

### D2. Mermaid colour fallbacks: option A, measured (approved)
Mermaid takes concrete colour strings. Measurement: a bun script imported `THEMES` from `packages/client/src/lib/theme/themes.ts`. All 18 palette modes (9 palettes × dark/light) define `--accent-{blue,green,yellow,red,purple,orange}` and `--text-primary` as `#hex`. In the browser `resolveVar` therefore always returns a value, the fallback literals never paint, and `rgba()` (hex-only parser) never receives a non-hex value. The literals matter only in jsdom, where unit tests depend on them (`MermaidBlock.test.tsx:58-79` match `rgba(`).
The light block deliberately inherits the accents from `:root` (`ui-contract.md`), so the guard checks `:root`, every `THEMES` mode, and only `--text-primary` (plus any accent it defines) in the light block.
Decision (user, option A): keep `FALLBACK_ACCENTS` and the text fallback, with a code comment marking them test-only, a `ui-contract.md` exception row, and a guard unit test that fails when any palette defines one of the seven variables as non-hex. Option B (drop the literals, stub the variables in tests) was rejected: it changes behaviour with no visible gain. The guard closes the real risk, which is a future palette written in `oklch()` silently breaking node tinting.

### D3. Coordinate with `add-mermaid-ai-repair`
That change adds "Fix with AI" to the same error display. Whichever change lands FIRST builds the error-severity callout to the approved board (spec `mermaid-diagram` "Mermaid diagram rendering" in this change); the second one reuses it. If this change lands first, it builds the callout and leaves the AI controls out. If `add-mermaid-ai-repair` lands first, its task 0.2 builds the callout together with its AI controls, and this change's task 0.2 only restyles what remains. Neither change ships AI controls inside the old `text-red-400` strip. The board's AI states (`ai-offer`, `ai-pending`, `ai-fixed`, `ai-failed`) were approved, and `add-mermaid-ai-repair` adopts the board (its proposal "Mockup:" line and task 0.2). This change does not implement the AI controls; it only builds the callout they sit in.

### D4. Rule codes leave the visible text, not the DOM
The approved badge shows rule descriptions. Each `data-testid="mermaid-repair-rule"` element keeps the code in `data-rule`, so `mermaid-repair.spec.ts` and the `ruleCodes()` unit helper switch from `textContent` to `data-rule` with no loss of coverage.

### D5. Keyboard zoom is opt-in per diagram
The viewport joins the Tab order. Tabbing through it does not activate zoom; Enter activates it and Escape leaves, returning focus to the viewport so it is never lost on a hidden zoom button (confirmed by the user in doubt-review cycle 2). This keeps the existing scroll-passthrough guarantee and adds no global key handlers. Arrow-key panning is not part of this change; zoom buttons cover keyboard zooming.

### D6. Shared `ZoomControls` takes labels as props
`client-utils` has no i18n. `ZoomControls` gains optional `labels` (English defaults) and keeps `title` alongside `aria-label`, so `getByTitle("Zoom in")` in `mermaid-stability.spec.ts` and `MermaidBlock.test.tsx:441,482` keep working in English. Other hosts (`DiagramPreview`, `FlowGraph`, team-app) get the new sizing, focus ring and aria-hidden icons without code changes. The zoom buttons are icon-only, so they follow the icon-only tap-target row (`ui-contract.md:109,190-191`: 44 px below `sm`, 32 px from `sm`), not the 36 px text-button recipes.

### D7a. Web-search conformance stays ADDED
The base requirements "The expanded row SHALL show query and fetch detail…" and "Extension-authored content SHALL render safely" require that errors are visible, links are safe and open in a new context, and an unavailable payload shows the stored body with the reason. The ADDED requirement keeps all of that and only fixes how it is painted (pills, underline, icon, screen-reader suffix, warning tone), so no base sentence is contradicted. The visible link text stays the original string; the "(opens in a new tab)" suffix is visually hidden. Links use `--link` (`ui-contract.md:51`), the same token markdown links in chat use (`index.css:400`); the board first used `--text-primary`, and the user chose `--link` in doubt-review cycle 2. Measured: 0 probe failures in all three themes either way.

### D7. Row alignment is measured, not class-matched
Tool rows use `mx-4` (`mx-2` on mobile) plus `border-l-2 pl-3` (`ToolCallStep.tsx:177`). Touch targets follow `ui-contract.md` tap-target: zoom buttons are 44×44 px below `sm`, 32×32 px from `sm` up. Web-search and custom rows move from `mx-2` to the same `mx-4` (`mx-2` on mobile) inset. Absorbed rows render through the same `CustomEntryRow` as top-level rows (`ToolBurstGroup.tsx:364-367`), next to `ToolCallStep`s that carry the same inset, so one class serves both placements. The spec checks left-edge equality with bounding boxes at 1440 and 375 px.

## Risks / Trade-offs

- [Two active changes edit one component] → task 0.2 checks the landing order. The approved mockup is the shared target.
- [Shared `ZoomControls` change reaches other previews] → the sizing and naming are additive; `ZoomControls.test.tsx` is verified unchanged (task 3.8) and new tests cover names and targets (section 4).
- [Visible copy changes break existing assertions] → listed one by one in task 3.8; none is treated as a regression.

## Migration Plan

None. Rollback is a revert.
