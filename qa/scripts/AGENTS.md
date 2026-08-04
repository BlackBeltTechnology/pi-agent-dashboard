# DOX — qa/scripts

Files in this directory. One row per file. Non-source area. See change: migrate-file-index-to-agents-tree. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `replay-rss-soak.mjs` | P4 (L2) replay RSS soak for `compact-warm-replay-stream` (#399). Repeats N cold subscribes (`lastSeq:0` → full replay) over `ws://localhost:<port>/ws` against a RUNNING dashboard, samples `server.rss` from `/api/health` each iteration, settles 30s for GC, asserts settled RSS ≤ baseline×(1+tolerance). Args `--port --iterations (10) --tolerance (0.10)`; port falls back to `PW_E2E_PORT` then `dashboardPort` in `.pi-test-harness.json` — never hardcodes 18000. ON-DEMAND probe, NOT a CI gate (RSS is too noisy for a non-flaky threshold). |
| `run-test.sh` | QA test orchestrator. Clone → wait SSH → upload tests → run → destroy. Args: `<platform> <base-image-dir> <ssh-user> <ssh-key> [ssh-timeout]`. Windows path uploads Electron ZIP (`QA_ELECTRON_ZIP` env, default `packages/electron/out/.../PI-Dashboard-win32-x64.zip`) to `C:/qa-artifacts`. Runs `run-all.ps1` (Windows) / `run-all.sh` (Unix). trap cleanup destroys clone on exit. |
| `vm-clone.sh` | Linked-clone a VMware base image via `vmrun clone`. Args: `<base-image-dir> <clone-name> [gui]`. Locates `.vmx`, starts clone `nogui` (default) or `gui`. Emits clone `.vmx` path to stdout for command substitution. |
| `vm-destroy.sh` | Destroy cloned VMs via `vmrun stop hard` + `deleteVM`. Args: `<clone-name>` or `--all`. Operates under `output/clones/`. `--all` removes every clone dir. |
| `vm-wait-ssh.sh` | Poll VMware VM SSH readiness. Args: `<vmx-path> <ssh-user> <ssh-key> [timeout=120]`. Loops `vmrun getGuestIPAddress`, then `ssh -i <key> -o BatchMode=yes` until succeed. Emits VM IP to stdout. |
