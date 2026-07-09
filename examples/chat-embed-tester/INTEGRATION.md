# Integrating the pi-dashboard live chat into an external React client

This guide explains how to embed the pi-dashboard **live agent chat** — the real
`ChatView` (streaming text, thinking, tool-call bursts, inline terminals, diff
cards, interactive `ask_user` cards, steering) plus the headless `useSessionState`
hook — into a **separate React application** that is *not* part of this monorepo.

It is exhaustive on purpose: every dependency, every build setting, the provider
mount contract, the WebSocket protocol, and a complete working example. A runnable
reference implementation lives next to this file in
[`main.tsx`](./main.tsx) / [`vite.config.ts`](./vite.config.ts).

> The public surface is the subpath export
> `@blackbelt-technology/pi-dashboard-web/chat-embed`. See also the terse
> in-repo contract at `docs/embedding-chat-view.md`.

---

## 0. TL;DR

1. Get the **source** of `@blackbelt-technology/pi-dashboard-web` onto disk (npm tarball ships `dist/` only — see §2).
2. `npm install` React 19, `wouter`, and the runtime dependency set (§3).
3. Configure your bundler to **transform the `@blackbelt-technology/*` source packages** and **dedupe React to one copy** (§4).
4. Wire Tailwind v4 + the theme CSS variables (§5).
5. Mount `<ChatView>` inside the required providers + a **bounded-height** container (§6).
6. Open a WebSocket to the dashboard, `subscribe`, and feed every message to `useSessionState().apply` (§7).

---

## 1. Compatibility matrix

| Requirement | Version | Notes |
|---|---|---|
| React / React-DOM | **`^19.0.0`** | Hard requirement. Exactly **one** copy in the final bundle (§4). |
| Node (build host) | **`>=22.19.0 <26`** | Matches this repo's `engines`. |
| Bundler | Vite 6 (recommended) | Any bundler works if it can transform `.tsx` from `node_modules` and dedupe React (§4, §11). |
| `wouter` | `^3.9.0` | Router context is required by `ChatView`. |
| Tailwind CSS | v4 (`^4.1.0`) | The components are styled with Tailwind utility classes + CSS variables (§5). |
| `@blackbelt-technology/*` packages | `0.5.4` (lockstep) | `pi-dashboard-web`, `-client-utils`, `-shared`, `dashboard-plugin-runtime`, `-subagents-plugin` are versioned together. |

---

## 2. Prerequisite: get the embeddable **source** on disk

This is the single most important step. The `chat-embed` subpath ships **raw
`.tsx` source**, and your bundler owns the transform.

`@blackbelt-technology/pi-dashboard-web` currently publishes with:

```jsonc
// packages/client/package.json
"files": ["dist/"],                                   // ← tarball has NO src/
"exports": {
  "./chat-embed": "./src/chat-embed/index.ts",        // ← points AT src/
  "./package.json": "./package.json"
}
```

So a plain `npm install @blackbelt-technology/pi-dashboard-web` followed by
`import ".../chat-embed"` **fails** — the tarball has no `src/`. You have three
ways to resolve this:

### Option A — Publish the source (recommended, cleanest)

Ask the maintainers to add `src/` to the package's `files` (the four sibling
`@blackbelt-technology/*` packages *already* publish `files:["src/"]`, so this
is consistent):

```jsonc
"files": ["dist/", "src/"]
```

Then a normal `npm install @blackbelt-technology/pi-dashboard-web@x.y.z` works,
and `./chat-embed` resolves from the installed `src/`. This is the target state.

### Option B — Git checkout + bundler alias (works **today**, no publish change)

This is exactly what the reference tester does. Vendor the repo (git submodule,
subtree, or a sibling checkout) and alias the subpath at the source file:

```ts
// vite.config.ts
resolve: {
  alias: {
    "@blackbelt-technology/pi-dashboard-web/chat-embed":
      path.resolve(__dirname, "vendor/pi-agent-dashboard/packages/client/src/chat-embed/index.ts"),
  },
}
```

The barrel's relative imports pull in the rest of the ~107-file subtree
automatically. You still `npm install` the **sibling** `@blackbelt-technology/*`
packages and the third-party deps normally (they publish fine).

### Option C — Vendor everything

Copy `packages/client/src` (plus the sibling `src/` trees) into your app. Highest
maintenance cost; only if you cannot depend on the registry or a git URL.

> **Recommendation:** Option B to start (proven by the tester), migrate to
> Option A once the `files` change lands upstream.

---

## 3. Dependencies to install

### 3.1 The `@blackbelt-technology/*` packages (all publish consumable source)

```bash
npm install \
  @blackbelt-technology/pi-dashboard-web@0.5.4 \
  @blackbelt-technology/pi-dashboard-client-utils@0.5.4 \
  @blackbelt-technology/pi-dashboard-shared@0.5.4 \
  @blackbelt-technology/dashboard-plugin-runtime@0.5.4 \
  @blackbelt-technology/pi-dashboard-subagents-plugin@0.5.4
```

Their peer dependencies you must satisfy:

| Package | peerDependencies |
|---|---|
| `pi-dashboard-client-utils` | `react`, `react-dom` |
| `dashboard-plugin-runtime` | `react`, `wouter` |
| `pi-dashboard-subagents-plugin` | `react` |

> `pi-dashboard-web` itself declares no peers; its needs come through the subtree.

### 3.2 React + router

```bash
npm install react@^19.0.0 react-dom@^19.0.0 wouter@^3.9.0
```

### 3.3 Runtime dependencies the `ChatView` subtree imports

Install these at the versions the dashboard is built against (mismatches on the
diff/markdown/xterm stacks cause subtle render bugs):

```bash
npm install \
  @tanstack/react-virtual@3.13.12 \
  @xterm/xterm@^6.0.0 @xterm/addon-attach@^0.12.0 @xterm/addon-fit@^0.11.0 \
  @git-diff-view/react@^0.1.3 @git-diff-view/file@^0.1.3 @git-diff-view/lowlight@^0.1.3 diff@^8.0.3 \
  react-markdown@^10.1.0 react-syntax-highlighter@^16.1.1 \
  remark-gfm@^4.0.1 remark-math@^6.0.0 remark-frontmatter@^5.0.0 \
  rehype-katex@^7.0.1 rehype-raw@^7.0.0 katex@^0.16.45 \
  @mdi/js@^7.4.47 @mdi/react@^1.6.1 yaml@^2.6.1
```

> `@tanstack/react-virtual` is **pinned exactly** (`3.13.12`) — match it. `katex`
> also needs its stylesheet imported once (§5).

### 3.4 Build-time / dev dependencies (Vite path)

```bash
npm install -D vite@^6.0.0 @vitejs/plugin-react@^4.3.4 \
  tailwindcss@^4.1.0 @tailwindcss/vite@^4.1.0 \
  typescript @types/react@^19 @types/react-dom@^19
```

---

## 4. Bundler configuration (Vite)

Two hard requirements: **(a)** transform the `@blackbelt-technology/*` packages
(they ship `.tsx` source, and `@vitejs/plugin-react` skips `node_modules` by
default), and **(b)** guarantee a **single React copy**.

```ts
// vite.config.ts
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const DASHBOARD = process.env.DASHBOARD_URL ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    // (b) One React. Hooks break across a dual-copy boundary.
    dedupe: ["react", "react-dom"],
    alias: {
      // Option B (git checkout): point the subpath at the source barrel.
      // Omit this once the package publishes src/ (Option A).
      "@blackbelt-technology/pi-dashboard-web/chat-embed":
        path.resolve(__dirname, "vendor/pi-agent-dashboard/packages/client/src/chat-embed/index.ts"),
    },
  },

  // (a) Pre-bundle (esbuild-transform) the source packages that live in
  // node_modules. Without this, their raw .tsx reaches the browser untransformed
  // ("Unexpected token <"). Add every @blackbelt-technology source package.
  optimizeDeps: {
    include: [
      "@blackbelt-technology/pi-dashboard-client-utils",
      "@blackbelt-technology/pi-dashboard-shared",
      "@blackbelt-technology/dashboard-plugin-runtime",
      "@blackbelt-technology/pi-dashboard-subagents-plugin",
    ],
    // Only needed if a package exposes bare .js containing JSX; harmless otherwise.
    esbuildOptions: { loader: { ".js": "jsx" } },
  },

  server: {
    // See §8 — proxy to the dashboard so the browser stays same-origin (no CORS).
    proxy: {
      "/ws":   { target: DASHBOARD, ws: true, changeOrigin: true },
      "/api":  { target: DASHBOARD, changeOrigin: true },
      "/auth": { target: DASHBOARD, changeOrigin: true },
    },
    host: true, // bind IPv4+IPv6; Vite's default is IPv6-loopback only
  },
});
```

**Why the monorepo doesn't need `optimizeDeps.include`:** inside this repo the
source packages resolve (via symlink/alias) to paths under `packages/`, i.e.
*outside* `node_modules`, so `@vitejs/plugin-react` transforms them as first-party
source. In an external app they are real `node_modules` installs, so you must opt
them into transformation via `optimizeDeps.include` (or an alias to a source path,
as with `chat-embed`).

> If a `@blackbelt` React **context** appears "undefined provider" at runtime, a
> package got bundled twice. Add it to `dedupe` alongside React, or make sure it
> is only pre-bundled once.

---

## 5. Tailwind v4 + theme CSS variables

The components use Tailwind utility classes **and** ~37 theme CSS custom
properties. Both must be present or the chat renders unstyled.

### 5.1 Tailwind content / source scanning

Tailwind v4 must scan the component source so it does not purge the classes the
chat uses. In your app's entry CSS:

```css
/* app.css */
@import "tailwindcss";

/* Scan the embeddable component source + its source-published siblings. */
@source "../vendor/pi-agent-dashboard/packages/client/src";
@source "../node_modules/@blackbelt-technology/pi-dashboard-client-utils/src";
@source "../node_modules/@blackbelt-technology/dashboard-plugin-runtime/src";
@source "../node_modules/@blackbelt-technology/pi-dashboard-subagents-plugin/src";
```

(Adjust the first path to wherever the `pi-dashboard-web` source lives in your
setup — the `vendor/` checkout for Option B, or
`node_modules/@blackbelt-technology/pi-dashboard-web/src` for Option A.)

### 5.2 KaTeX stylesheet (math rendering)

```ts
import "katex/dist/katex.min.css";
```

### 5.3 Theme variables (required)

`ThemeProvider` toggles a `data-theme` attribute but does **not** define the
variables — your stylesheet must. The full contract (define all of these):

```
--bg-primary --bg-secondary --bg-tertiary --bg-surface --bg-hover --bg-selected
--bg-code --bg-overlay --text-primary --text-secondary --text-tertiary
--text-muted --text-faint --border-primary --border-secondary --border-subtle
--accent-primary --accent-blue --accent-green --accent-orange --accent-purple
--accent-red --accent-yellow --link --link-hover --focus-ring --shadow-card
--elevation-rim --status-error --status-idle --status-needs-you --status-working
--neon-bg-tint --neon-glow-alpha --neon-glow-blur --neon-glow-opacity --neon-rim-alpha
```

**Easiest path:** copy the `:root { … }` (dark) and `[data-theme="light"] { … }`
blocks verbatim from `packages/client/src/index.css` (≈ lines 30–160) into your
`app.css`. If the package publishes its source (Option A) you may instead be able
to import it directly once a CSS export is added upstream:

```css
/* only if the package adds "./styles.css": "./src/index.css" to exports */
@import "@blackbelt-technology/pi-dashboard-web/styles.css";
```

Minimal dark-mode starter (enough to render legibly; not full fidelity):

```css
:root {
  --bg-primary:#0a0a0a; --bg-secondary:#141414; --bg-tertiary:#1e1e1e;
  --bg-surface:#2a2a2a; --bg-hover:rgba(255,255,255,.06); --bg-selected:#1e1e1e;
  --bg-code:#1a1a1a; --bg-overlay:rgba(0,0,0,.6);
  --text-primary:#e5e5e5; --text-secondary:#a3a3a3; --text-tertiary:#737373;
  --text-muted:#8a8a8a; --text-faint:#525252;
  --border-primary:#333; --border-secondary:#262626; --border-subtle:#1f1f1f;
  --accent-primary:#6366f1; --accent-blue:#3b82f6; --accent-green:#22c55e;
  --accent-orange:#f97316; --accent-purple:#a855f7; --accent-red:#ef4444;
  --accent-yellow:#eab308; --link:#60a5fa; --link-hover:#93c5fd;
  --focus-ring:#6366f1; --shadow-card:0 1px 2px rgba(0,0,0,.4); --elevation-rim:rgba(255,255,255,.04);
  --status-error:#ef4444; --status-idle:#737373; --status-needs-you:#eab308; --status-working:#22c55e;
  --neon-bg-tint:transparent; --neon-glow-alpha:0; --neon-glow-blur:0px; --neon-glow-opacity:0; --neon-rim-alpha:0;
}
```

---

## 6. The provider mount contract

`ChatView` reaches app-shell concerns through React context. A host **must** wrap
it in these providers. Import them all from the `chat-embed` barrel (except the
UI-primitive registry factory, which comes from `dashboard-plugin-runtime`):

| Provider | From | Prop | Notes |
|---|---|---|---|
| `ApiContext.Provider` | `chat-embed` | `value: string` (API base; `""` = same origin) | Raw context; there is **no** `ApiProvider`. |
| `UiPrimitiveProvider` | `chat-embed` (re-export) | `value: registry` | Build with `createUiPrimitiveRegistry()` from `dashboard-plugin-runtime`. An **empty** registry is fine for basic chat (see note). |
| `ThemeProvider` | `chat-embed` | `{ children }` | **Throws if absent.** Toggles `data-theme`. |
| `MobileProvider` | `chat-embed` | `{ children }` | Viewport/mobile context. |
| `SessionAssetsProvider` | `chat-embed` | `assets: SessionAssets \| undefined` | Resolves `pi-asset:` refs in markdown; `undefined` is fine. |
| `DisplayPrefsProvider` | `chat-embed` | `value: { global, getSessionOverride }` | `{ global: undefined, getSessionOverride: () => undefined }` → show everything. |
| `Router` | `wouter` | — | File-open routing uses wouter. |

**Do not** mount `FilePreviewProvider`/`FilePreviewHost` — `ChatView` self-mounts
them internally. `I18nProvider` is **optional** (`t()` is a module singleton; mount
only for runtime language switching).

> **Empty UI-primitive registry note:** `ChatView`'s own rendering (text,
> thinking, tool cards, terminals, diffs) never calls `useUiPrimitive`. Only
> *plugin slot* contributions do, and a bare embed wires no plugin `SlotRegistry`,
> so none fire. If you later render plugin cards (e.g. subagent inspector), you
> must register the corresponding primitives (see `packages/client/src/main.tsx`
> for the full registration list) or those specific cards throw (error-isolated).

---

## 7. Constructing `ToolContext`

`ChatView` requires a `toolContext` prop:

```ts
import type { ToolContext, SessionState } from "@blackbelt-technology/pi-dashboard-web/chat-embed";

const toolContext: ToolContext = {
  cwd: selectedSession?.cwd,   // string | undefined — the session's working dir
  editors: [],                 // DetectedEditor[] — [] disables "open in editor"
  sessionId: selected,         // string | undefined
  session: state,              // SessionState — the reduced state (from the hook)
};
```

`editors` is the only non-obvious field; pass `[]` unless you have a detected-editor
list to surface "open in $EDITOR" actions.

---

## 8. Talking to the dashboard (WebSocket protocol)

The chat is fed by the dashboard's browser WebSocket. `useSessionState` reduces the
message stream into `SessionState`; you own the socket.

### 8.1 Endpoints & auth

| | URL | Notes |
|---|---|---|
| WebSocket | `ws://<host>:8000/ws` | The browser gateway. |
| HTTP API | `http://<host>:8000/api/*` | File previews, prefs, etc. |

Local (loopback) connections are trusted without a token. Remote/authenticated
deployments require the dashboard's auth (cookie/ticket) — out of scope here.

### 8.2 CORS / same-origin

The dashboard's `corsAllowedOrigins` defaults to `[]`, so cross-origin `/api`
fetches are blocked. **Serve your app same-origin** by proxying `/ws` + `/api`
through your dev server (see the `server.proxy` block in §4) and using
`API_BASE = ""` + `ws://<your-app-host>/ws`. Alternatively, add your app's origin
to the dashboard's `corsAllowedOrigins` config.

### 8.3 Handshake

```ts
// 1. open
const ws = new WebSocket(`ws://${location.host}/ws`);   // proxied → :8000

// 2. server pushes the session catalogue on connect:
//    { type: "sessions_snapshot", sessions: DashboardSession[], orders }
//    then live: session_added / session_updated / session_removed

// 3. subscribe to one session (lastSeq:0 → full history replay, then live):
ws.send(JSON.stringify({ type: "subscribe", sessionId, lastSeq: 0 }));

// 4. server streams:  event / event_replay  (+ prompt_request, extension_ui_request, …)
//    → feed EVERY parsed message to useSessionState().apply(msg)
```

### 8.4 Messages you send (client → server)

| Purpose | Message |
|---|---|
| Subscribe | `{ type: "subscribe", sessionId, lastSeq: 0 }` |
| Send a prompt | `{ type: "send_prompt", sessionId, text, images?, delivery?: "steer"\|"followUp" }` |
| Abort the turn | `{ type: "abort", sessionId }` |
| Answer an `ask_user` | `{ type: "prompt_response", sessionId, promptId, answer?, cancelled?, source }` |

### 8.5 Messages `useSessionState` folds (server → client)

`event` (live), `event_replay` (history, with reset semantics),
`prompt_received`, `extension_ui_request`, `ui_dismiss`, `prompt_request`,
`prompt_dismiss`, `prompt_cancel`, `session_state_reset`. Everything else is a
no-op for `SessionState` — it is safe to pass the entire stream to `apply`.

---

## 9. Complete working example

A single-file mount. This is a distilled version of the runnable
[`main.tsx`](./main.tsx); read that for the session-picker + reconnection details.

```tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { Router } from "wouter";
import { createUiPrimitiveRegistry } from "@blackbelt-technology/dashboard-plugin-runtime";
import {
  ChatView, useSessionState,
  ApiContext, UiPrimitiveProvider, ThemeProvider, MobileProvider,
  SessionAssetsProvider, DisplayPrefsProvider,
  type ToolContext,
} from "@blackbelt-technology/pi-dashboard-web/chat-embed";
import "katex/dist/katex.min.css";
import "./app.css"; // Tailwind + theme vars (§5)

const WS_URL = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;
const REGISTRY = createUiPrimitiveRegistry();
const DISPLAY_PREFS = { global: undefined, getSessionOverride: () => undefined };

function ChatEmbed({ sessionId, cwd }: { sessionId: string; cwd?: string }) {
  const { state, apply, reset } = useSessionState(sessionId);

  // Bind the socket once; route to the latest `apply` via a ref.
  const applyRef = useRef(apply); applyRef.current = apply;
  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    ws.onopen = () => ws.send(JSON.stringify({ type: "subscribe", sessionId, lastSeq: 0 }));
    ws.onmessage = (ev) => { try { applyRef.current(JSON.parse(ev.data)); } catch {} };
    return () => { ws.onclose = null; ws.close(); reset(); };
  }, [sessionId, reset]);

  const send = (msg: unknown) => {}; // wire to the same socket if you need abort/respond
  const toolContext: ToolContext = useMemo(
    () => ({ cwd, editors: [], sessionId, session: state }),
    [cwd, sessionId, state],
  );

  // BOUNDED-HEIGHT parent — required by the virtualized transcript.
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <ChatView sessionId={sessionId} state={state} toolContext={toolContext} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <ApiContext.Provider value="">{/* same-origin via proxy */}
    <UiPrimitiveProvider value={REGISTRY}>
      <ThemeProvider>
        <MobileProvider>
          <SessionAssetsProvider assets={undefined}>
            <DisplayPrefsProvider value={DISPLAY_PREFS}>
              <Router>
                <ChatEmbed sessionId="<a-session-id>" />
              </Router>
            </DisplayPrefsProvider>
          </SessionAssetsProvider>
        </MobileProvider>
      </ThemeProvider>
    </UiPrimitiveProvider>
  </ApiContext.Provider>,
);
```

---

## 10. Full barrel export reference

From `@blackbelt-technology/pi-dashboard-web/chat-embed`:

**Components:** `ChatView`, `ChatViewMenu`, `CommandInput`, `QueuePanel`
**Hook + reducer:** `useSessionState`, `applySessionMessage`, `createSessionAccumulator`
**Providers / context:** `ThemeProvider`, `MobileProvider`, `SessionAssetsProvider`,
`DisplayPrefsProvider`, `UiPrimitiveProvider` (re-export), `ApiContext`, `useApiBase`
**Types:** `ChatViewProps`, `CommandInputProps`, `QueuePanelProps`, `SessionState`,
`ToolContext`, `ChatImage`, `InteractiveUiRequest`, `SessionStateAccumulator`,
`UseSessionStateResult`

---

## 11. Non-Vite bundlers (webpack / Next.js / Rspack)

The same two invariants apply:

- **Transform the source packages.** They ship `.tsx`. Configure your loader to
  include `node_modules/@blackbelt-technology/*` (and your `pi-dashboard-web`
  source path). e.g. webpack `babel-loader`/`swc-loader` with an `include` for
  those paths; Next.js `transpilePackages: ["@blackbelt-technology/pi-dashboard-client-utils", …]`.
- **Single React.** webpack `resolve.alias` react/react-dom to one path, or
  `resolve.dedupe`.

Server-side rendering: `ChatView` is client-only (WebSocket, xterm, virtualizer).
Render it in a client component / `dynamic(() => …, { ssr: false })`.

---

## 12. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Unexpected token '<'` / JSX syntax error from a `@blackbelt-technology/*` file | Source package not transformed | Add it to `optimizeDeps.include` (Vite) / loader `include` (§4, §11) |
| `Invalid hook call` / hooks throw | Two React copies | `resolve.dedupe: ["react","react-dom"]`; check a single version resolves |
| `useThemeContext must be used within ThemeProvider` | Missing provider | Mount `ThemeProvider` (§6) |
| Transcript is blank / doesn't scroll | Unbounded-height parent starves the virtualizer | Give `<ChatView>` a bounded-height flex/grid parent (§6, §9) |
| Chat renders unstyled / wrong colors | Missing Tailwind scan or theme vars | `@source` globs + define the CSS variables (§5) |
| `/api` requests fail with CORS | Cross-origin to the dashboard | Proxy `/ws`+`/api` same-origin, or set `corsAllowedOrigins` (§8.2) |
| `ECONNREFUSED 127.0.0.1:<port>` when proxying | Dev server bound IPv6-only | `server.host: true` (§4) |
| Module not found: `.../chat-embed` after `npm install` | Package tarball ships `dist/` only | Publish `src/` (Option A) or alias to a source checkout (Option B) — §2 |
| Subagent/plugin cards throw | Missing UI primitive | Register primitives (§6 note) or don't render plugin slots |

---

## 13. What is / isn't in scope for the embed

**In:** the live chat timeline at full fidelity, the display-prefs menu, the
steer/abort/fork input surface, and the headless state hook — all fed by the same
dashboard WebSocket protocol.

**Out:** the dashboard app shell (session list, settings, routing), plugin
**slot** rendering (needs the plugin `SlotRegistry` + primitive registrations),
and any server-side dashboard features. The embed is the chat surface, not the
whole dashboard.

---

**Reference implementation:** [`./main.tsx`](./main.tsx),
[`./vite.config.ts`](./vite.config.ts), [`./app.css`](./app.css),
[`./README.md`](./README.md). In-repo contract: `docs/embedding-chat-view.md`.
