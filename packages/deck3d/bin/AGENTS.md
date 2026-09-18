# DOX — packages/deck3d/bin

| File | Purpose |
|------|---------|
| `AGENTS.md` | This file. |
| `deck3d` | Executable CLI launcher (plain JS shim). Prefers dev: `src/cli.ts` via tsx when tsx resolves; else spawns `node dist/cli.js` (published path — subprocess so the CLI entry guard fires); else exits 1 naming `npm run build`. |
