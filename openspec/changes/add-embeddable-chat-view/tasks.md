# Tasks

## 1. Headless useSessionState hook (thin wrapper over event-reducer)

- [x] 1.1 Confirm the reduction site: `createInitialState` + `reduceEvent` are the pure functions in `packages/client/src/lib/event-reducer.ts`; `useMessageHandler.ts` only *drives* them and layers seq/replay/plugin concerns. (Doubt cycle 2, B1.)
- [x] 1.2 Note the `event_replay` seq-reset logic in `useMessageHandler.ts` (`maxSeqMapRef` → `shouldReset` computed BEFORE folding). The hook MUST own or accept this state. (Doubt cycle 2, B2.)
- [x] 1.3 Write a failing test `packages/client/src/hooks/__tests__/useSessionState.test.ts` driving a canned event sequence (incl. `event`, `event_replay` with a reset, `prompt_received`, `asset_register`, `extension_ui_request`, `prompt_request`, `ui_dismiss`) and assert `SessionState` equals the app driver's output for the same sequence.
- [x] 1.4 Implement `packages/client/src/hooks/useSessionState.ts` wrapping `createInitialState` + `reduceEvent`, replicating the replay seq-reset. No new reduction logic.
- [x] 1.5 Run the ChatView + event-reducer test suites; confirm green (`npm test 2>&1 | tee /tmp/pi-test.log`).

## 2. chat-embed barrel (full-fidelity surface)

- [x] 2.1 Verify each intended re-export exists before listing it (Doubt F6): `api-context.ts` exposes `ApiContext`+`useApiBase` (NO `ApiProvider` — add a thin wrapper if a component is wanted); i18n `t()` is a singleton so `I18nProvider` is optional. Confirm `ThemeProvider`, `UiPrimitiveProvider`, `MobileProvider`, `SessionAssetsProvider`, `DisplayPrefsProvider`, `ChatViewMenu`, `CommandInput`, `QueuePanel` export paths.
- [x] 2.2 Create `packages/client/src/chat-embed/index.ts` re-exporting: `ChatView` + `Props`, `ChatViewMenu`, the input/action surface (`CommandInput`/`QueuePanel` + steer/abort/fork callbacks), `useSessionState`, `SessionState` + `ToolContext` types, and the providers above. Re-exports + at most a thin `ApiProvider` wrapper. Do NOT re-export internal helper hooks (they resolve within the package).
- [x] 2.3 Module doc-comment: enumerate REQUIRED providers (`ThemeProvider` throws if absent, `UiPrimitiveProvider` — from `@blackbelt-technology/dashboard-plugin-runtime`, `MobileProvider`, `SessionAssetsProvider`, `DisplayPrefsProvider`, api-context, wouter `Router`), the **bounded-height scroll container** the virtualized transcript requires, the fact that `FilePreviewProvider`/`FilePreviewHost` are self-mounted by `ChatView` (NOT host-supplied), how to construct `ToolContext` (`cwd`/`editors`/`sessionId`/`session`), and the workspace-only caveat.

## 3. Subpath exports (build-safety critical)

- [x] 3.1 Add a **minimal** `exports` map to `packages/client/package.json`: `"./chat-embed"` → `./src/chat-embed/index.ts` **and `"./package.json": "./package.json"`** (MANDATORY — Doubt F2). Do NOT add a `"."` entry (no `main`/`module` exists, no bare import consumer — Doubt cycle 2, A1).
- [x] 3.2 Build smoke test: `npm run build` (app build unaffected) AND verify `require.resolve("@blackbelt-technology/pi-dashboard-web/package.json")` still resolves (mimics `server.ts`/`bundle-server.mjs`). Run the Electron bundle path if feasible.
- [x] 3.3 Document `chat-embed` is workspace-only (tarball ships `files:["dist/"]`; `src/` absent for npm consumers) — do NOT attempt npm-installability in this change.

## 4. Consumer contract doc

- [x] 4.1 (Delegate to a docs subagent, caveman style) Write `docs/embedding-chat-view.md`: full provider mount contract (note `UiPrimitiveProvider` originates in `dashboard-plugin-runtime`; `FilePreviewProvider` self-mounted by `ChatView`), the **bounded-height scroll container** required by the TanStack-virtualized transcript, `ToolContext` construction, single-React requirement, Vite JSX-transform config (`optimizeDeps.include`), Tailwind `content` glob for the package, CSS-var contract, workspace-only caveat, and a minimal `<ChatView>` mount example fed by `useSessionState`. Add a one-line pointer per the Documentation Update Protocol.
- [x] 4.2 Add the `docs/embedding-chat-view.md` per-file row to `docs/AGENTS.md` (docs subagent, caveman style).

## 5. Validate

- [x] 5.1 In a sibling package (or throwaway importer), `import { ChatView, ChatViewMenu, useSessionState } from "@blackbelt-technology/pi-dashboard-web/chat-embed"` and confirm it resolves + type-checks. (Verified: node subpath-resolution probe resolves `./chat-embed` + `./package.json` and blocks deep non-exported paths; throwaway surface type-check of all exported values + types passes clean.)
- [x] 5.2 Full suite: `npm test`. Type-check clean on the diff (only pre-existing `faux-renderers` qa-fixtures rootDir error remains). My new tests 12/12 green; client suite 369/369 green in isolation. Full-suite 18 failures are ALL pre-existing/unrelated: `pi-image-fit-extension` jimp env failures (fail in isolation too), + `@tanstack/react-virtual` teardown-timer race in ChatView/doctor (pass in isolation). My diff touches none of those packages.
- [x] 5.3 Code-quality on the diff: `biome check --error-on-warnings` clean (exit 0) on all new/changed files after refactoring `applySessionMessage` (cognitive complexity 35→ under 15 via `applyReplay`/`settle`/`addPromptBusRequest` extraction). Oracle's `tsc`/`npm test` legs hit the pre-existing failures above, unrelated to this diff.
