# DOX — packages/client/src/components/tags

Session tag chip primitives + selectors. Shared across session card, detail header, sidebar filter. See change: add-session-tags.

| File | Purpose |
|------|---------|
| `TagChip.tsx` | Shared chip primitive. Exports `TagChip`, `TagChipVariant`, `TagChipTone`. Variants: `user` (colorized via `tagColor`, optional remove ✕ button), `exec` (dashed/muted read-only phase chip + 🔒), `filter` (selectable, `tone` picks user-colorized vs dashed, `aria-pressed`, `sel` ring). Interactive controls are real `<button>` (keyboard + ARIA). |
| `TagEditor.tsx` | Editable strip: colorized user chips (removable) + `+ tag` popover with free-form input autocompleting over `allTags` union (new tags allowed, Enter/click commit, Esc close). Emits full new `normalizeTags`-ed array via `onChange`. Exports `TagEditor`. |
| `TagFilterGroup.tsx` | Labeled selectable filter-chip row. Exports `TagFilterGroup`. Presentational — parent owns selection `Set`. Reused for sidebar "Your tags" (`tone=user`) + "Phase (read-only)" (`tone=exec`). Renders null when empty. |
| `TagStrip.tsx` | Compact read-only card strip: first `max`(3) user chips + `+N` overflow + optional read-only phase chip (openspecPhase). Exports `TagStrip`. Renders null when no tags + no phase. |
| `all-tags.ts` | Exports `allTagsInUse(sessions)` — flattens every session's `tags` into a deduped sorted union. Pure; callers `useMemo` over session list. Feeds TagEditor autocomplete + sidebar filter group. |
