# zod-react-hook-form/SKILL.md — index

Form validation = Zod schemas + React Hook Form. Schemas in `lib/validations.ts` (`contactFormSchema`, `bookingRequestSchema`); types via `z.infer`. Client form: `useForm` + `zodResolver` + shadcn `Form`/`FormField`/`FormItem`/`FormMessage` components, `Select`/`Textarea`/`Input` fields. Server Action: `safeParse` → `ActionResult` union (`{success:true}` | `{success:false;errors}`). `useActionState` hook for action forms. Localized messages via `createContactSchema(t)`. Env validation: `envSchema.parse(process.env)`.
