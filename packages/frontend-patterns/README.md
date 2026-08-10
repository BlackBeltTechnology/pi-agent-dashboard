# @blackbelt-technology/pi-dashboard-frontend-patterns

A pi package — **skills only, no tools** — with frontend implementation
patterns for React / Tailwind / shadcn projects.

Generic: works in any React/Tailwind/shadcn project.

## Install

```bash
pi install npm:@blackbelt-technology/pi-dashboard-frontend-patterns
# or try without installing:
pi -e npm:@blackbelt-technology/pi-dashboard-frontend-patterns
```

## Skills

| Skill | What it does |
|-------|--------------|
| `accessibility-a11y` | Semantic HTML, keyboard navigation, focus states, ARIA labels, skip links, WCAG contrast. |
| `component-architecture` | Reusable component patterns for cards, sections, forms, and layouts with consistent prop interfaces. |
| `responsive-mobile-first` | Mobile-first responsive patterns: sticky headers, floating CTAs, accessible navigation, touch interactions. |
| `tailwind-shadcn` | Tailwind CSS utility patterns with shadcn/ui components, theming via CSS variables, responsive design. |
| `typescript-strict` | TypeScript strict-mode patterns: interfaces, type guards, generics, utility types, nullable handling. |
| `zod-react-hook-form` | Form validation combining Zod schemas with React Hook Form, localized errors, Server Action integration. |

Skills load by natural-language trigger, or explicitly via `/skill:<name>`.

## How loading works

Pure-skill package: `package.json` `pi.skills` points pi at each skill
directory. No `extension.ts`, no build step.

## License

MIT
