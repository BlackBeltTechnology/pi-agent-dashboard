---
name: accessibility-a11y
description: Semantic HTML, keyboard navigation, focus states, ARIA labels, skip links, and WCAG contrast requirements. Use when ensuring accessibility compliance, implementing keyboard navigation, or adding screen reader support.
---

# Accessibility (a11y)

## Semantic HTML

```tsx
// Use semantic elements
<header>       {/* Site header */}
<nav>          {/* Navigation */}
<main>         {/* Main content - one per page */}
<article>      {/* Self-contained content */}
<section>      {/* Thematic grouping with heading */}
<aside>        {/* Sidebar content */}
<footer>       {/* Site footer */}

// Correct heading hierarchy
<h1>Page Title</h1>           {/* One per page */}
  <h2>Section</h2>
    <h3>Subsection</h3>
  <h2>Another Section</h2>

// Lists for navigation
<nav>
  <ul>
    <li><a href="/">Home</a></li>
    <li><a href="/about">About</a></li>
  </ul>
</nav>
```

## Skip Link

```tsx
// components/layout/SkipLink.tsx
export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="
        sr-only focus:not-sr-only
        focus:absolute focus:top-4 focus:left-4
        focus:z-50 focus:px-4 focus:py-2
        focus:bg-primary focus:text-primary-foreground
        focus:rounded
      "
    >
      Skip to main content
    </a>
  );
}

// In layout
<body>
  <SkipLink />
  <Header />
  <main id="main-content" tabIndex={-1}>
    {children}
  </main>
</body>
```

## Focus Management

```tsx
// Visible focus states (Tailwind)
<button className="
  focus:outline-none
  focus-visible:ring-2
  focus-visible:ring-ring
  focus-visible:ring-offset-2
">

// Focus trap for modals
import { useEffect, useRef } from 'react';

function useFocusTrap(isOpen: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    
    const container = containerRef.current;
    if (!container) return;

    const focusableElements = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    
    const firstElement = focusableElements[0] as HTMLElement;
    const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement.focus();
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    };

    firstElement?.focus();
    container.addEventListener('keydown', handleKeyDown);
    
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  return containerRef;
}
```

## ARIA Labels

```tsx
// Buttons with icons only
<button aria-label="Close menu">
  <X className="w-5 h-5" />
</button>

// Loading states
<button disabled aria-busy="true">
  <Spinner aria-hidden="true" />
  <span>Submitting...</span>
</button>

// Live regions for dynamic content
<div aria-live="polite" aria-atomic="true">
  {statusMessage}
</div>

// Form errors
<input
  id="email"
  aria-invalid={hasError}
  aria-describedby={hasError ? 'email-error' : undefined}
/>
{hasError && (
  <p id="email-error" role="alert">
    Please enter a valid email
  </p>
)}

// Current page in navigation
<nav aria-label="Main navigation">
  <a href="/" aria-current={isHome ? 'page' : undefined}>Home</a>
  <a href="/about" aria-current={isAbout ? 'page' : undefined}>About</a>
</nav>
```

## Keyboard Navigation

```tsx
// Custom keyboard handlers
function handleKeyDown(e: React.KeyboardEvent) {
  switch (e.key) {
    case 'Enter':
    case ' ':
      e.preventDefault();
      handleSelect();
      break;
    case 'Escape':
      handleClose();
      break;
    case 'ArrowDown':
      e.preventDefault();
      focusNext();
      break;
    case 'ArrowUp':
      e.preventDefault();
      focusPrevious();
      break;
  }
}

// Roving tabindex for menu items
function MenuItem({ isSelected, ...props }) {
  return (
    <button
      role="menuitem"
      tabIndex={isSelected ? 0 : -1}
      {...props}
    />
  );
}
```

## Color Contrast

```tsx
// WCAG AA requirements:
// - Normal text: 4.5:1 ratio
// - Large text (18px+ or 14px+ bold): 3:1 ratio
// - UI components: 3:1 ratio

// Use contrast-safe color combinations
// ✅ Good
<p className="text-foreground bg-background">       {/* High contrast */}
<p className="text-muted-foreground bg-background"> {/* Adequate for large text */}

// ❌ Avoid
<p className="text-gray-400 bg-gray-100">           {/* Poor contrast */}

// Test with browser DevTools → Accessibility panel
```

## Screen Reader Text

```tsx
// Visually hidden but announced
<span className="sr-only">
  Opens in new tab
</span>

// Icon with hidden label
<a href="/facebook" aria-label="Facebook">
  <Facebook aria-hidden="true" />
</a>

// Decorative images
<img src="/decoration.svg" alt="" aria-hidden="true" />

// Meaningful images
<img src="/team.jpg" alt="Our team of certified instructors" />
```

## Form Accessibility

```tsx
// Complete accessible form
<form onSubmit={handleSubmit} aria-labelledby="form-title">
  <h2 id="form-title">Contact Us</h2>
  
  <div>
    <label htmlFor="name">
      Name <span aria-hidden="true">*</span>
      <span className="sr-only">(required)</span>
    </label>
    <input
      id="name"
      name="name"
      type="text"
      required
      aria-required="true"
      aria-invalid={errors.name ? 'true' : 'false'}
      aria-describedby={errors.name ? 'name-error' : 'name-hint'}
    />
    <p id="name-hint" className="text-sm text-muted-foreground">
      Enter your full name
    </p>
    {errors.name && (
      <p id="name-error" role="alert" className="text-destructive">
        {errors.name}
      </p>
    )}
  </div>
  
  <button type="submit">
    Submit
  </button>
</form>
```

## Accordion Accessibility

```tsx
// Accessible accordion pattern
function Accordion({ items }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div>
      {items.map((item, index) => (
        <div key={index}>
          <h3>
            <button
              id={`accordion-header-${index}`}
              aria-expanded={openIndex === index}
              aria-controls={`accordion-panel-${index}`}
              onClick={() => setOpenIndex(openIndex === index ? null : index)}
              className="w-full text-left"
            >
              {item.title}
            </button>
          </h3>
          <div
            id={`accordion-panel-${index}`}
            role="region"
            aria-labelledby={`accordion-header-${index}`}
            hidden={openIndex !== index}
          >
            {item.content}
          </div>
        </div>
      ))}
    </div>
  );
}
```

## Reduced Motion

```tsx
// Respect user preferences
import { useReducedMotion } from 'framer-motion';

function AnimatedComponent() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      animate={{ y: 0, opacity: 1 }}
      transition={{
        duration: shouldReduceMotion ? 0 : 0.5,
      }}
    >
      Content
    </motion.div>
  );
}

// CSS approach
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

## Testing Checklist

1. Navigate entire site with keyboard only (Tab, Enter, Escape, Arrows)
2. Test with screen reader (VoiceOver, NVDA)
3. Check color contrast ratios
4. Verify focus indicators are visible
5. Test at 200% zoom
6. Check heading hierarchy
7. Verify form labels and error messages
8. Test with reduced motion preference
