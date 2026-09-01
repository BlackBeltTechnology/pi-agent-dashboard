# SKILL.md — responsive-mobile-first index

Pull-only condensed map. Source: packages/frontend-patterns/.pi/skills/responsive-mobile-first/SKILL.md. Responsive need → Tailwind classes/breakpoints.

## Breakpoint Strategy
- Tailwind defaults (mobile-first) — sm 640px, md 768px, lg 1024px, xl 1280px, 2xl 1536px.
- Rule — base styles mobile, add breakpoints for larger screens.

## Sticky Header
- Header — `'use client'`; `isScrolled = window.scrollY > 10`; `fixed top-0 left-0 right-0 z-50`; scrolled → `bg-background/95 backdrop-blur-sm shadow-sm`.
- Nav — `container mx-auto px-4 h-16 flex items-center justify-between`; desktop nav `hidden md:flex`; mobile menu button `md:hidden`.

## Mobile Navigation Drawer
- MobileNav — open state + framer-motion `AnimatePresence`; backdrop `fixed inset-0 bg-black/50 z-50 md:hidden` click-closes.
- Drawer — `fixed top-0 right-0 bottom-0 w-80 bg-background z-50 md:hidden`; `x: '100%' → 0` tween 0.3s; close button `aria-label="Close menu"`.
- Bottom CTA — `absolute bottom-8 left-4 right-4`, full-width Button `size="lg"`.

## Floating Mobile CTA
- FloatingCTA — visible after `window.scrollY > 500`; `fixed bottom-6 left-4 right-4 z-40 md:hidden`; y 100→0; `rounded-full`.

## Responsive Grid Patterns
- 1-2-3 columns — `grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6`.
- Sidebar — `flex flex-col lg:flex-row gap-8`; aside `w-full lg:w-80`.
- Hero text/image — `flex flex-col-reverse md:flex-row`; image `w-full md:w-1/2`.

## Touch-Friendly Targets
- Minimum — `min-h-[44px] min-w-[44px]` (44x44px); `flex gap-3` spacing; card Link `block p-4 md:p-6`.

## Responsive Typography
- h1 — `text-3xl md:text-4xl lg:text-5xl xl:text-6xl font-bold`; h2 — `text-2xl md:text-3xl lg:text-4xl font-semibold`.
- Body — `text-base md:text-lg leading-relaxed`; small — `text-xs md:text-sm text-muted-foreground`.

## Responsive Spacing
- Section — `py-12 md:py-16 lg:py-24`; container — `px-4 md:px-6 lg:px-8`; stack — `space-y-4 md:space-y-6 lg:space-y-8`.

## Hide/Show Utilities
- Mobile only — `block md:hidden`; desktop only — `hidden md:block`; text switch — `md:hidden` / `hidden md:inline`.

## Responsive Images
- Full-width — next/image `fill` `object-cover` in `relative aspect-video w-full`; `sizes="100vw"` `priority`.
- Responsive sizes — `sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"`.

## Container Component
- Container — `size?: 'default'|'narrow'|'wide'` → `max-w-7xl`/`max-w-4xl`/`max-w-screen-2xl`; `mx-auto px-4 md:px-6`; cn() merge.
