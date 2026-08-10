---
name: responsive-mobile-first
description: Mobile-first responsive patterns with sticky headers, floating CTAs, accessible navigation, and touch-friendly interactions. Use when implementing responsive layouts, mobile navigation, or ensuring touch-friendly UI.
---

# Responsive Mobile-First

## Breakpoint Strategy

```tsx
// Tailwind default breakpoints (mobile-first)
// sm: 640px
// md: 768px
// lg: 1024px
// xl: 1280px
// 2xl: 1536px

// Write base styles for mobile, add breakpoints for larger screens
<div className="
  px-4 md:px-6 lg:px-8        // Padding increases
  text-sm md:text-base         // Font size scales
  grid-cols-1 md:grid-cols-2   // Grid expands
">
```

## Sticky Header

```tsx
// components/layout/Header.tsx
'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';

export function Header() {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 10);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <header
      className={cn(
        'fixed top-0 left-0 right-0 z-50 transition-all duration-300',
        isScrolled
          ? 'bg-background/95 backdrop-blur-sm shadow-sm'
          : 'bg-transparent'
      )}
    >
      <nav className="container mx-auto px-4 h-16 flex items-center justify-between">
        <Logo />
        
        {/* Desktop Navigation */}
        <div className="hidden md:flex items-center gap-6">
          <NavLinks />
          <Button>Book Now</Button>
        </div>
        
        {/* Mobile Menu Button */}
        <MobileMenuButton className="md:hidden" />
      </nav>
    </header>
  );
}
```

## Mobile Navigation Drawer

```tsx
'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Menu } from 'lucide-react';

export function MobileNav() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="md:hidden p-2"
        aria-label="Open menu"
      >
        <Menu className="w-6 h-6" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 bg-black/50 z-50 md:hidden"
            />
            
            {/* Drawer */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.3 }}
              className="fixed top-0 right-0 bottom-0 w-80 bg-background z-50 md:hidden"
            >
              <div className="p-4 flex justify-end">
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-2"
                  aria-label="Close menu"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
              
              <nav className="px-4 space-y-4">
                <NavLink href="/" onClick={() => setIsOpen(false)}>
                  Home
                </NavLink>
                <NavLink href="/services" onClick={() => setIsOpen(false)}>
                  Services
                </NavLink>
                {/* More links */}
              </nav>
              
              <div className="absolute bottom-8 left-4 right-4">
                <Button className="w-full" size="lg">
                  Book a Session
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
```

## Floating Mobile CTA

```tsx
// components/FloatingCTA.tsx
'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { useLocale } from 'next-intl';

export function FloatingCTA() {
  const [isVisible, setIsVisible] = useState(false);
  const locale = useLocale();

  useEffect(() => {
    const handleScroll = () => {
      // Show after scrolling past hero
      setIsVisible(window.scrollY > 500);
    };
    
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          className="fixed bottom-6 left-4 right-4 z-40 md:hidden"
        >
          <Link
            href={`/${locale}/book`}
            className="block w-full bg-primary text-primary-foreground text-center py-4 rounded-full font-medium shadow-lg"
          >
            Book a Session
          </Link>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

## Responsive Grid Patterns

```tsx
// 1-2-3 column grid
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
  {items.map(item => <Card key={item.id} {...item} />)}
</div>

// Sidebar layout
<div className="flex flex-col lg:flex-row gap-8">
  <main className="flex-1">{/* Main content */}</main>
  <aside className="w-full lg:w-80">{/* Sidebar */}</aside>
</div>

// Hero with text/image
<div className="flex flex-col-reverse md:flex-row items-center gap-8">
  <div className="flex-1">{/* Text content */}</div>
  <div className="w-full md:w-1/2">{/* Image */}</div>
</div>
```

## Touch-Friendly Targets

```tsx
// Minimum 44x44px touch targets
<button className="min-h-[44px] min-w-[44px] p-3">
  <Icon className="w-5 h-5" />
</button>

// Adequate spacing between interactive elements
<div className="flex gap-3">
  <Button>Primary</Button>
  <Button variant="outline">Secondary</Button>
</div>

// Large tap areas for cards
<Link href={href} className="block p-4 md:p-6">
  <Card />
</Link>
```

## Responsive Typography

```tsx
// Heading scale
<h1 className="text-3xl md:text-4xl lg:text-5xl xl:text-6xl font-bold">
  Main Heading
</h1>

<h2 className="text-2xl md:text-3xl lg:text-4xl font-semibold">
  Section Heading
</h2>

// Body text
<p className="text-base md:text-lg leading-relaxed">
  Body content with comfortable reading line height.
</p>

// Small text
<span className="text-xs md:text-sm text-muted-foreground">
  Caption or meta text
</span>
```

## Responsive Spacing

```tsx
// Section padding
<section className="py-12 md:py-16 lg:py-24">

// Container with responsive padding
<div className="container mx-auto px-4 md:px-6 lg:px-8">

// Stack spacing
<div className="space-y-4 md:space-y-6 lg:space-y-8">
```

## Hide/Show Utilities

```tsx
// Show only on mobile
<div className="block md:hidden">Mobile only</div>

// Show only on desktop
<div className="hidden md:block">Desktop only</div>

// Different content per breakpoint
<span className="md:hidden">Menu</span>
<span className="hidden md:inline">Navigation</span>
```

## Responsive Images

```tsx
import Image from 'next/image';

// Full-width responsive image
<div className="relative aspect-video w-full">
  <Image
    src="/hero.jpg"
    alt="Hero"
    fill
    className="object-cover"
    sizes="100vw"
    priority
  />
</div>

// Responsive sizes attribute
<Image
  src="/service.jpg"
  alt="Service"
  fill
  sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
/>
```

## Container Component

```tsx
// components/shared/Container.tsx
import { cn } from '@/lib/utils';

interface ContainerProps {
  children: React.ReactNode;
  className?: string;
  size?: 'default' | 'narrow' | 'wide';
}

export function Container({ 
  children, 
  className,
  size = 'default' 
}: ContainerProps) {
  return (
    <div
      className={cn(
        'mx-auto px-4 md:px-6',
        {
          'max-w-7xl': size === 'default',
          'max-w-4xl': size === 'narrow',
          'max-w-screen-2xl': size === 'wide',
        },
        className
      )}
    >
      {children}
    </div>
  );
}
```
