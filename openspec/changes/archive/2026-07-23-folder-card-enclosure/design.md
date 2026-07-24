# Design — folder-card-enclosure

## Structure (renderGroup)

```
<div key={cwd} class="space-y-1">
  <div class="relative pt-[9px]">              ← nub wrapper (existing, change: folder-card-tab-nub)
    <div class="nub" aria-hidden />
    <div class="fcard ...rounded-t-[14px] border-b-0">   ← HEADER (bg-primary + optional root tint)
      chevron/name row · git row · slot-pill grid
    </div>
    {!isCollapsed && (
      <div class="folderbody ...border-t-0 rounded-b-[14px]">   ← BODY (bg-primary, fold-shadow ::before)
        — CREATE —  · FolderSpawnButtons
        — SESSIONS —
        {active sessions · placeholder · spawn-error banners}
        {› N ended row}
      </div>
    )}
  </div>
  ... (spawn error / placeholder that must sit outside expansion stay as today)
</div>
```

Key: the header + body are two sibling divs sharing one visual border. Header `border-b-0`, body `border-t-0`; the body's `::before` inset shadow renders the fold seam. Both use `--bg-primary`.

## Decisions

- **D1 — Collapse.** When `isCollapsed`, the `folderbody` is not rendered at all (as today, the heavy slots are hidden). The header keeps `rounded-b` restored in the collapsed case so a lone collapsed card is fully rounded. Implement by toggling the header's bottom radius/border on `isCollapsed`.
- **D2 — Body is bg-primary, not a recessed pocket.** Mockup iteration settled on the folder body matching the header surface (`--bg-primary`), so the whole folder is one continuous sheet; the `--bg-tertiary` session cards provide the internal contrast. (A recessed `--bg-secondary` pocket was rejected — cards are already distinct.)
- **D3 — Fold seam.** `folderbody::before { inset 0 6px 6px -6px var(--shadow-card) }` at the top edge — soft, non-interactive, strongest in dark themes, invisible-ish in flat light. No hard divider line.
- **D4 — SESSIONS separator.** Reuse the CREATE divider's exact styling (centered uppercase label + hairline rules). Extract a tiny shared `SectionDivider` label or duplicate the 1-line markup; prefer inline reuse to avoid a new export for a label.
- **D5 — Ended row inside.** The "Show N ended" toggle + the ended list render inside the `folderbody`, after the active sessions, so they remain folder contents. Behavior/testids unchanged.
- **D6 — Root tint scope.** Applied only when `!inWorkspace` (top-level folders). Workspace-grouped folders (rendered via `renderGroup(..., true, wsId)`) never get the tint. The tint: `background: color-mix(in srgb, var(--accent-blue) 5%, var(--bg-primary))`; border: `color-mix(in srgb, var(--accent-blue) 22%, var(--border-subtle))` (or the theme's `--border-secondary`). Both header and body carry it so the enclosure is uniformly tinted.
- **D7 — No SessionCard change.** Cards keep `--bg-tertiary`, spine, and `blue-500` selection ring. The enclosure only changes their container.

## Risks / edge cases

- DnD: session cards are sortable inside the folder. Wrapping them in `folderbody` must not break the `SortableContext` — keep the sortable list container inside the body without an extra transform boundary.
- Spawn-error banner + `PlaceholderSessionCard` must render inside the body so they stay enclosed.
- Workspace nesting: the workspace-folder `renderGroup(..., true)` path must NOT tint and must still enclose correctly within the workspace container.
- The folder-tab nub sits above the header; the enclosure adds height below — verify the nub still peeks and nothing clips (`overflow-hidden` is on the header card only, not the wrapper).

## Open question (resolve during apply)

- Q1: Should the root tint also apply to the nub, so the whole folder (nub + header + body) is uniformly tinted? Default: yes — tint the nub too for consistency.
