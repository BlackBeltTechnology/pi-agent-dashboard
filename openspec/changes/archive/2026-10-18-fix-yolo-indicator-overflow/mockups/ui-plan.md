# ui-plan — fix-yolo-indicator-overflow

Board: `index.html` — exploration history. Final design = `../design.md` D1–D7; where the board differs, design wins:
- colour is **orange** (`--severity-warning-*`, underline `--accent-orange-text`), not the yellow of §R / §0 B frames;
- the bar has **no click handler**; Access via the focus-revealed bar link or the composer strip;
- the strip's countdown sits **outside** the link (static link name).

## Surfaces → tokens → states

| Surface | Host | Tokens | States |
|---|---|---|---|
| Row-1 tint (`useYoloAppBar` + `YoloBarLink`) | `header-app-bar` (`SessionList.tsx`) | `--severity-warning-bg`, underline `--accent-orange-text` (inset shadow) | off · on (scope not shown; tooltip/link text differ) |
| `YoloComposerStrip` | above `<CommandInput>` in `App.tsx` + `DirectoryHomeView.tsx` | `yoloTone` → `--severity-warning-*` | scoped (1 px) · unscoped (2 px + bold) · env `∞` |

No new tokens. Removed: `YoloPill`, `YoloSessionIndicator`.

## Contrast gate (design D7)

Row-1 `--text-secondary` / `--text-tertiary` on the tint ≥ 4.5:1 or ≥ 85% of untinted contrast; underline ≥ 3:1; 18 theme × mode combos. Base: tertiary 4.6 dark / 4.8 light, underline 4.76 light.

## Recorded deviation

Bar meaning is colour + underline only without hover (`theme-gallery` *Accent-text hue is a secondary cue*) — operator decision.
