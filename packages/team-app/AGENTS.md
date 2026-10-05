# DOX — packages/team-app

Private SPA (Vite + React + wouter) for the AI Team: Csapat grid, project selector, persona editor, conversations. Built to `dist/`, copied into `team-plugin/dist/app`. One row per file. See change: add-team-plugin.

| File | Purpose |
|------|---------|
| `package.json` | Private workspace. `./app` export = `src/team-app.tsx` (library entry). See change: add-team-plugin. |
| `tsconfig.json` | Type-check with `paths` to worktree sibling sources (`app-kit`, `client` chat-embed, `shared`, `client-utils`, runtime, `@dash/*`). See change: add-team-plugin. |
| `vite.config.ts` | Build base `/apps/team/`, Tailwind, dedupe react/wouter, dev proxy `/api` `/ws`. See change: add-team-plugin. |
| `vite.aliases.ts` | Shared vite/vitest aliases to worktree sibling source (hoisted workspace symlinks escape to the main checkout). See change: add-team-plugin. |
| `vitest.config.ts` | jsdom suite config; `src/__tests__/setup.ts` (dialog polyfill, target-store reset). See change: add-team-plugin. |
| `index.html` | Standalone document; loads `src/standalone.tsx`. See change: add-team-plugin. |
