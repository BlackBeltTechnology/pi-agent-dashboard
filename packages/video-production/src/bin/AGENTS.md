# DOX — packages/video-production/src/bin

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `veo.ts` | `pi-veo` unified CLI. Subcommands: `parse` (inspect+`--json`), `plan` (render dry-run), `render` (Veo 3.1 → mp4; flags `--shots --model --resolution --with-reference --no-first-frame --chain --parallel --force --no-seed --enhance-prompt --api-key --poll --dry-run`), `storyboard` (nano-banana first-frames), `export <render\|timeline> <target>` (pi-video-gen specs; `--out --job --new-job --no-last-frame --durations --aspect --clips --json`), `mux <target> --picture` (`--out` file, `--force`, `--burn`). `parse` exits 1 on sidecar problems. Manual flag parser (list/value/bool). Runs as TS via jiti. See change: add-pi-video-gen-export |
