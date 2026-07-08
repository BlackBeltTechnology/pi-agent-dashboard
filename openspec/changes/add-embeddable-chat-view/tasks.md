# Tasks

## 1. Headless useSessionState hook (thin wrapper over event-reducer)

- [ ] 1.1 Confirm the reduction site: `createInitialState` + `reduceEvent` are the pure functions in `packages/client/src/lib/event-reducer.ts`; `useMessageHandler.ts` only *drives* them and layers seq/replay/plugin concerns. (Doubt cycle 2, B1.)
- [ ] 1.2 Note the `event_replay` seq-reset logic in `useMessageHandler.ts` (`maxSeqMapRef` → `shouldReset` computed BEFORE folding). The hook MUST own or accept this state. (Doubt cycle 2, B2.)
- [ ] 1.3 Write a failing test `packages/client/src/hooks/__tests__/useSessionState.test.ts` driving a canned event sequence (incl. `event`, `event_replay` with a reset, `prompt_received`, `asset_register`, `extension_ui_request`, `prompt_request`, `ui_dismiss`) and assert `SessionState` equals the app driver's output for the same sequence.
- [ ] 1.4 Implement `packages/client/src/hooks/useSessionState.ts` wrapping `createInitialState` + `reduceEvent`, replicating the replay seq-reset. No new reduction logic.
- [ ] 1.5 Run the ChatView + event-reducer test suites; confirm green (`npm test 2>&1 | tee /tmp/pi-test.log`).

## 2. chat-embed barrel (full-fidelity surface)

- [ ] 2.1 Verify each intended re-export exists before listing it (Doubt F6): `api-context.ts` exposes `ApiContext`+`useApiBase` (NO `ApiProvider` — add a thin wrapper if a component is wanted); i18n `t()` is a singleton so `I18nProvider` is optional. Confirm `ThemeProvider`, `UiPrimitiveProvider`, `MobileProvider`, `SessionAssetsProvider`, `DisplayPrefsProvider`, `ChatViewMenu`, `CommandInput`, `QueuePanel` export paths.
- [ ] 2.2 Create `packages/client/src/chat-embed/index.ts` re-exporting: `ChatView` + `Props`, `ChatViewMenu`, the input/action surface (`CommandInput`/`QueuePanel` + steer/abort/fork callbacks), `useSessionState`, `SessionState` + `ToolContext` types, and the providers above. Re-exports + at most a thin `ApiProvider` wrapper. Do NOT re-export internal helper hooks (they resolve within the package).
- [ ] 2.3 Module doc-comment: enumerate REQUIRED providers (`ThemeProvider` throws if absent, `UiPrimitiveProvider`, `MobileProvider`, `SessionAssetsProvider`, `DisplayPrefsProvider`, api-context, wouter `Router`), how to construct `ToolContext` (`cwd`/`editors`/`sessionId`/`session`), and the workspace-only caveat.

## 3. Subpath exports (build-safety critical)

- [ ] 3.1 Add a **minimal** `exports` map to `packages/client/package.json`: `"./chat-embed"` → `./src/chat-embed/index.ts` **and `"./package.json": "./package.json"`** (MANDATORY — Doubt F2). Do NOT add a `"."` entry (no `main`/`module` exists, no bare import consumer — Doubt cycle 2, A1).
- [ ] 3.2 Build smoke test: `npm run build` (app build unaffected) AND verify `require.resolve("@blackbelt-technology/pi-dashboard-web/package.json")` still resolves (mimics `server.ts`/`bundle-server.mjs`). Run the Electron bundle path if feasible.
- [ ] 3.3 Document `chat-embed` is workspace-only (tarball ships `files:["dist/"]`; `src/` absent for npm consumers) — do NOT attempt npm-installability in this change.

## 4. Consumer contract doc

- [ ] 4.1 (Delegate to a docs subagent, caveman style) Write `docs/embedding-chat-view.md`: full provider mount contract, `ToolContext` construction, single-React requirement, Vite JSX-transform config (`optimizeDeps.include`), Tailwind `content` glob for the package, CSS-var contract, workspace-only caveat, and a minimal `<ChatView>` mount example fed by `useSessionState`. Add a one-line pointer per the Documentation Update Protocol.
- [ ] 4.2 Add the `docs/embedding-chat-view.md` per-file row to `docs/AGENTS.md` (docs subagent, caveman style).

## 5. Validate

- [ ] 5.1 In a sibling package (or throwaway importer), `import { ChatView, ChatViewMenu, useSessionState } from "@blackbelt-technology/pi-dashboard-web/chat-embed"` and confirm it resolves + type-checks.
- [ ] 5.2 Full suite green: `npm test`. Type-check clean: `npm run reload:check` or `tsc --noEmit`.
- [ ] 5.3 Run the code-quality oracle on the diff: `npm run quality:changed`.
