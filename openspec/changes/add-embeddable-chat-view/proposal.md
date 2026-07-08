# Make ChatView importable by sibling workspace packages

## Why

`ChatView` (`packages/client/src/components/ChatView.tsx`, 701 LOC) is the root of the dashboard's live agent-timeline UI: streaming text/thinking, tool-call bursts, inline terminals (xterm), file-preview + diff cards, skill-invocation cards, interactive UI requests, steering ghost-bubbles, sticky-bottom auto-scroll, and per-session display prefs. A sibling package inside this monorepo wants to mount the **same live chat, at full fidelity, fed by the same pi dashboard WebSocket protocol**.

Investigation of the actual dependency graph:

- `ChatView` transitively reaches **104 local files** and **24 external packages**.
- Its two boundary types — `SessionState` and `ToolContext` — are **directly reusable** because the sibling speaks the same protocol to the same server.
- The subtree's coupling to the app shell is **dependency-injected via React context**, not app singletons: display prefs, API base URL, i18n, file-open routing (wouter). `/api/*` previews and terminal WS resolve against the same server. No zustand store, no hidden global.
- `packages/client-utils` is a **source-only** shared lib (`type: module`, no build) consumed via subpath `exports` pointing at source; it publishes `src/` with React as peer deps.
- `packages/client` (`@blackbelt-technology/pi-dashboard-web`) is **materially different**: it is a **Vite _app_** build (`vite.config.ts` `root:"src"`, `outDir:"../dist"`), publishes only `files:["dist/"]`, and exposes **no** `exports` map today. It is NOT a source-published library. (Doubt review, F1.)

Because the consumer is a sibling in the **same monorepo** (npm workspace symlinks the whole package dir, so `src/` IS present on disk for the consumer), a curated subpath export pointing at source resolves for the workspace consumer without a build step — the consumer's own bundler owns the TS/JSX transform. This is explicitly a **workspace-only** resolution path: the published npm tarball ships only `dist/`, so the `chat-embed` subpath is NOT usable by an npm-registry consumer. That limitation is in-contract (consumer is a monorepo sibling), and it is why we do NOT physically relocate 104 files.

**Critical build-safety constraint (Doubt review, F2):** once a package declares an `exports` map, Node encapsulates it — only listed subpaths resolve, and `"./package.json"` stops resolving unless explicitly exported. `packages/server/src/server.ts` and `packages/electron/scripts/bundle-server.mjs` both `resolve("@blackbelt-technology/pi-dashboard-web/package.json")`. Therefore the `exports` map MUST include `"./package.json": "./package.json"` or the server + Electron bundler break. This is the single highest-risk item.

The pure event→state reduction is **already extracted** as `createInitialState` + `reduceEvent` in `packages/client/src/lib/event-reducer.ts` (Doubt cycle 2, B1 — correcting an earlier misread that placed it in `useMessageHandler`). `useMessageHandler` is only the *driver* that calls `reduceEvent` and then layers app-specific concerns (seq tracking, replay persistence, plugin publication). So `useSessionState` is a **thin hook wrapping the existing pure functions** — no carve-out, no new reduction logic. One subtlety it MUST replicate: `useMessageHandler`'s `event_replay` path reads an external `maxSeqMapRef` to compute `shouldReset` *before* folding (Doubt cycle 2, B2); the hook must own or accept that seq-reset state or replay correctness regresses.

**Build-integration constraints for the consumer (Doubt cycle 2, D2–D4).** A source subpath export shifts transform + dependency duties onto the consumer's build:
- **Single React**: `react`/`react-dom` are `dependencies` (not `peerDependencies`) on `packages/client`. The workspace must hoist/dedupe to a single React copy (default for the monorepo root) or hooks break across a dual-copy boundary. Documented, not re-architected — in-contract because the consumer is a workspace sibling.
- **JSX transform**: Vite's `@vitejs/plugin-react` skips `node_modules` by default; the consumer must include this package in its transform (`optimizeDeps.include` / plugin `include`) since `./chat-embed` ships raw `.tsx`.
- **Tailwind + CSS vars**: the consumer's Tailwind `content` glob must scan `node_modules/@blackbelt-technology/pi-dashboard-web/**/*.{ts,tsx}`, and the theme CSS custom properties (`--text-secondary`, `--bg-hover`, …) must be defined — `ThemeProvider` alone is necessary but not sufficient.

## What Changes

- **New headless hook `useSessionState`**: `packages/client/src/hooks/useSessionState.ts` SHALL wrap the already-pure `createInitialState` + `reduceEvent` (`event-reducer.ts`), consume a pi dashboard event stream, and return the current `SessionState`. It SHALL replicate the `event_replay` seq-reset semantics (`maxSeqMapRef`/`shouldReset`) so replay stays correct. This is the reusable **state half** — no JSX, no primitives.
- **Curated embed barrel `chat-embed`**: `packages/client/src/chat-embed/index.ts` SHALL re-export the embedding surface. "Full fidelity" is **larger than `ChatView` alone** (Doubt review, F4) — `ChatView` is render-only. The barrel SHALL export, at minimum:
  - `ChatView` + its `Props` type;
  - `ChatViewMenu` (the per-session display-preferences menu — a contract item; sends WS `setSessionDisplayPrefs`);
  - the steer/abort/fork input+action surface (`CommandInput` / `QueuePanel` + the callbacks `ChatView` accepts);
  - `useSessionState`;
  - the `SessionState` and `ToolContext` types, **with documented construction** of `ToolContext` (`cwd`, `editors`, `sessionId`, `session` — hidden coupling, not a trivial type; Doubt review, F5);
  - the **context providers a host must mount**, verifying each exists first (Doubt F6): `ThemeProvider` (**throws** if absent), `UiPrimitiveProvider`, `MobileProvider`, `SessionAssetsProvider`, `DisplayPrefsProvider`. `api-context` exposes raw `ApiContext` + `useApiBase` (NO `ApiProvider` component today — a thin wrapper may be added); i18n `t()` is a module singleton so `I18nProvider` is **optional** (runtime language switching only).
  Internal helper hooks the components use (`useDisplayPrefs`, `usePopoverFlip`, `useImagePaste`, `t`, …) do NOT need re-export — they resolve within the package via the components' own relative imports (Doubt cycle 2, (c)). The consumer supplies only the **providers + `ToolContext` + wouter `Router`**; everything else resolves internally. The barrel is re-export + at most thin provider wrappers; no new feature UI.
- **Subpath exports on `packages/client/package.json`**: add a **minimal** `exports` map — `"./chat-embed"` (barrel) **and `"./package.json": "./package.json"`** (mandatory — Doubt F2). No `"."` entry is added: the package has no `main`/`module` today and nothing imports the bare specifier (Doubt cycle 2, A1), so introducing one is speculative scope. The Vite app build output is unaffected; `exports` only affects programmatic consumers.
- **Provider contract documentation**: `docs/embedding-chat-view.md` SHALL capture the full mount contract (all providers above, wouter `Router`, `ToolContext` construction, single-React requirement, Vite JSX-transform config, Tailwind `content` glob, CSS-var contract, the workspace-only resolution caveat) + a minimal working example.
- **No file relocation**: the 104-file subtree stays in `packages/client`. Full extraction into a standalone `packages/chat` library is out of scope (see Alternatives).

## Alternatives Considered

- **Reuse `MinimalChatView`** (`client-utils/minimal-chat`): rejected — read-only timeline; cannot render inline terminals, interactive UI requests, or steering.
- **Extract a new `packages/chat` source-only library** (move all 104 files + event-reducer + tool-renderers): the clean long-term boundary, but a large mechanical import-rewrite across the whole client with real regression surface. Deferred; the subpath-export names introduced here are forward-compatible with it.
- **Export `ChatView` directly with no hook**: rejected — leaves every consumer to re-implement the event→state driver.

## Capabilities

### Modified Capabilities

- `chat-view`: adds a Requirement that the live chat UI is importable by sibling workspace packages through a curated subpath export, and that the event→state reduction is available as a headless `useSessionState` hook driven by the same protocol.

## Discipline Skills

- `doubt-driven-review` — introduces a cross-package public API surface (subpath exports) before it stands.
- `code-simplification` — the barrel stays a thin re-export; the hook wraps existing pure functions rather than duplicating reduction.

## Impact

- **No behavioural change to the dashboard app**: `useSessionState` wraps the existing pure `event-reducer` functions; the `chat-embed` barrel and `exports` map are additive.
- **BUILD RISK (must-verify)**: adding `exports` changes package resolution. The `"./package.json"` entry is mandatory or `server.ts` + `bundle-server.mjs` break. A build + Electron-bundle smoke test is required before merge.
- **Consumer surface**: a sibling gains `@…/pi-dashboard-web/chat-embed` with `ChatView` + `ChatViewMenu` + input/action surface + `useSessionState` + provider re-exports — **workspace-only** (not usable from an npm-registry install; tarball ships only `dist/`).
- **Coupling made explicit**: host must mount `ThemeProvider` (throws if absent), `UiPrimitiveProvider`, `MobileProvider`, `SessionAssetsProvider`, `DisplayPrefsProvider`, api-context, and a wouter `Router`; construct `ToolContext`; ensure single React, Vite JSX transform for the package, Tailwind content glob, and theme CSS vars. Documented in `docs/embedding-chat-view.md`.
- **Code impact**: new hook (thin wrapper over `event-reducer`, incl. replay seq-reset), barrel re-exports + possibly a thin `ApiProvider` wrapper, minimal `exports` map (incl. `./package.json`), one topic doc. No new runtime dependencies.
- **Migration**: none for the app. Consumers opt in via the subpath.
- **Rollback**: delete the hook + barrel + `exports` entry + doc. No persisted state, no protocol change.
- **Compatibility**: forward-compatible with a future `packages/chat` extraction — public names (`ChatView`, `ChatViewMenu`, `useSessionState`, `SessionState`, `ToolContext`) are stable regardless of physical location.
- **Out of scope**: relocating the 104-file subtree; npm-registry publishing of `chat-embed`; changing the WebSocket protocol; new UI.
