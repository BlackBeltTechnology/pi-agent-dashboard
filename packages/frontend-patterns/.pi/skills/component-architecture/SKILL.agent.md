# SKILL.md — component-architecture index

Pull-only condensed map. Source: packages/frontend-patterns/.pi/skills/component-architecture/SKILL.md. Component pattern → folder/props/classes.

## Folder Structure
- 7 subdirs — `ui/` shadcn base (button.tsx, card.tsx); `layout/` (Header, Footer, MobileNav, LanguageSwitcher); `sections/` (Hero, TrustRow, ServicesPreview, AboutPreview, LeadCapture); `cards/` (ServiceCard, ProgrammeCard, TestimonialCard, PricingCard); `forms/` (ContactForm, BookingForm, LeadCaptureForm); `shared/` (Container, SectionHeader, CTAButton, Breadcrumbs); `seo/` (JsonLd, OrganizationJsonLd).

## Component Template
- ServiceCard — `interface ServiceCardProps { service: Service; locale: string }`; Card/CardHeader/CardContent/CardTitle from `@/components/ui/card`.
- Styling hooks — `group hover:shadow-lg transition-shadow`; badges `variant="secondary"` / `variant="outline"`; link arrow `group-hover:translate-x-1`.

## Section Component Pattern
- ServicesPreview — async server component; `getTranslations({ locale, namespace })`, `getServices(locale)`, featured = `slice(0, 4)`.
- Layout — `<section className="py-16 md:py-24">` + Container + `SectionHeader centered`; card grid `md:grid-cols-2 lg:grid-cols-4`; CTAButton `variant="outline"`.

## Shared Components
- Container — `size?: 'default'|'narrow'|'wide'` → `max-w-7xl`/`max-w-4xl`/`max-w-screen-2xl`; `mx-auto px-4 md:px-6`; cn() merge.
- SectionHeader — `title, subtitle?, centered?, className?`; `text-3xl md:text-4xl font-bold tracking-tight`.
- CTAButton — extends ButtonProps + `href, showArrow?`; `Button asChild` wrapping Link.

## Composition Pattern
- Compound component — `PricingCard` + statics `PricingCard.Header` (`title, price, period?`) + `PricingCard.Features` (`features: string[]`).
- featured — `featured ? 'border-primary shadow-lg' : ''`; usage nests `.Header`/`.Features` inside `<PricingCard featured>`.

## Props Interface Conventions
- Grouped order — Content, Data, Variants, State, Styling, Events, i18n, Children.
- Content — `title: string; subtitle?: string; description?: string`.
- Data — `items: Item[]; data?: DataType`.
- Variants — `variant?: 'default'|'primary'|'secondary'; size?: 'sm'|'md'|'lg'`.
- State — `isLoading?: boolean; disabled?: boolean`.
- Styling + Events — `className?: string`; `onClick?: () => void; onSubmit?: (data: FormData) => void`.
- i18n + Children — `locale: string`; `children?: React.ReactNode`.

## Empty States
- EmptyState — `{ title, description?, action? }`; `text-center py-12`, action `mt-6`.
