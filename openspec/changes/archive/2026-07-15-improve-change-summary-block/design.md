## Context

`ChangeSummaryBlock` renders the files one assistant turn changed, with `+adds −dels` per row. It mounts in `ChatView.tsx` in two spots: anchored (one per completed turn) and **tail** (the live, still-streaming turn). Today every row leads with a status glyph and the block is always `defaultExpanded = true`.

Two independent refinements ship together because they touch the same component and the same spec requirement:

1. Presentation — mime icons instead of the status glyph.
2. Behavior — auto-fold the block when it grows large so it stops displacing messages.

## Decision 1 — Row leading glyph: mime icon (option A)

Explored three ways to reconcile the status glyph and a mime icon competing for the same slot:

| Option | What | Why not chosen |
|---|---|---|
| A · Replace | mime icon replaces status glyph | **chosen** — matches the editor file tree (same `fileIcon()`), zero info lost (counts already carry add/modify) |
| B · Both | status glyph + mime icon | two competing focal points per row; eats horizontal space the truncated path needs |
| C · Tint | mime icon tinted by status | **semantic collision** — color already encodes file type (blue = TS, orange = JSON); overloading it with status makes a modified `.ts` and an added `.ts` indistinguishable |

`TurnFileSummary.status` is only `"added" | "modified"` (no `"deleted"` on this surface), so option A needs no deletion treatment. Reuse `fileIcon(path) → { iconPath, colorClass }` verbatim; render with `@mdi/react`'s `<Icon size={0.55}>` as the file tree does.

`.css` (and `.scss` / `.less`) currently fall through to the generic `mdiFileOutline`. Add them to `ICON_BY_EXT` → `mdiLanguageCss3` so the stylesheet case reads distinctly. This also improves the editor file tree, which shares the helper.

## Decision 2 — Auto-fold as derived state with a sticky override

Threshold `THRESHOLD = 8`; collapse when `fileCount >= 8` (confirmed: ≥ 8, so exactly 8 collapses).

The effective expanded state is **derived** from the file count until the user takes manual control:

```
effectiveExpanded = userToggled ? userChoice : (fileCount < THRESHOLD)
```

```
                 fileCount grows as the turn streams
   ┌──────────────┐   crosses ≥ 8 (auto)  ┌──────────────┐
   │  EXPANDED    │ ────────────────────▶ │  COLLAPSED   │
   │ (< 8 files)  │                       │ (≥ 8 files)  │
   └──────────────┘                       └──────────────┘
          ▲                                      │
          └──────────  user clicks header  ◀─────┘
                    (userToggled = true, sticky)
```

Why derived rather than a `useEffect` that flips a `useState`:
- The tail block re-renders on every streaming event; a derived value has no effect-ordering or stale-closure hazard and no flicker between render and effect.
- It satisfies both asks with one rule: `fileCount >= 8` starts collapsed (requirement 1), and a block that was auto-expanded flips to collapsed the moment the count crosses 8 (requirement 2) — because the derived value recomputes.

State shape:
```ts
// null = user has not toggled; auto-derive. true/false = sticky manual choice.
const [userChoice, setUserChoice] = useState<boolean | null>(null);
const expanded = userChoice ?? fileCount < THRESHOLD;
const toggle = () => setUserChoice(!expanded);
```

`defaultExpanded` prop: keep it as the fallback for `fileCount < THRESHOLD` semantics but the count rule takes precedence; anchored (completed-turn) blocks with < 8 files render expanded exactly as today. No `ChatView` call-site change required.

### Sticky override edge cases
- User manually **expands** a ≥ 8 list, more files stream in → stays expanded (`userChoice = true`).
- User manually **collapses** a < 8 list → stays collapsed (`userChoice = false`).
- Never auto-*expands* a user-collapsed block (auto-fold only ever collapses; expansion is always user-driven or the initial < 8 default).

## Risks / trade-offs

- A turn that legitimately touches ≥ 8 files now hides the list behind a header by default; the count + `+X −Y` aggregate remain visible in the header, and one click expands. Acceptable — the whole point is to protect message visibility.
- Threshold is a magic constant (8), not a display pref. Intentional: no persistence, matches the confirmed "not persisted" preference; revisit only if users ask for tuning.
