# DOX — packages/video-production/src/bin

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `veo.ts` | `pi-veo` unified CLI. Subcommands: `parse` (inspect+`--json`), `plan` (render dry-run), `render` (Veo 3.1 → mp4; flags `--shots --model --resolution --with-reference --no-first-frame --chain --parallel --force --no-seed --enhance-prompt --api-key --poll --dry-run`), `storyboard` (nano-banana first-frames). Manual flag parser (list/value/bool). Runs as TS via jiti. |
