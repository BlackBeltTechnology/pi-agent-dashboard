/**
 * `chat-embed` — curated surface for embedding the dashboard's live chat in a
 * sibling workspace package, at full fidelity, fed by the same pi-dashboard
 * WebSocket protocol.
 *
 * Import via the subpath export:
 *   import { ChatView, ChatViewMenu, useSessionState } from
 *     "@blackbelt-technology/pi-dashboard-web/chat-embed";
 *
 * ── WORKSPACE-ONLY ──────────────────────────────────────────────────────────
 * `packages/client` publishes only `dist/` (`files: ["dist/"]`); this subpath
 * points at raw `src/*.tsx`. It resolves for a MONOREPO SIBLING (the workspace
 * symlinks the whole package dir, so `src/` is on disk) but NOT for an
 * npm-registry install. The consumer's own bundler owns the TS/JSX transform.
 *
 * ── REQUIRED HOST MOUNT CONTRACT ─────────────────────────────────────────────
 * `ChatView` reaches app-shell concerns via React context. A host MUST mount,
 * around `<ChatView>`:
 *   - `ThemeProvider`            — THROWS if absent (defines theme CSS vars).
 *   - `UiPrimitiveProvider`      — from `@blackbelt-technology/dashboard-plugin-runtime`
 *                                  (re-exported here for convenience); pass a
 *                                  primitive registry as `value`.
 *   - `MobileProvider`           — viewport/mobile context.
 *   - `SessionAssetsProvider`    — resolves `pi-asset:` image refs.
 *   - `DisplayPrefsProvider`     — per-session display prefs.
 *   - a wouter `Router`          — file-open routing uses wouter.
 *   - an api base                — wrap in `<ApiContext.Provider value={base}>`
 *                                  (raw context; there is no `ApiProvider`).
 * `FilePreviewProvider` / `FilePreviewHost` are self-mounted INSIDE `ChatView`
 * — do NOT supply them. `I18nProvider` is OPTIONAL: `t()` is a module singleton;
 * mount it only for runtime language switching.
 *
 * ── BOUNDED-HEIGHT SCROLL PARENT (required) ──────────────────────────────────
 * The transcript is TanStack-virtualized (`@tanstack/react-virtual`). Mount
 * `<ChatView>` inside a container with a bounded/measurable height. An
 * unconstrained/auto-height parent starves the virtualizer of a scroll viewport
 * and the transcript fails to size/scroll.
 *
 * ── ToolContext CONSTRUCTION ─────────────────────────────────────────────────
 * `ChatView` requires a `ToolContext` (`{ cwd, editors, sessionId, session }`)
 * — hidden coupling, not a trivial type. Construct it from the same session the
 * `SessionState` was reduced for. See `docs/embedding-chat-view.md`.
 *
 * ── SINGLE REACT ─────────────────────────────────────────────────────────────
 * `react`/`react-dom` are `dependencies` (not peer) on `packages/client`. The
 * workspace MUST dedupe to a single React copy or hooks break across a
 * dual-copy boundary. The consumer's Vite `@vitejs/plugin-react` must include
 * this package in its transform, and its Tailwind `content` glob must scan the
 * package dir `node_modules/@blackbelt-technology/pi-dashboard-web/` for `.ts`
 * and `.tsx` files (see docs/embedding-chat-view.md for the exact glob).
 *
 * Internal helper hooks (`useDisplayPrefs`, `usePopoverFlip`, `t`, …) are NOT
 * re-exported — they resolve within the package via relative imports.
 *
 * See change: add-embeddable-chat-view. Full contract: docs/embedding-chat-view.md.
 */
import type React from "react";

// ── The render surface ───────────────────────────────────────────────────────
export { ChatView } from "../components/chat/ChatView.js";
export { ChatViewMenu } from "../components/chat/ChatViewMenu.js";
// The steer/abort/fork input + action surface.
export { CommandInput } from "../components/chat/CommandInput.js";
export { QueuePanel } from "../components/session/QueuePanel.js";

// Prop types (the source `Props` interfaces are file-local; derive them so the
// consumer can type the callbacks it must supply without editing source).
export type ChatViewProps = React.ComponentProps<typeof import("../components/chat/ChatView.js").ChatView>;
export type CommandInputProps = React.ComponentProps<
  typeof import("../components/chat/CommandInput.js").CommandInput
>;
export type QueuePanelProps = React.ComponentProps<typeof import("../components/session/QueuePanel.js").QueuePanel>;

// Re-exported for convenience; originates in dashboard-plugin-runtime.
export { UiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime";
// ── Context providers a host must mount ──────────────────────────────────────
export { ThemeProvider } from "../components/settings/ThemeProvider.js";
export type { ToolContext } from "../components/tool-renderers/index.js";
export { MobileProvider } from "../hooks/useMobile.js";
export type { SessionStateAccumulator, UseSessionStateResult } from "../hooks/useSessionState.js";
// ── The headless state half ──────────────────────────────────────────────────
export {
  applySessionMessage,
  createSessionAccumulator,
  useSessionState,
} from "../hooks/useSessionState.js";
// Raw api-context (no `ApiProvider` component exists — wrap `ApiContext.Provider`).
export { ApiContext, useApiBase } from "../lib/api/api-context.js";
export { DisplayPrefsProvider } from "../lib/state/DisplayPrefsContext.js";
// ── Boundary types ───────────────────────────────────────────────────────────
export type { ChatImage, InteractiveUiRequest, SessionState } from "../lib/chat/event-reducer.js";
export { SessionAssetsProvider } from "../lib/session/SessionAssetsContext.js";
