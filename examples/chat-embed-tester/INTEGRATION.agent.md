# INTEGRATION — index

Guide: embed pi-dashboard live agent chat (`ChatView` + `useSessionState`) into external React app outside monorepo. Public surface: subpath export `@blackbelt-technology/pi-dashboard-web/chat-embed`. Terse in-repo contract: `docs/embedding-chat-view.md`. Runnable ref: `main.tsx`, `vite.config.ts`, `app.css`.

## §0 TL;DR
6 steps: get source on disk → install React 19 + wouter + runtime deps → bundler transforms `@blackbelt-technology/*` source + dedupes React → Tailwind v4 + theme CSS vars → mount `<ChatView>` in providers + bounded-height container → open WS, `subscribe`, feed messages to `useSessionState().apply`.

## §1 Compatibility matrix
React/React-DOM `^19.0.0` (exactly one copy). Node `>=22.19.0 <27`. Vite 6. `wouter ^3.9.0` (required). Tailwind v4 `^4.1.0`. `@blackbelt-technology/*` `0.5.4` lockstep.

## §2 Get embeddable source on disk
`chat-embed` ships raw `.tsx`; bundler owns transform. `pi-dashboard-web` publishes `files:["dist/"]` but `exports` points `./chat-embed` at `./src/chat-embed/index.ts` → plain install fails. Option A: publish `src/` (add to `files`, target state). Option B: git checkout + vite alias subpath → `vendor/.../packages/client/src/chat-embed/index.ts` (works today). Option C: vendor everything. Recommend B→A.

## §3 Dependencies
- §3.1 five `@blackbelt-technology/*` pkgs @0.5.4 (web, client-utils, shared, dashboard-plugin-runtime, subagents-plugin). Peers: react/react-dom/wouter per pkg.
- §3.2 `react@^19` `react-dom@^19` `wouter@^3.9.0`.
- §3.3 runtime subtree deps: `@tanstack/react-virtual@3.13.12` (pinned exact), xterm stack, `@git-diff-view/*`, `diff@^8`, react-markdown/remark/rehype/katex, `@mdi/*`, `yaml`.
- §3.4 dev: `vite@^6`, `@vitejs/plugin-react`, `tailwindcss@^4.1.0`, `@tailwindcss/vite`, typescript, `@types/react@^19`.

## §4 Bundler config (Vite)
Two hard requirements: (a) transform `@blackbelt-technology/*` `.tsx` via `optimizeDeps.include`; (b) single React via `resolve.dedupe:["react","react-dom"]`. Alias `chat-embed` subpath (Option B). `server.proxy` for `/ws`(ws:true)+`/api`+`/auth` → dashboard. `server.host:true` (IPv4+IPv6). Monorepo skips `optimizeDeps` (source resolves outside node_modules).

## §5 Tailwind v4 + theme CSS variables
- §5.1 `@source` globs scan component source + sibling `src/` so classes not purged.
- §5.2 `import "katex/dist/katex.min.css"`.
- §5.3 `ThemeProvider` toggles `data-theme` but does NOT define vars; stylesheet must. ~37 vars: `--bg-*`, `--text-*`, `--border-*`, `--accent-*`, `--link*`, `--focus-ring`, `--shadow-card`, `--status-*`, `--neon-*`. Easiest: copy `:root`/`[data-theme="light"]` from `packages/client/src/index.css` (~lines 30–160). Minimal dark starter provided.

## §6 Provider mount contract
`ChatView` needs context wrappers: `ApiContext.Provider` (value string, `""`=same origin, no `ApiProvider`), `UiPrimitiveProvider` (from `createUiPrimitiveRegistry()`, empty ok), `ThemeProvider` (throws if absent), `MobileProvider`, `SessionAssetsProvider` (undefined ok), `DisplayPrefsProvider` (`{global:undefined, getSessionOverride:()=>undefined}`), `Router` (wouter). Do NOT mount `FilePreviewProvider`/`Host` (self-mounted). `I18nProvider` optional. Empty registry ok — ChatView rendering never calls `useUiPrimitive`, only plugin slots do.

## §7 Constructing ToolContext
`ToolContext = { cwd?, editors: DetectedEditor[] (`[]` disables open-in-editor), sessionId?, session: SessionState }`.

## §8 WebSocket protocol
- §8.1 WS `ws://<host>:8000/ws`, HTTP `/api/*`. Loopback trusted no token; remote needs auth.
- §8.2 CORS: `corsAllowedOrigins` defaults `[]`; serve same-origin via proxy, `API_BASE=""`.
- §8.3 handshake: open → server pushes `sessions_snapshot` + `session_added/updated/removed` → `subscribe {sessionId,lastSeq:0}` → server streams `event`/`event_replay` → feed every msg to `apply`.
- §8.4 client→server: `subscribe`, `send_prompt {text,images?,delivery:steer|followUp}`, `abort`, `prompt_response {promptId,answer?,cancelled?,source}`.
- §8.5 folded server→client: `event`, `event_replay`, `prompt_received`, `extension_ui_request`, `ui_dismiss`, `prompt_request`, `prompt_dismiss`, `prompt_cancel`, `session_state_reset`. Rest no-op; safe to pass whole stream.

## §9 Complete working example
Single-file mount. Bind socket once, route to latest `apply` via ref. Bounded-height parent required by virtualized transcript. Full nesting: ApiContext→UiPrimitive→Theme→Mobile→SessionAssets→DisplayPrefs→Router→ChatEmbed.

## §10 Barrel export reference
Components: `ChatView`, `ChatViewMenu`, `CommandInput`, `QueuePanel`. Hook/reducer: `useSessionState`, `applySessionMessage`, `createSessionAccumulator`. Providers/context: Theme/Mobile/SessionAssets/DisplayPrefs/UiPrimitive Provider, `ApiContext`, `useApiBase`. Types: `ChatViewProps`, `SessionState`, `ToolContext`, `ChatImage`, `InteractiveUiRequest`, etc.

## §11 Non-Vite bundlers
Same invariants: transform source pkgs (webpack `babel/swc-loader include`, Next `transpilePackages`); single React (`resolve.alias`/dedupe). SSR: ChatView client-only → `dynamic(...,{ssr:false})`.

## §12 Troubleshooting
`Unexpected token '<'`→not transformed; `Invalid hook call`→two React; `useThemeContext...`→missing ThemeProvider; blank transcript→unbounded-height parent; unstyled→missing @source/vars; CORS→proxy; ECONNREFUSED→`server.host:true`; module not found chat-embed→publish src/ or alias.

## §13 Scope
In: live chat timeline full fidelity, display-prefs menu, steer/abort/fork input, headless state hook. Out: dashboard app shell, plugin slot rendering, server-side features.
