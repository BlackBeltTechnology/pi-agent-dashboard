# ui-primitive-context.tsx — index

React context provider + lookup hooks for UI primitives. Exports `UiPrimitiveProvider`, `useUiPrimitive<K>(key)` (strict, throws if unregistered or outside provider), `useUiPrimitiveOrNull<K>(key)` (soft, null fallback). Public host API (`public.ts`): trusted plugin client code calls them directly; no `@deprecated` tag (removed; lint test pins it). Intents stay the path for bridge/server-originated UI. A self-providing primitive (`ui:chat-view`) mounts nested providers but never a second `UiPrimitiveProvider`. See change: decouple-plugins-from-core.
