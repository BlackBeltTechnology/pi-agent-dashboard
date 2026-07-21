# DOX — packages/frontend-patterns

Files in this directory. One row per source file. Pure-skill package (React/Tailwind/shadcn patterns). SKILL.md rows carry a `.md.AGENTS.md` sidecar (full detail, pull-only).

| File | Purpose |
|------|---------|
| `.pi/skills/accessibility-a11y/SKILL.md` | A11y patterns: semantic HTML, skip links, focus traps (`useFocusTrap`), ARIA labels, keyboard nav, WCAG contrast. → see `.pi/skills/accessibility-a11y/SKILL.md.AGENTS.md` |
| `.pi/skills/component-architecture/SKILL.md` | Reusable component patterns: folder structure (`ui/layout/sections/cards/forms/shared/seo`), consistent prop interfaces, composition. → see `.pi/skills/component-architecture/SKILL.md.AGENTS.md` |
| `.pi/skills/responsive-mobile-first/SKILL.md` | Mobile-first responsive patterns: sticky headers, mobile drawer, floating CTA, responsive grids, touch targets. → see `.pi/skills/responsive-mobile-first/SKILL.md.AGENTS.md` |
| `.pi/skills/tailwind-shadcn/SKILL.md` | Tailwind + shadcn/ui patterns. Install via `npx shadcn@latest init` / `add <component>`; theming via CSS variables. → see `.pi/skills/tailwind-shadcn/SKILL.md.AGENTS.md` |
| `.pi/skills/typescript-strict/SKILL.md` | TypeScript strict patterns. Config: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`; type guards, generics. → see `.pi/skills/typescript-strict/SKILL.md.AGENTS.md` |
| `.pi/skills/zod-react-hook-form/SKILL.md` | Form validation = Zod schemas + React Hook Form. Schemas in `lib/validations.ts`; localized errors; Server Action integration. → see `.pi/skills/zod-react-hook-form/SKILL.md.AGENTS.md` |
| `README.md` | Package overview. Frontend implementation-pattern skills for pi sessions. Pure-skill package (manifest only, no `extension.ts`). Works in any React/Tailwind/shadcn project. |
