# ui-primitive-registry.ts — index

Runtime data structure for UI primitives. Exports `UiPrimitiveRegistry` (opaque, private `_impls` map), `createUiPrimitiveRegistry()`, `registerUiPrimitive(reg,key,impl)` (throws on double-registration, first-write-wins), `getUiPrimitiveImpl` (internal lookup, returns `undefined` if missing). Pairs with `ui-primitive-context.tsx`.
