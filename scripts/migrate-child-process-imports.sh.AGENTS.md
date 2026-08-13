# migrate-child-process-imports.sh — index

One-shot sed migration: rewrites `from "node:child_process"` to platform/exec wrapper. platform/* files use ./exec.js, packages/shared/src non-platform use ./platform/exec.js, packages/server|extension|electron use @blackbelt-technology/pi-dashboard-shared/platform/exec.js.
