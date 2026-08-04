# UX test — openspec-dialog-model-effort-selector

Mockup: `index.html` (append `?theme=light`). Scored at 375 / 768 / 1440 px, both themes.

## 1. Accessibility floor (HARD GATE)

Contrast computed in code (WCAG 2.x relative luminance) against the real token values, not eyeballed.

| Pair | dark | light | Verdict |
|---|---|---|---|
| dialog title `--text-primary` / `--bg-primary` | 15.72 | 17.40 | PASS |
| chip `--text-secondary` / `--bg-tertiary` | 7.69 | 8.55 | PASS |
| "Runs with" label `--text-secondary` / `--bg-primary` | 12.63 | 9.74 | PASS (after fix R1) |
| dirty chip `--severity-info-fg` / `-bg` | 7.27 | 8.15 | PASS |
| disclosure status `--severity-info-fg` / `--bg-primary` | 9.72 | 10.58 | PASS |
| warn chip `--severity-warning-fg` / `-bg` | 8.47 | 8.05 | PASS |
| popover row `--text-secondary` / `--bg-surface` | 6.62 | 7.38 | PASS |
| name chip `--text-secondary` / `--bg-tertiary` | 7.69 | 8.55 | PASS |
| field note `--text-secondary` / `--bg-primary` | 9.13 | 9.74 | PASS |
| `.kbd` glyph `--text-secondary` / `--bg-tertiary` | 7.69 | 8.55 | PASS (after fix R5) |

Other floor checks:

- **2.4.7 focus visible** — PASS. Global `:focus-visible` = 2px `--focus-ring`, 2px offset.
- **2.5.8 target size (min)** — PASS. Triggers 28px desktop (>24px floor), raised to 44px under 560px (fix R2), matching touch guidance without breaking composer parity.
- **1.4.1 use of color** — PASS. Dirty state carries the text line "Model changes for this session, not just this run.", never tint alone.
- **4.1.3 status messages** — PASS. S3/S4 status lines are `role="status" aria-live="polite"`.
- **2.3.3 / reduced motion** — PASS. `prefers-reduced-motion` slows the spinner instead of removing the only progress signal.
- **1.3.1 info & relationships** — PASS. Chips use `aria-haspopup`/`aria-expanded`/`aria-controls`; list is `role="listbox"` + `role="option"` + `aria-checked`.

### Pre-existing token debt (NOT introduced here, NOT gating)

| Pair | dark | light |
|---|---|---|
| popover group heading `--text-tertiary` / `--bg-surface` | 3.63 | 3.39 |
| primary button white / `--accent-primary` | 3.68 | 5.17 |

Both are inherited verbatim from shipped `ModelSelector` / `Dialog.Action`. Fixing them is a repo-wide token change, out of scope. Logged, not silently absorbed.

## 2. Heuristic rubric

| # | Check | Rule | Verdict |
|---|---|---|---|
| 1 | System status visible during the apply gate | Nielsen H1 | PASS — S3 spinner + live text |
| 2 | Match to real-world language ("Runs with", "effort") | Nielsen H2 | PASS |
| 3 | User control — Cancel reachable in every state | Nielsen H3 | PASS |
| 4 | Consistency with the composer toolbar | Nielsen H4 / Jakob | PASS — same components, same trigger shape |
| 5 | Error prevention: sticky side-effect disclosed pre-Send | Nielsen H5 | PASS — S2 hint |
| 6 | Recognition over recall: current values shown, not remembered | Nielsen H6 | PASS |
| 7 | Accelerator: untouched dialog behaves exactly as today | Nielsen H7 | PASS — zero added steps |
| 8 | Minimalist: no hint line when nothing is dirty | Nielsen H8 | PASS — `.status:empty` collapses |
| 9 | Graceful degradation when the model list is missing | Nielsen H9 | PASS — S4 read-only + reason |
| 10 | Choice count collapsed by default | Hick's Law | PASS — 2 triggers, grouped popover |
| 11 | Controls grouped with the action they modify | Gestalt proximity | PASS — one bordered footer row |
| 12 | No overflow/clipping at 375/768/1440 | — | PASS — stacks vertically <560px |

**Score: 12/12 rubric + 7/7 floor.**

## 3. PURE friction walkthrough — "explore with a stronger model"

| Step | Friction |
|---|---|
| Open Explore | green — unchanged |
| Notice the model chip | green — always visible, labelled |
| Change model | green — one click, grouped list, favorites pinned |
| Understand the consequence | **yellow** — sticky is disclosed but only after the change; a user who never reads the hint mutates the session silently |
| Send | green — gate is visible, Cancel available |

Worst step = yellow. Accepted: the alternative (a confirm step) violates H7 for the common case. The hint line is the mitigation.

## 4. Defects found & fixed in-loop

| id | Defect | Sev | Fix |
|---|---|---|---|
| R1 | "Runs with" label used `--text-tertiary` → 4.48:1 on light, under AA | 3 | switched to `--text-secondary` |
| R2 | 28px targets in the mobile stacked layout | 2 | 44px min-height + full-width buttons <560px |
| R3 | Empty status line reserved vertical space in the clean state | 1 | `.status:empty { display:none }` |
| R4 | S5 card stretched to grid row height, leaving dead space | 1 | `align-self: start` |
| R5 | `.kbd` glyph on `--text-tertiary` → 3.93:1 on light, under AA | 3 | → `--text-secondary` |
| R6 | Explore had no icon, no hint — structurally unlike its siblings | 2 | shared dialog anatomy (below) |
| R7 | Accelerator note duplicated onto Propose where Enter is already the default | 1 | removed; kept only on Explore |
| R8 | **Close (X) button missing from every mockup card** — `Dialog.tsx` renders one on every dialog | 3 | added: 28px, `top-3 right-3`, `--text-secondary`, `aria-label="Close"`; head gets `padding-right: 32px` so a long name chip never slides under it; 44px on mobile |

No severity-4 defects. No open defects.

## 4b. Streamlining pass — one anatomy for all three dialogs

Explore was the outlier: bare `<h3>` + a large empty textarea, while Propose carried a hint line and New Change carried two fields. Unified structure:

```
icon tile → title (+ name chip) → hint → fields → [field note] → run row → actions
```

| Decision | Rule | Note |
|---|---|---|
| 36px accent-tinted icon tile on all three | Nielsen H4; Dialog.tsx already ships an unused `icon` prop | zero new API — pass `mdiCompassOutline` / `mdiSend` / `mdiPlusBoxOutline` |
| Change name becomes a mono chip, not `Explore: add-webhook-retry` | Gestalt figure/ground | the name is data; the title is a label. Long names now truncate instead of wrapping the heading |
| Explore gains a hint: "Think the problem through. Nothing gets implemented." | Nielsen H2 / H10 | states the guardrail the explore skill actually enforces, at the moment it matters |
| `⌘↵ to send` note on Explore only | Nielsen H7 / H8 | Cmd+Enter is not discoverable; plain Enter on a one-field form is |
| Screenshot-paste affordance moved out of the placeholder into a field note | Nielsen H6 | placeholder text vanishes on focus — a persistent capability must not live there |
| X close retained on all three, alongside Cancel | Nielsen H3 user control; three dismissal paths already ship (X / Escape / backdrop) | X and Cancel are NOT redundant here: Cancel sits in the action row as the negative pair to Send, X is the persistent modal-exit affordance users expect top-right |

Net effect: Explore reads as a peer of the other two instead of a stripped-down variant, and the placeholder shrinks from a two-clause sentence to a single question.

### Inherited, not introduced

Icon glyph on its 15%-tint tile measures 4.65 (dark) / 4.20 (light). The icon is `aria-hidden` and duplicates the adjacent title, so it is decorative and outside 1.4.11. This is the shipped `Dialog.tsx` header pattern, unchanged.


## 5. Anti-slop

No purple gradient, no Inter, no centered hero, no fake screenshot divs. Data is real: actual repo token names, actual model ids, an actual change name — no "Acme" / "Jane Doe".

## 6. Not covered by this mockup

- Real popover flip behaviour under `usePopoverFlip` inside a scrolled dialog.
- Keyboard arrow-key traversal of the listbox (owned by shipped `ModelSelector`).
- The confirmation race itself (protocol, not UX) — needs the implementation spike.
