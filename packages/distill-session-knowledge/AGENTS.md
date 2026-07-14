# DOX — packages/distill-session-knowledge

Files in this directory. One row per source file.
Thin pi-skill package `@blackbelt-technology/pi-dashboard-distill-session-knowledge` (public, MIT). Registers the `distill-session-knowledge` skill; deps the engine `packages/session-distiller`. Moved from root `.pi/skills/` — sole source. Cut together with the engine (same release). See change: extract-distill-session-knowledge-package.

| File | Purpose |
|------|---------|
| `NOTICE` | Copyright + MIT notice. Skill-only package; engine ships separately. |
| `README.md` | Public npm readme. Install + NL triggers; points at engine package. |
| `package.json` | Public: `pi.skills=[".pi/skills/distill-session-knowledge"]`, `publishConfig.access=public`, MIT, `files[]` (.pi/skills/ README NOTICE), `dependencies["@blackbelt-technology/pi-dashboard-session-distiller"]=^` (engine, workspace-linked in-repo). |
| `.pi/skills/distill-session-knowledge/SKILL.md` | The skill. NL-triggered miner discipline; invokes engine via published `distill-session-knowledge` bin (no repo-relative path). |
