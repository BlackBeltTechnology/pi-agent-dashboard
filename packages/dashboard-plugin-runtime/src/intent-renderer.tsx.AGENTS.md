# intent-renderer.tsx — index

Shell-side React component. Walks `IntentNode` tree, resolves `primitive` name via `useUiPrimitiveOrNull`, recursively renders nested IntentNode props/arrays. Exports `isIntentNode`, `IntentActionSender`, `IntentRendererProps`, `UnknownPrimitive` (dashed-red placeholder), `IntentRenderer`. `wireActions` converts `ActionDescriptor` map into `send(action,payload)` handlers.
