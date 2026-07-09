# Embedding the dashboard chat view

Subpath export mounts the dashboard's live chat in a sibling workspace package, full fidelity, fed by the pi-dashboard WebSocket protocol.

```ts
import { ChatView, useSessionState } from "@blackbelt-technology/pi-dashboard-web/chat-embed";
```

See change: add-embeddable-chat-view.

## What chat-embed exports

Curated subpath surface. Larger than `ChatView` alone. Barrel: `packages/client/src/chat-embed/index.ts`.

Render surface:
- `ChatView` — transcript + input/action host.
- `ChatViewMenu` — per-view menu.
- `CommandInput` — steer/abort/fork input surface.
- `QueuePanel` — mid-turn queue surface.

Headless state:
- `useSessionState` — hook.
- `applySessionMessage`, `createSessionAccumulator` — pure reducer primitives.

Boundary types:
- `ChatImage`, `InteractiveUiRequest`, `SessionState` (from `../lib/event-reducer`).
- `ToolContext` (from tool-renderers).
- `ChatViewProps`, `CommandInputProps`, `QueuePanelProps` — derived component prop types.
- `SessionStateAccumulator`, `UseSessionStateResult`.

Provider re-exports:
- `ThemeProvider`, `MobileProvider`, `SessionAssetsProvider`, `DisplayPrefsProvider`.
- `ApiContext`, `useApiBase`.
- `UiPrimitiveProvider` (originates in `@blackbelt-technology/dashboard-plugin-runtime`; re-exported for convenience).

Internal helper hooks (`useDisplayPrefs`, `usePopoverFlip`, `t`, …) not re-exported. Resolve within package via relative imports.

## Workspace-only

`packages/client` publishes only `dist/` (`files: ["dist/"]`). Subpath points at raw `src/*.tsx`. Resolves for monorepo sibling — workspace symlink puts whole package dir on disk, so `src/` present. Does NOT resolve for npm-registry install. Consumer bundler owns TS/JSX transform. Do not attempt npm-installability.

## exports map

`packages/client/package.json`:

```jsonc
{
  "exports": {
    "./chat-embed": "./src/chat-embed/index.ts",
    "./package.json": "./package.json"
  }
}
```

`"./package.json"` entry mandatory. `packages/server/src/server.ts` and `packages/electron/scripts/bundle-server.mjs` resolve `@blackbelt-technology/pi-dashboard-web/package.json`. exports encapsulation breaks those resolves without the entry.

No `"."` entry. Package has no `main`/`module`.

## Required host mount contract

`ChatView` reaches app-shell concerns via React context. Host MUST mount, around `<ChatView>`:

- `ThemeProvider` — THROWS if absent. Defines theme CSS vars. Props: `{ children }`.
- `UiPrimitiveProvider` — from `@blackbelt-technology/dashboard-plugin-runtime` (re-exported by barrel). Pass primitive registry as `value`. Build registry via `createUiPrimitiveRegistry` from dashboard-plugin-runtime.
- `MobileProvider` — viewport/mobile context. Props: `{ children }`.
- `SessionAssetsProvider` — resolves `pi-asset:` image refs. Prop: `assets` (`SessionAssets | undefined`).
- `DisplayPrefsProvider` — per-session display prefs. Prop: `value` (`DisplayPrefsContextValue`).
- wouter `Router` — file-open routing uses wouter.
- api base — wrap in `<ApiContext.Provider value={base}>`. Raw context. NO `ApiProvider` component exists.

`FilePreviewProvider` / `FilePreviewHost` self-mounted INSIDE `ChatView`. Host does NOT supply them.

`I18nProvider` OPTIONAL. `t()` module singleton. Mount only for runtime language switching.

## Bounded-height scroll parent (required)

Transcript TanStack-virtualized (`@tanstack/react-virtual`). Mount `<ChatView>` inside container with bounded/measurable height. Unconstrained/auto-height parent starves virtualizer of scroll viewport. Transcript fails to size/scroll.

## ToolContext construction

Shape:

```ts
interface ToolContext {
  cwd?: string;
  editors: DetectedEditor[];
  sessionId?: string;
  session?: SessionState;
}
```

Construct from same session the `SessionState` reduced for. `editors`: `DetectedEditor[]`. `session`: `SessionState`.

## useSessionState

Headless hook. No JSX, no UI-primitive dependency.

```ts
const { state, apply, reset } = useSessionState(sessionId?);
```

Wraps pure `createInitialState` + `reduceEvent` + `foldLiveEvents`. Adds no reduction logic — only driver routing + `event_replay` sequence-reset decision.

Wire dashboard WebSocket `onmessage` (parsed) to `apply(msg)`. Binds to `sessionId` when provided; ignores messages for other sessions.

Replicates `event_replay` seq-reset semantics: full-replay sweep (`firstSeq === 1` cold start OR `firstSeq <= maxSeq` re-replay) resets before folding, mirroring `useMessageHandler`.

Pure reducer also exported (React-free, testable):
- `createSessionAccumulator()` → `SessionStateAccumulator`.
- `applySessionMessage(acc, msg)` → `SessionStateAccumulator`. Returns same reference for non-`SessionState`-affecting messages.

`asset_register` a no-op in this reducer — mutates `SessionAssetsContext`, not `SessionState`.

## Single React

`react`/`react-dom` are `dependencies` (not peer) on `packages/client`. Workspace MUST dedupe to single React copy. Dual-copy boundary breaks hooks.

## Vite JSX transform

Consumer `@vitejs/plugin-react` skips `node_modules` by default. chat-embed ships raw `.tsx`. Consumer must include this package in transform: `optimizeDeps.include` and/or plugin `include`.

## Tailwind content glob

Consumer Tailwind `content` must scan package dir for `.ts`/`.tsx`:

```
node_modules/@blackbelt-technology/pi-dashboard-web/**/*.{ts,tsx}
```

## CSS-var contract

Theme CSS custom properties (e.g. `--text-secondary`, `--bg-hover`) must be defined. `ThemeProvider` necessary but not sufficient — host stylesheet must define the vars.

## Carried runtime dependencies

Consumer must resolve the 24 external packages the `ChatView` subtree reaches:
- single `react` / `react-dom`.
- `wouter`.
- `@tanstack/react-virtual`.
- xterm stack.
- `@git-diff-view` stack.
- `react-markdown` / `remark` / `rehype` stack.
- `@mdi`.
- sibling workspace packages.

This change adds no dependency to `packages/client`. Barrel re-exports what already ships.

## Minimal mount example

```tsx
import { useEffect, useRef } from "react";
import { Router } from "wouter";
import {
  ChatView,
  useSessionState,
  ThemeProvider,
  MobileProvider,
  SessionAssetsProvider,
  DisplayPrefsProvider,
  UiPrimitiveProvider,
  ApiContext,
  type ToolContext,
} from "@blackbelt-technology/pi-dashboard-web/chat-embed";
import { createUiPrimitiveRegistry } from "@blackbelt-technology/dashboard-plugin-runtime";

const uiRegistry = createUiPrimitiveRegistry(/* host primitive impls */);

export function EmbeddedChat({
  sessionId,
  wsUrl,
  apiBase,
}: {
  sessionId: string;
  wsUrl: string;
  apiBase: string;
}) {
  const { state, apply, reset } = useSessionState(sessionId);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    reset();
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      try {
        apply(JSON.parse(ev.data));
      } catch {
        /* ignore non-JSON frames */
      }
    };
    return () => ws.close();
  }, [wsUrl, apply, reset]);

  const toolContext: ToolContext = {
    editors: [], // DetectedEditor[] — from host editor detection
    sessionId,
    session: state,
  };

  return (
    <ApiContext.Provider value={apiBase}>
      <ThemeProvider>
        <UiPrimitiveProvider value={uiRegistry}>
          <MobileProvider>
            <SessionAssetsProvider assets={/* SessionAssets map, or undefined */ undefined}>
              <DisplayPrefsProvider
                value={{ global: undefined, getSessionOverride: () => undefined }}
              >
                <Router>
                  {/* bounded-height scroll parent — required by the virtualizer */}
                  <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
                    <ChatView
                      sessionId={sessionId}
                      state={state}
                      toolContext={toolContext}
                    />
                  </div>
                </Router>
              </DisplayPrefsProvider>
            </SessionAssetsProvider>
          </MobileProvider>
        </UiPrimitiveProvider>
      </ThemeProvider>
    </ApiContext.Provider>
  );
}
```

`ChatView` required props: `state` (`SessionState`), `toolContext` (`ToolContext`). All other props (`sessionId`, `onAbort`, `onForkFromMessage`, `onRespondToUi`, `onCloseInlineTerminal`, `onForceKill`, `onCollapseStreamingThinking`, `pendingSteering`, `loadingHistory`) optional callbacks/signals the host supplies to wire user actions back to the dashboard.
