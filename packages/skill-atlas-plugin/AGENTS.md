# DOX — packages/skill-atlas-plugin

Files in this directory. One row per source file. See change: add-skill-atlas-screen.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. Relation rules, surfaces (folder menu, Settings ▸ Resources, Skills-page section, `/atlas`), graph route + host seam requirements. |
| `package.json` | pi-dashboard-plugin manifest. id `skill-atlas`, priority 100. Claims `resource-page-section` (`resourceType: skill`)→`SkillAtlasSection`, `sidebar-folder-section`→`FolderAtlasMenu`, `shell-overlay-route` `/folder/:encodedCwd/atlas/*?` (depth 2, content)→`ProjectAtlasClaim` + `/atlas/*?` (depth 1, content)→`GlobalAtlasClaim`, `settings-section` nav `{group: resources}`→`SkillAtlasSettings`. Exports `./shared` (pure builder). |
| `tsconfig.json` | Extends base; jsx react-jsx; noEmit. |
| `vitest.config.ts` | Vitest project: jsdom, forks, react plugin, worktree-local shared alias (kb-plugin copy). |
