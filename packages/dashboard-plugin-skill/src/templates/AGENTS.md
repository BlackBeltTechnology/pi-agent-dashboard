# DOX — packages/dashboard-plugin-skill/src/templates

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `slot-sections.ts` | Per-slot React stub templates. Exports `SlotSectionContext`, `SLOT_SECTIONS` (map slot id → `{ componentName, render(ctx) }`), `SLOT_RENDER_ORDER` (stable 10-slot order). Each stub annotates `SlotProps<...>` prop contract. `command-route` reuses `ContentView` component name (claim-only, no extra component). |
