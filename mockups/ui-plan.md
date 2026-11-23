# UI Plan — improve-dashboard-attention-routing

CONTRACT step (frontend-mockup-loop). Every value below references a **token**,
never a raw hex/px literal. Status color is a semantic token derived per theme
from that theme's accent tokens (`themes.ts` → `statusVars`).

## Semantic status tokens

| Token | Derives from | Meaning | Surfaces |
|---|---|---|---|
| `--status-needs-you` | `--accent-purple` | chat-routed `ask_user`, blocked on user | dot, rail, icon tint, label, folder pill |
| `--status-working` | `--accent-yellow` | streaming / tool / resuming / retry | dot, rail, icon tint, tool label |
| `--status-idle` | `--accent-green` | turn finished (idle/active) | dot, rail, icon tint |
| `--status-error` | `--accent-red` | session error | dot, rail, icon tint |
| `--bg-surface` | (base) | ended / unknown (muted) | dot, rail |

Contrast gate (Q1): each `--status-*` ≥ 3:1 vs `--bg-tertiary` in dark + light,
all themes. Accents already meet this; status tokens inherit it.

## Surface → state → token map

### Status dot / source-icon tint (`deriveDotColorWithFlags`, `deriveIconStatusColor`)

| State | Color token | Shape (`deriveStatusShape`) |
|---|---|---|
| error | `--status-error` | ✕ cross (`mdiCloseCircle`) |
| needs-you (chat ask_user) | `--status-needs-you` | ● filled (`mdiCircle`) |
| working (stream/tool/resume/retry) | `--status-working` | ◐ half (`mdiCircleHalfFull`) |
| idle / active | `--status-idle` | ○ ring (`mdiCircleOutline`) |
| ended | `--bg-surface` | (none) |

Precedence (highest→lowest): error > needs-you > working > idle > ended.
Shape is the **non-hue channel** (WCAG 2.2 §1.4.1) — survives grayscale +
reduced-motion.

### Left-gutter rail (`deriveRailBgColor`) — `color-mix` tint

| State | Unselected (40%) | Selected (65%) |
|---|---|---|
| error | `color-mix(--status-error 40%)` | `…65%` |
| needs-you | `color-mix(--status-needs-you 40%)` | `…65%` |
| working | `color-mix(--status-working 40%)` | `…65%` |
| idle | `color-mix(--status-idle 40%)` | `…65%` |
| ended | `--bg-surface` (no shade swap) | `--bg-surface` |

### ActivityIndicator label (`SessionCard.tsx`)

| State | Label | Color token |
|---|---|---|
| needs-you (chat ask_user) | **"Needs you"** + comment-question icon | `--status-needs-you` |
| tool (non-ask_user) | tool name + flash icon | `--status-working` |
| streaming | "Thinking…" | (unchanged) |
| resuming | "Resuming…" | (unchanged) |
| idle / active | **"Idle"** | `--text-tertiary` (muted) |

"Waiting for input" string is **retired** — it no longer maps to two opposite
states (H4 consistency).

### Folder header rollup (`FolderNeedsYouPill`)

- Shows `N` + "need you" when ≥1 chat-routed `ask_user` child; hidden at 0.
- Color: `--status-needs-you` text, `color-mix(--status-needs-you 12%)` bg,
  `color-mix(--status-needs-you 45%)` border.
- Mobile (≤375px): "need you" label `hidden sm:inline`; icon + count remain.
- Click → scroll first blocked session into view + select.

### Opt-in urgency sort (`useFolderUrgencySort` + header toggle)

- Per-folder toggle (`mdiSortVariant`), default OFF, localStorage-persisted.
- ON → `floatAskUserFirst` floats blocked sessions atop the active tier
  (stable within groups). OFF → unchanged order.
- Toggle color: ON = `--status-needs-you`, OFF = `--text-tertiary`.

## Rules cited
Von Restorff (isolation) · Nielsen H1/H4/H6 · WCAG 2.2 §1.4.1 · Jakob's Law ·
Tesler (user control) · ui-contract (token-only).
