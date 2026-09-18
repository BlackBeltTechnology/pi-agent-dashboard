# DOX — packages/deck3d/scripts

| File | Purpose |
|------|---------|
| `AGENTS.md` | This file. |
| `build-harvest.ts` | Bundles `src/parse/harvest/harness.ts` → `dist/harvest/harness.js` (mermaid + harvest logic). Run by `npm run build:harvest`. |
| `gen-ir-fields.ts` | Regenerates `../.pi/skills/deck3d/reference/ir-fields.md` from `src/ir/schema.json` descriptions; `--check` fails when stale. Delegates to `src/ir/field-reference.ts`. |
