---
name: typescript-strict
description: TypeScript strict mode patterns with interfaces, type guards, generics, and utility types. Use when defining types, creating type-safe functions, handling nullable values, or implementing generic components.
---

# TypeScript Strict Patterns

## Strict Configuration

```json
// tsconfig.json essentials
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

## Interface vs Type

```tsx
// Use interface for objects that may be extended
interface Service {
  slug: string;
  name: string;
  price: number;
}

interface PremiumService extends Service {
  benefits: string[];
}

// Use type for unions, primitives, tuples
type Locale = 'pt-PT' | 'en' | 'tr' | 'es' | 'fr' | 'de';
type DeliveryMode = 'in-person' | 'online' | 'both';
type Coordinates = [number, number];
```

## Type Guards

```tsx
// Custom type guard
function isService(value: unknown): value is Service {
  return (
    typeof value === 'object' &&
    value !== null &&
    'slug' in value &&
    'name' in value
  );
}

// Discriminated unions
type Result<T> = 
  | { success: true; data: T }
  | { success: false; error: string };

function handleResult<T>(result: Result<T>) {
  if (result.success) {
    console.log(result.data); // TypeScript knows data exists
  } else {
    console.error(result.error); // TypeScript knows error exists
  }
}
```

## Generic Patterns

```tsx
// Generic data fetcher
async function fetchData<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch');
  return res.json() as Promise<T>;
}

// Generic component props
interface ListProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  keyExtractor: (item: T) => string;
}

function List<T>({ items, renderItem, keyExtractor }: ListProps<T>) {
  return (
    <ul>
      {items.map((item, i) => (
        <li key={keyExtractor(item)}>{renderItem(item, i)}</li>
      ))}
    </ul>
  );
}
```

## Utility Types

```tsx
// Partial - all properties optional
type ServiceUpdate = Partial<Service>;

// Required - all properties required
type RequiredService = Required<Service>;

// Pick - select specific properties
type ServicePreview = Pick<Service, 'slug' | 'name'>;

// Omit - exclude properties
type ServiceWithoutPrice = Omit<Service, 'price'>;

// Record - key-value mapping
type LocaleMessages = Record<Locale, Record<string, string>>;

// Extract/Exclude for unions
type OnlineDelivery = Extract<DeliveryMode, 'online' | 'both'>;
```

## Nullable Handling

```tsx
// Non-null assertion (use sparingly)
const element = document.getElementById('root')!;

// Optional chaining + nullish coalescing
const name = user?.profile?.name ?? 'Anonymous';

// Type narrowing
function processValue(value: string | null | undefined) {
  if (value == null) return; // Handles both null and undefined
  console.log(value.toUpperCase()); // value is string
}
```

## Component Props Patterns

```tsx
// Props with children
interface ContainerProps {
  children: React.ReactNode;
  className?: string;
}

// Props extending HTML elements
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary';
  loading?: boolean;
}

// Polymorphic component
interface BoxProps<T extends React.ElementType> {
  as?: T;
  children: React.ReactNode;
}

type BoxPropsWithRef<T extends React.ElementType> = BoxProps<T> &
  Omit<React.ComponentPropsWithoutRef<T>, keyof BoxProps<T>>;
```

## Const Assertions

```tsx
// Immutable arrays and objects
const LOCALES = ['pt-PT', 'en', 'tr', 'es', 'fr', 'de'] as const;
type Locale = typeof LOCALES[number]; // 'pt-PT' | 'en' | ...

const THEME_CONFIG = {
  studio: { bg: '#ffffff', accent: '#000000' },
  earth: { bg: '#faf9f6', accent: '#8b7355' },
} as const;
```

## Zod Integration

```tsx
import { z } from 'zod';

// Infer types from Zod schemas
const ServiceSchema = z.object({
  slug: z.string(),
  name: z.string(),
  price: z.number().positive(),
});

type Service = z.infer<typeof ServiceSchema>;
```
