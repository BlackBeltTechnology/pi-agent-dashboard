# Test Plan — electron-local-link-node-compat

Stage: design   Generated: 2026-09-28

| # | Scenario | Technique | Level | Disposition | Input | Trigger | Observable |
|---|---|---|---|---|---|---|---|
| N1 | Native module built for another Node | EP | L1 | automated | checkout fixture whose `node-pty` targets a different ABI | local preflight | refused, reason names the mismatch + rebuild command; no spawn |
| N2 | Matching checkout | EP | L1 | automated | checkout fixture matching the running Node | local preflight | accepted |
