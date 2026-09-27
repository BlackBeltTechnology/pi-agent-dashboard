# UX test — align-ui-with-theme-tokens

After-mockup: `mockups/index.html` (A1–A6; `tokens.css` = verbatim theme layer + proposed `--tint-*`). Before: `mockups/before/*.png` (live dashboard, 2026-09-27).
Probe: `NODE_PATH=$PWD/node_modules node openspec/changes/align-ui-with-theme-tokens/mockups/ux-probe.cjs <url> <outDir> [scope]` — axe WCAG 2.2 AA, **computed** contrast, text floors (≥ 11 px; interactive/help ≥ 12 px), 44 px mobile targets, overflow, focus, console. Dark + light.

## Scores

| Target | Scope | Score | Failing checks |
|---|---|---|---|
| Live folder card (before) | `[data-testid="sortable-workspace-folder"]` | **3 / 10** | axe (contrast, listitem, nested-interactive, target-size) both themes; computed contrast both themes; text size both themes; mobile targets |
| After-mockup | A1–A6 | **10 / 10** | — |

Live computed-contrast samples (light, on `#fafafa`): "New Session" 1.70 · "⚠ 21 stale" 1.65 · "7" (status capsule) 1.77 · "develop" 2.64 · "Commit" 2.64 · worktree headings 2.32. Dark: relative-time labels 2.78, workspace counts 2.34.
Live mobile targets: capsule 35×21, git pill 72×14, "Commit" 37×15, icon buttons 12–22 px; worktree source toggle 23 px tall, close × 28 px.

Note: the live scope includes components outside this change (folder-header status capsule, git pill, kb "stale" badge, workspace counts). They fail the same way and are listed as a follow-up in design.md Open Questions; the Playwright port (F1–F9) scopes to the 8 changed files.

## Why axe alone is not enough

axe reported the live spawn tray as passing. Its text sits on `bg-green-500/5` (semi-transparent), which axe marks "incomplete" rather than a violation. The probe resolves colours through a canvas and composites ancestor backgrounds, which found 1.70:1. Every contrast row in the test plan uses the computed routine.

## Findings that shaped the design

| id | Finding | Rule | Design |
|---|---|---|---|
| U1 | Raw `*-400` palette text 1.12–2.99:1 in light | WCAG 1.4.3 | D1 tints + D2 mapping |
| U2 | "Resuming…" in `--status-working` 1.84:1 light (also live `SessionCard` `text-yellow-400`) | WCAG 1.4.3; colour not sole channel | D2b status colour on shape only |
| U3 | Uppercase `--text-muted` headings 2.3–2.8:1 | WCAG 1.4.3; all-caps legibility | D3 `--text-secondary`, sentence case |
| U4 | 10 px chips, `py-px` controls 14–23 px | WCAG 2.5.8; Fitts | D5 floors |
| U5 | No `focus-ring` in 4 of 8 files | WCAG 2.4.7 | D6 |
| U6 | Worktree Create `bg-blue-500/80`, not the house primary | Consistency (H4) | D4 `--accent-solid` + white |
| U7 | 11 px dense metadata is fine per `ui-contract.md` | — | two floors, not one (probe updated) |

## Decisions confirmed by the mockup

- Identity tints keep the familiar hues (pi green, worktree orange, goal purple), so the dark theme looks almost unchanged; the light theme becomes readable.
- Section headings in sentence case at 12 px semibold read better than 11 px uppercase muted, with no loss of hierarchy.
- 32 px desktop chips keep cards dense; 44 px only below `sm`.
