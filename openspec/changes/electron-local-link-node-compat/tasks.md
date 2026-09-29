## 1. Spike

- [ ] 1.1 (moved from electron-runtime-overlay-updates 1.2) Spike: run a pnpm-installed monorepo checkout under the shell's bundled Node (same and different major as the system Node). Record node-pty behaviour and decide between "preflight refuses on mismatch", an ABI check, and "link may use system Node". Write the result into design.md Decisions.

## 2. Implement

- [ ] 2.1 Implement the decided rule in `preflightLocal` / `gateRuntimeRoot` (test first: mismatch fixture refused with reason + fix command; matching checkout accepted).
- [ ] 2.2 Update `docs/electron-bootstrap-flow.md` and the FAQ entry "How do I run my checkout inside the Electron app?".
