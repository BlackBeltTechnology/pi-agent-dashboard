# DOX — packages/context-budget/bin

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `context-budget.mjs` | CLI. `measure` spawns ONE real headless pi turn (`pi -e src/meter.ts -p "reply with the single word: ok"`) in cwd, so the capture reflects that project's settings/skills/extensions, then prints the report. `report <file>` re-prints a capture. `diff <before> <after> [--expect-removed a,b]` prints deltas and EXITS 1 when an expected removal is still on the wire — the CI-usable form of "prove the trim landed". Falls back from `../src/index.ts` to `../dist/index.js` so it runs both in-repo and when published. |
