# UI Plan — Directory Home Page

Per-change control plane. Every value references a **theme-system CSS var**
(`packages/client/src/index.css`), never a raw hex/px. Themes: dark (`:root`) +
light (`[data-theme="light"]`). No new tokens required.

## Surfaces → tokens

| Surface | Background | Border | Text | Accent |
|---|---|---|---|---|
| Content pane | `--bg-primary` | — | `--text-primary` | — |
| Header (name + path + quick actions) | `--bg-primary` / border-bottom `--border-primary` | `--border-secondary` (quick-action links) | title `--text-primary`, path `--text-secondary`* | link hover `--bg-hover` |
| Prompt composer (reuses `CommandInput`) | `--bg-tertiary` | `--border-secondary` → focus `color-mix(--accent-primary 60%)` | `--text-primary`, placeholder `--text-muted` | send `--accent-blue`, chip hover `--bg-hover` |
| Session card (mirrors `SessionCard.tsx`) | `--bg-tertiary`; selected `--accent-blue 6%` | `--border-subtle`; selected ring `--accent-blue 30/60%` | title `--text-primary` 600, meta `--text-tertiary`, age `--text-muted` | status-tinted **left rail** + **shape marker** `--status-idle/working/needs-you` |
| Not-pinned notice | `--bg-primary` | CTA `color-mix(--accent-primary 50%)` | `--text-tertiary` | CTA `--accent-primary` |
| Cold-load skeleton | gradient `--bg-secondary`↔`--bg-tertiary` | — | — | — |
| Sidebar "open" affordance | hover `--bg-hover` | — | `--text-muted` → hover `--accent-primary` | — |
| Sidebar row — **selected/active** dir | `--bg-tertiary` | **1px dashed** `color-mix(--accent-primary 55%, --border-secondary)` | `--text-primary` | dashed border = accent |

*Promote note: use `--text-secondary` (not `--text-tertiary`) for the folder path
in light theme — `--text-tertiary` on white ≈ 4.48:1 (just under AA).

## States (per spec requirements)

| State | Trigger | Layout |
|---|---|---|
| empty | pinned folder, 0 sessions | π glyph + heading + **centered** composer + 3 starters |
| populated | pinned folder, ≥1 session | composer **docked-top** + "Sessions in this folder" list |
| sending | send pressed, spawn not correlated | composer disabled + spinner + "Opening session…" (Nielsen #1 / Doherty) |
| not-pinned | cwd ∉ loaded `pinnedDirectories` | notice + "Pin this folder…" CTA (Nielsen #3/#9) |
| cold-load | `pinnedDirectoriesLoaded === false` | skeleton (no not-pinned flash — design D4) |

## Session card anatomy (grounded in `SessionCard.tsx`)

- Shell: `rounded-xl`, bevel+drop shadow `inset 0 1px 0 --elevation-rim, 0 4px 8px --shadow-card` (hover deepens); selected adds a `0 0 0 1px --accent-blue 30%` ring + tint.
- 3px **status-tinted left rail** (`::before`) — working/idle/needs-you.
- Row 1: status-tinted source icon + **non-color shape marker** (filled / ring / half — survives grayscale + reduced motion) + title(600) + optional queue badge + relative age.
- Row 2: model · activity text · spacer · **context-usage bar** · cost (`$0.00`).
- Reuse the shipped card, not a new one, on promote — this list is the same `SessionCard` the sidebar/split view renders.
- **The sidebar session list and the content-pane session list use the SAME card** (single component). In the narrow sidebar column it sizes down: activity text omitted, context bar narrowed, age abbreviated (`2m`/`1h`), title truncates — identical shell, rail, shape marker, model, cost, selected ring.

## Invariants

- Exactly **one** focal action per view (Von Restorff / Nielsen #8): the composer.
- Send target ≥ 44×44 (Fitts). Status conveyed by text badge, not color alone.
- No model picker in v1 (design D5, deferred).
- Radius: composer `rounded-xl` (12px), cards/links `rounded-lg` (≈8–10px) — matches shipped `CommandInput` / `LandingPage`.
- Folder panel (sidebar) divider is **dashed** (`1px dashed --border-secondary`) — the dashed motif reads as "pinned/workspace scaffold".
- The active directory's **folder header + its sessions** are wrapped in ONE dashed-bordered **common region** (Gestalt common-region + proximity) with a subtle `--accent-primary 6%` tint — the sessions belong visually inside the folder's region, not below it. Non-selected groups carry a 1px dashed **transparent** border so selection never shifts layout.
