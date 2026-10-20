# ui-primitive-context.tsx — index

React context provider + lookup hooks for UI primitives. Exports `UiPrimitiveProvider`, `useUiPrimitive<K>(key)` (strict, throws if unregistered or outside provider), `useUiPrimitiveOrNull<K>(key)` (soft, null fallback). Both `@deprecated` for direct plugin use — plugins should emit server-side intents; hooks remain canonical resolver for shell's `IntentRenderer`.
