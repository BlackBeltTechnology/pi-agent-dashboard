# SKILL.md — theme-system index

Pull-only condensed map. Source: .pi/skills/theme-system/SKILL.md. CSS custom-property theme architecture; 4 themes via `data-theme` attribute. Retrieval keys: theme ids (`studio` `earth` `athlete` `gradient`), CSS variable names.

Values = space-separated HSL triplets, consumed as `hsl(var(--primary))`.

## Theme Definitions
- `app/globals.css` `@layer base`; `:root` = Studio defaults; each theme overrides via `[data-theme="<id>"]` block.
- Shared variable set — `--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`, `--primary`, `--primary-foreground`, `--secondary`, `--secondary-foreground`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`, `--border`, `--input`, `--ring`. `:root` also `--destructive`, `--destructive-foreground`, `--radius: 0.5rem`.
- earth — "Soft organic warmth"; warm hues; `--background: 40 33% 98%`, `--primary: 30 30% 35%`.
- studio — "Clean minimal"; grays; `--background: 0 0% 100%`, `--primary: 0 0% 8%`.
- athlete — "Bold with purple accent"; `--primary: 270 60% 50%`, `--ring: 270 60% 50%`.
- gradient — "Soft gradient hero"; blue `--primary: 220 80% 55%`; adds `--gradient-start: 220 80% 60%`, `--gradient-end: 280 60% 65%`.

## Theme Configuration
- `lib/theme.ts` — `export const themes = ['studio', 'earth', 'athlete', 'gradient'] as const`; `type Theme = (typeof themes)[number]`; `defaultTheme: Theme = 'studio'`; `isValidTheme(theme)` type guard.

## Theme Provider
- `components/ThemeProvider.tsx` — `'use client'`; React context `{ theme, setTheme }`.
- Init order — URL `?theme=` param first, then `localStorage.getItem('theme')`; both validated via `isValidTheme`, applied to `document.documentElement` `data-theme`.
- `setTheme` — set state + `setAttribute('data-theme', t)` + `localStorage.setItem('theme', t)` + URL `searchParams.set('theme', t)` via `history.replaceState` (no reload).
- `useTheme()` throws "must be used within ThemeProvider" outside provider.

## Theme Switcher (Dev Mode)
- `components/ThemeSwitcher.tsx` — dev-only; returns `null` when `process.env.NODE_ENV === 'production'`; fixed bottom-right buttons; labels Studio/Earth/Athlete/Gradient; active = `bg-primary text-primary-foreground`.

## Theme-Aware Components
- `components/Hero.tsx` — theme-conditional classes; gradient → `bg-gradient-to-br from-[hsl(var(--gradient-start))] to-[hsl(var(--gradient-end))]` + `backdrop-blur-sm bg-background/30` overlay; earth → `bg-[url("/patterns/wave.svg")] bg-cover`.

## Background Ornaments
- `components/BackgroundOrnament.tsx` — studio → `null` (minimal); earth → organic wave SVG top-right (`text-accent/30`); athlete → top `h-2 bg-primary` bar; gradient → `null`.

## Layout Integration
- `app/[locale]/layout.tsx` — wrap children in `<ThemeProvider>`; render `<ThemeSwitcher />` beside.

## Preview via URL
- `?theme=studio` clean minimal; `?theme=earth` soft organic; `?theme=athlete` bold purple; `?theme=gradient` gradient hero.
