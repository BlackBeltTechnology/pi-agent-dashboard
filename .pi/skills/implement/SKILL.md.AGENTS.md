# implement/SKILL.md — index

Skill: disciplined implementation. Pairs code-discipline rules (TDD, simplicity, surgical) with 3-component rebuild matrix — extension→`npm run reload`, server→`POST /api/restart` (no build, jiti), client→Vite HMR (dev) or `npm run build`+restart (prod), openspec-apply→`full-rebuild.ts`. Decision tree + quick scripts (`check-mode.ts`, `restart-server.ts`, `full-rebuild.ts`, `review-changes.ts`). Tee→grep test pattern. Routes debugging to `debug-dashboard`, CI red to `ci-troubleshoot`.
