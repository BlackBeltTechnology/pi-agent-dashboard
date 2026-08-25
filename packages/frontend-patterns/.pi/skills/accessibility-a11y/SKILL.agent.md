# SKILL.md — accessibility-a11y index

Pull-only condensed map. Source: packages/frontend-patterns/.pi/skills/accessibility-a11y/SKILL.md. a11y concern → element/ARIA/WCAG rule.

## Semantic HTML
- Landmarks — `<header>`, `<nav>`, `<main>` (one per page), `<article>`, `<section>` (thematic + heading), `<aside>`, `<footer>`.
- Headings — one `<h1>` per page, nested h2 → h3.
- Nav lists — `<nav><ul><li><a>`.

## Skip Link
- SkipLink — `sr-only focus:not-sr-only` + `focus:absolute focus:top-4 focus:left-4 focus:z-50`; target `<main id="main-content" tabIndex={-1}>`.

## Focus Management
- Visible focus — `focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`.
- useFocusTrap(isOpen) — focus first focusable on open; Tab wrap last→first, Shift+Tab first→last.
- Focusable selector — `'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'`.

## ARIA Labels
- Icon-only button — `aria-label="Close menu"`.
- Loading — `disabled aria-busy="true"`; Spinner `aria-hidden="true"` + visible text.
- Live region — `aria-live="polite" aria-atomic="true"` for dynamic content.
- Form errors — `aria-invalid` + `aria-describedby`; error `<p role="alert">`.
- Current nav item — `aria-current="page"`.

## Keyboard Navigation
- Key map — Enter/Space select, Escape close, ArrowDown/ArrowUp focusNext/focusPrevious; `preventDefault()`.
- Roving tabindex — `role="menuitem"`, `tabIndex={isSelected ? 0 : -1}`.

## Color Contrast
- WCAG AA — normal text 4.5:1; large text (18px+ or 14px+ bold) 3:1; UI components 3:1.
- Avoid `text-gray-400 bg-gray-100`; verify DevTools → Accessibility panel.

## Screen Reader Text
- sr-only for hidden-but-announced text (e.g. "Opens in new tab").
- Icon links — `aria-label` + icon `aria-hidden="true"`.
- Decorative img — `alt="" aria-hidden="true"`; meaningful img — descriptive alt.

## Form Accessibility
- Form — `aria-labelledby="form-title"` + `<h2 id="form-title">`.
- Required — `*` `aria-hidden="true"` + sr-only "(required)"; input `aria-required`, `aria-invalid`, `aria-describedby` → hint/error ids.
- Errors — `<p role="alert" className="text-destructive">`.

## Accordion Accessibility
- Toggle — `aria-expanded` + `aria-controls`; panel `role="region"` `aria-labelledby` + `hidden={openIndex !== index}`.

## Reduced Motion
- framer-motion — `useReducedMotion()`; duration 0 vs 0.5.
- CSS — `@media (prefers-reduced-motion: reduce) { * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important } }`.

## Testing Checklist
1. Keyboard-only nav (Tab, Enter, Escape, Arrows).
2. Screen reader — VoiceOver, NVDA.
3. Color contrast ratios.
4. Visible focus indicators.
5. 200% zoom.
6. Heading hierarchy.
7. Form labels + error messages.
8. Reduced-motion preference.
