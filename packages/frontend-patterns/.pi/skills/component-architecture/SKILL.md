---
name: component-architecture
description: Reusable component patterns for cards, sections, forms, and layouts with consistent prop interfaces and composition strategies. Use when creating new components, refactoring existing ones, or establishing component design patterns.
---

# Component Architecture

## Folder Structure

```
components/
├── ui/                    # shadcn/ui base components
│   ├── button.tsx
│   ├── card.tsx
│   └── ...
├── layout/               # Page structure components
│   ├── Header.tsx
│   ├── Footer.tsx
│   ├── MobileNav.tsx
│   └── LanguageSwitcher.tsx
├── sections/             # Home page sections
│   ├── Hero.tsx
│   ├── TrustRow.tsx
│   ├── ServicesPreview.tsx
│   ├── AboutPreview.tsx
│   └── LeadCapture.tsx
├── cards/                # Reusable card components
│   ├── ServiceCard.tsx
│   ├── ProgrammeCard.tsx
│   ├── TestimonialCard.tsx
│   └── PricingCard.tsx
├── forms/                # Form components
│   ├── ContactForm.tsx
│   ├── BookingForm.tsx
│   └── LeadCaptureForm.tsx
├── shared/               # Utility components
│   ├── Container.tsx
│   ├── SectionHeader.tsx
│   ├── CTAButton.tsx
│   └── Breadcrumbs.tsx
└── seo/                  # SEO components
    ├── JsonLd.tsx
    └── OrganizationJsonLd.tsx
```

## Component Template

```tsx
// components/cards/ServiceCard.tsx
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Service } from '@/types';

interface ServiceCardProps {
  service: Service;
  locale: string;
}

export function ServiceCard({ service, locale }: ServiceCardProps) {
  return (
    <Card className="group hover:shadow-lg transition-shadow">
      <CardHeader>
        <div className="flex items-start justify-between">
          <CardTitle className="text-xl">{service.name}</CardTitle>
          <Badge variant="secondary">{service.duration}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground">{service.shortDesc}</p>
        
        <div className="flex flex-wrap gap-2">
          {service.tags.map((tag) => (
            <Badge key={tag} variant="outline" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
        
        <div className="flex items-center justify-between pt-4 border-t">
          <span className="font-semibold">From €{service.priceFrom}</span>
          <Link
            href={`/${locale}/services/${service.slug}`}
            className="flex items-center gap-1 text-primary hover:underline"
          >
            Learn more
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
```

## Section Component Pattern

```tsx
// components/sections/ServicesPreview.tsx
import { getTranslations } from 'next-intl/server';
import { getServices } from '@/lib/data';
import { Container } from '@/components/shared/Container';
import { SectionHeader } from '@/components/shared/SectionHeader';
import { ServiceCard } from '@/components/cards/ServiceCard';
import { CTAButton } from '@/components/shared/CTAButton';
import type { Locale } from '@/i18n.config';

interface ServicesPreviewProps {
  locale: Locale;
}

export async function ServicesPreview({ locale }: ServicesPreviewProps) {
  const t = await getTranslations({ locale, namespace: 'home.services' });
  const services = await getServices(locale);
  const featured = services.slice(0, 4);

  return (
    <section className="py-16 md:py-24">
      <Container>
        <SectionHeader
          title={t('title')}
          subtitle={t('subtitle')}
          centered
        />
        
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mt-12">
          {featured.map((service) => (
            <ServiceCard
              key={service.slug}
              service={service}
              locale={locale}
            />
          ))}
        </div>
        
        <div className="flex justify-center mt-12">
          <CTAButton href={`/${locale}/services`} variant="outline">
            {t('viewAll')}
          </CTAButton>
        </div>
      </Container>
    </section>
  );
}
```

## Shared Components

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
  size = 'default',
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

```tsx
// components/shared/SectionHeader.tsx
import { cn } from '@/lib/utils';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  centered?: boolean;
  className?: string;
}

export function SectionHeader({
  title,
  subtitle,
  centered = false,
  className,
}: SectionHeaderProps) {
  return (
    <div className={cn(centered && 'text-center', className)}>
      <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
          {subtitle}
        </p>
      )}
    </div>
  );
}
```

```tsx
// components/shared/CTAButton.tsx
import Link from 'next/link';
import { Button, type ButtonProps } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';

interface CTAButtonProps extends ButtonProps {
  href: string;
  children: React.ReactNode;
  showArrow?: boolean;
}

export function CTAButton({
  href,
  children,
  showArrow = false,
  ...props
}: CTAButtonProps) {
  return (
    <Button asChild {...props}>
      <Link href={href} className="gap-2">
        {children}
        {showArrow && <ArrowRight className="w-4 h-4" />}
      </Link>
    </Button>
  );
}
```

## Composition Pattern

```tsx
// Compound components for flexibility
// components/cards/PricingCard.tsx
import { Card, CardContent, CardHeader } from '@/components/ui/card';

interface PricingCardProps {
  children: React.ReactNode;
  featured?: boolean;
}

export function PricingCard({ children, featured }: PricingCardProps) {
  return (
    <Card className={featured ? 'border-primary shadow-lg' : ''}>
      {children}
    </Card>
  );
}

PricingCard.Header = function PricingCardHeader({
  title,
  price,
  period,
}: {
  title: string;
  price: number;
  period?: string;
}) {
  return (
    <CardHeader className="text-center">
      <h3 className="text-xl font-semibold">{title}</h3>
      <div className="mt-4">
        <span className="text-4xl font-bold">€{price}</span>
        {period && <span className="text-muted-foreground">/{period}</span>}
      </div>
    </CardHeader>
  );
};

PricingCard.Features = function PricingCardFeatures({
  features,
}: {
  features: string[];
}) {
  return (
    <CardContent>
      <ul className="space-y-3">
        {features.map((feature, i) => (
          <li key={i} className="flex items-center gap-2">
            <CheckIcon className="w-4 h-4 text-primary" />
            {feature}
          </li>
        ))}
      </ul>
    </CardContent>
  );
};

// Usage
<PricingCard featured>
  <PricingCard.Header title="10-Pack" price={650} />
  <PricingCard.Features features={['10 sessions', 'Valid 6 months']} />
</PricingCard>
```

## Props Interface Conventions

```tsx
// Consistent prop naming
interface ComponentProps {
  // Content
  title: string;
  subtitle?: string;
  description?: string;
  
  // Data
  items: Item[];
  data?: DataType;
  
  // Variants
  variant?: 'default' | 'primary' | 'secondary';
  size?: 'sm' | 'md' | 'lg';
  
  // State
  isLoading?: boolean;
  disabled?: boolean;
  
  // Styling
  className?: string;
  
  // Events
  onClick?: () => void;
  onSubmit?: (data: FormData) => void;
  
  // i18n
  locale: string;
  
  // Children
  children?: React.ReactNode;
}
```

## Empty States

```tsx
// components/shared/EmptyState.tsx
interface EmptyStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="text-center py-12">
      <h3 className="text-lg font-medium">{title}</h3>
      {description && (
        <p className="mt-2 text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
```
