# split-large-agents.mjs — index

One-off Node script. Splits over-large directory `AGENTS.md` file-based. Rows > 200 chars promote to per-file `<File>.AGENTS.md` sidecar (full detail, pull-only, not auto-injected by pi); dir row keeps one-line summary + `→ see <File>.AGENTS.md` pointer. Rows ≤ 200 chars stay verbatim. Usage: `node scripts/split-large-agents.mjs <AGENTS.md> --write`. Ran once on `packages/client/src/components/AGENTS.md` (60 KB → ~26 KB, 111 sidecars). See change: split-components-agents-dedup-rollup.
