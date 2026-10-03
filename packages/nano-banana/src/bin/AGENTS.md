# DOX — packages/nano-banana/src/bin

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `nano-banana.ts` | `pi-nano-banana` CLI. Exports `parseArgs` (`<prompt> [--file] [--output/-o] [--model] [--flash] [--api-key] [--backend]`), `resolveBackend` (`--backend` → `NANO_BANANA_BACKEND` trimmed/lower-cased → `gemini`), `formatResult` (pi: ` (pi · <model>) · ~$<cost> est.`, `✗ generation failed (pi): …`), `USAGE`. `main()` runs only when entry (`isEntry` realpath check). Exit 1 on missing prompt / invalid backend (usage) / invalid env (`✗ NANO_BANANA_BACKEND must be gemini or pi`) / failure; pi path exits in write callback after flush. Runs as TS via jiti. See change: add-pi-runtime-image-generation |
