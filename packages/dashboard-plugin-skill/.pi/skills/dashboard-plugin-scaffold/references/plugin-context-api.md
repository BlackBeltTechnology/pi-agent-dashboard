# Plugin Context API (client SDK)

The "SDK" the skill installs is the public exports of:

- `@blackbelt-technology/dashboard-plugin-runtime` (client surface, hooks, slot registry, plugin context provider)
- `@blackbelt-technology/pi-dashboard-shared` (manifest types, slot ids, slot props, payload schemas)

There is no separate `pi-dashboard-sdk` package. Both packages are added as `dependencies`.

## Hooks (from `@blackbelt-technology/dashboard-plugin-runtime/context`)

### `usePluginConfig<T>(): T`

Reactive read of `plugins.<id>.*` from `~/.pi/dashboard/config.json`. The config is validated against the manifest's `configSchema` on read; defaults from the schema fill missing keys. Re-renders subscribers on every successful write to the same plugin's config.

```tsx
import { usePluginConfig } from "@blackbelt-technology/dashboard-plugin-runtime/context";

interface MyConfig { greeting: string; count: number }

export function MyComponent() {
  const config = usePluginConfig<MyConfig>();
  return <div>{config.greeting} ({config.count})</div>;
}
```

### `usePluginSend(): PluginSendFunction`

Returns a `send` function for dispatching browser-protocol messages. Use `plugin_config_write` to persist config changes:

```tsx
import { usePluginSend } from "@blackbelt-technology/dashboard-plugin-runtime/context";

export function MyForm() {
  const send = usePluginSend();
  return (
    <button onClick={() => send({ type: "plugin_config_write", id: "my-plugin", config: { greeting: "hi" } })}>
      Save
    </button>
  );
}
```

### `useSessionState(sessionId): SessionState | undefined`

Read-only reactive access to a session's state.

### `useAllSessions(): DashboardSession[]`

Read-only reactive access to the full session list.

## Plugin router (`pluginRouter`)

```ts
pluginRouter.open(viewId: string, params?: Record<string, unknown>): void;
pluginRouter.close(): void;
```

Use `pluginRouter.open("my-content-view", { foo: "bar" })` to navigate to a `content-view` claim's route.

## What you must not do

- Do not import from `@blackbelt-technology/pi-dashboard-web/...` internal paths (`App.tsx`, internal hooks, internal components). The plugin context is the contract; everything else is private and may change without warning.
- Do not import from another plugin's package. Plugins communicate via the pi event bus only (see archived design "Decisions" §3 — Plugin-to-plugin communication).
- Do not write directly to `~/.pi/dashboard/config.json` from the client. Use `usePluginSend()` with `plugin_config_write`.

## Server-side equivalent

If your plugin has a `server` entry, see [`server-context-api.md`](./server-context-api.md) for the `ServerPluginContext` surface.

## Late-arriving gate signals

A `shouldRender` gate backed by a signal that resolves after first render (boot-time installed check) must nudge mounted gate wrappers when the signal lands:

```ts
import { bumpSlotClaimsVersion } from "@blackbelt-technology/dashboard-plugin-runtime";
```

Every gate wrapper re-invokes `shouldRender` synchronously — including idle sessions that never broadcast again. Global signals only; no per-session payload rides a bump. See change: add-blackhole-session-pipeline.
