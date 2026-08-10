---
name: zod-react-hook-form
description: Form validation combining Zod schemas with React Hook Form, including localized error messages, Server Action integration, and shadcn/ui Form components. Use when building forms, validating user input, handling form submissions, or implementing Server Actions with validation.
---

# Zod + React Hook Form

## Schema Definition

```tsx
// lib/validations.ts
import { z } from 'zod';

export const contactFormSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Please enter a valid email'),
  phone: z.string().optional(),
  message: z.string().min(10, 'Message must be at least 10 characters'),
});

export type ContactFormData = z.infer<typeof contactFormSchema>;

export const bookingRequestSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional(),
  goals: z.string().min(10),
  experienceLevel: z.enum(['beginner', 'intermediate', 'advanced']),
  injuries: z.string().optional(),
  preferredTimes: z.string().min(5),
  sessionType: z.enum(['in-person', 'online']),
});

export type BookingRequestData = z.infer<typeof bookingRequestSchema>;
```

## Client Component Form

```tsx
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { contactFormSchema, type ContactFormData } from '@/lib/validations';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

export function ContactForm() {
  const t = useTranslations('form');
  
  const form = useForm<ContactFormData>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: {
      name: '',
      email: '',
      phone: '',
      message: '',
    },
  });

  const onSubmit = async (data: ContactFormData) => {
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      
      if (!response.ok) throw new Error();
      form.reset();
      // Show success toast
    } catch {
      // Show error toast
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('name')}</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('email')}</FormLabel>
              <FormControl>
                <Input type="email" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name="message"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('message')}</FormLabel>
              <FormControl>
                <Textarea rows={4} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? t('submitting') : t('submit')}
        </Button>
      </form>
    </Form>
  );
}
```

## Server Action Integration

```tsx
// lib/actions.ts
'use server';

import { z } from 'zod';
import { contactFormSchema } from '@/lib/validations';

export type ActionResult = 
  | { success: true }
  | { success: false; errors: Record<string, string[]> };

export async function submitContactForm(
  formData: FormData
): Promise<ActionResult> {
  const rawData = {
    name: formData.get('name'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    message: formData.get('message'),
  };

  const result = contactFormSchema.safeParse(rawData);

  if (!result.success) {
    return {
      success: false,
      errors: result.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  // Process valid data
  const { name, email, message } = result.data;
  
  // Send email, save to DB, etc.
  
  return { success: true };
}
```

## Form with Server Action

```tsx
'use client';

import { useActionState } from 'react';
import { submitContactForm, type ActionResult } from '@/lib/actions';

const initialState: ActionResult = { success: false, errors: {} };

export function ContactFormWithAction() {
  const [state, formAction, isPending] = useActionState(
    submitContactForm,
    initialState
  );

  return (
    <form action={formAction}>
      <div>
        <input name="name" required />
        {state.success === false && state.errors.name && (
          <p className="text-destructive text-sm">{state.errors.name[0]}</p>
        )}
      </div>
      
      <button type="submit" disabled={isPending}>
        {isPending ? 'Submitting...' : 'Submit'}
      </button>
      
      {state.success && (
        <p className="text-green-600">Message sent successfully!</p>
      )}
    </form>
  );
}
```

## Localized Error Messages

```tsx
// Create schema with translated messages
export function createContactSchema(t: (key: string) => string) {
  return z.object({
    name: z.string().min(2, t('errors.nameMin')),
    email: z.string().email(t('errors.emailInvalid')),
    message: z.string().min(10, t('errors.messageMin')),
  });
}

// Usage in component
const t = useTranslations('form');
const schema = createContactSchema(t);
```

## Select/Radio Fields

```tsx
<FormField
  control={form.control}
  name="experienceLevel"
  render={({ field }) => (
    <FormItem>
      <FormLabel>{t('experienceLevel')}</FormLabel>
      <Select onValueChange={field.onChange} defaultValue={field.value}>
        <FormControl>
          <SelectTrigger>
            <SelectValue placeholder={t('selectLevel')} />
          </SelectTrigger>
        </FormControl>
        <SelectContent>
          <SelectItem value="beginner">{t('beginner')}</SelectItem>
          <SelectItem value="intermediate">{t('intermediate')}</SelectItem>
          <SelectItem value="advanced">{t('advanced')}</SelectItem>
        </SelectContent>
      </Select>
      <FormMessage />
    </FormItem>
  )}
/>
```

## Environment Validation

```tsx
// lib/env.ts
import { z } from 'zod';

const envSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.string().url(),
  RESEND_API_KEY: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().startsWith('sk_').optional(),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_').optional(),
});

export const env = envSchema.parse(process.env);
```
