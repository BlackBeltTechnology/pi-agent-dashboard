# Isolated UI / Worktree Verification

How to visually/functionally verify a dashboard change, build a review mockup, or confirm worktree edits actually load — **without disturbing the live dashboard**. The live server on `:8000` runs MAIN-repo code, so naive browser checks verify the wrong code, and a careless isolated env can clobber live infra.

## Core rule

The live `:8000` server runs from the MAIN repo checkout (`…/pi-agent-dashboard/packages/server/src/cli.ts`), NOT a git worktree. `/api/restart` and `pi-dashboard restart` restart MAIN-repo code — **worktree edits never load there**. Confirm the live root via `lsof -i:8000` / `ps` → `cli.ts` path before and after any isolated run; the original PID must be unchanged.

## Procedure

1. **ISOLATION.** Run any test/verify server in a fully isolated env — temp `HOME` (`mktemp -d`), separate ports, network-silent (`PI_DASHBOARD_NO_MDNS=1`, no tunnel, `autoStart:false`) so live infra stays untouched. In a git worktree, use the parent/main worktree's openspec definitions + skills, not worktree-local copies.
2. **ALWAYS verify UI in a real browser**, not just programmatic asserts.
3. **LIVE MOCKUPS.** Serve mockups from a live local static server on `0.0.0.0` (`python3 -m http.server`), hand back a clickable link (local + LAN IP for phone) — NOT screenshots. Iterate conversationally (presets + sliders) before committing.
4. **GROUND MOCKUPS in the real current UI.** Open the running dashboard + read the authoritative source component (e.g. `packages/client/src/components/SessionCard.tsx`) to capture exact tokens (classes like `rounded-xl shadow-md border bg-[--bg-tertiary]`, `px-4 py-3`; CSS vars `--bg-tertiary` #1e1e1e dark / #fff light). Slot new surfaces into that layout, verify dark+light via the live mockup. Proposal mockups go to `openspec/changes/<name>/mockups/` (HTML + `ui-plan.md` mapping surfaces→slots/states).
5. **STYLING TASTE.** To separate stacked cards from a container, RECEDE cards to a darker tier (`--bg-primary` #0a0a0a, below the #141414 container), not a lighter "raised card". Sidebar dir cards: bg #0a0a0a, 1px border rgba(255,255,255,0.1), 5px gap, 14px radius.
6. **VERIFY WORKTREE CODE.** To verify worktree code in a real browser without disturbing live infra: write a standalone harness `tmp-*.mts` (run with the repo jiti/node TS runner) that imports the WORKTREE module directly (e.g. `editor-manager.ts`), pointed at an isolated temp HOME + temp project dir, spawn the real child (code-server), open its port in the browser. Delete the harness after.

## Pitfalls

- **Cannot surface a historical/ended session in a fresh isolated server.** The dashboard is a LIVE aggregator: the event store is IN-MEMORY (`memory-event-store.ts`, "Replaces SQLite-backed event-store.ts"), the sidebar lists only live-bridge-connected sessions, and a transcript is loaded from the pi session's JSONL on disk on `subscribe` (keyed off a `sessionManager` entry with `sessionFile`). `~/.pi/dashboard/dashboard.db` (`sessions`/`events` tables) is LEGACY/unused by current code — copying it into an isolated HOME yields 0 sessions and no replay. To verify a real long transcript either (a) deploy to the live server that already has the session, or (b) build a standalone ChatView harness: read events from the db `events` table (`data` column = JSON per row), fold them through `reduceEvent`, mount `<ChatView state={folded}>` in a Vite entry. This validates rendering/animations/clipping but NOT scroll-anchoring (that needs the real app shell).
- **Building leaks to live.** `@blackbelt-technology/pi-dashboard-web` symlinks to `packages/client`; `npm run build` writes `packages/client/dist`, which is exactly what the live server serves (via `require.resolve` → that dist; no `clientDir` override env exists). So a plain `npm run build` for an "isolated" test leaks your changes to the live dashboard on its next page load. For a leak-free isolated client, run Vite dev (`PI_DASHBOARD_PORT=<isoPort> npm run dev`, serves worktree source, proxies `/api`+`/ws`) against an isolated backend, and never build into `packages/client/dist`.
- **`os.homedir()` DOES honor `$HOME` here** (verified on macOS+Node), so `HOME=$(mktemp -d)` fully isolates the server's config/db/dirs. Launch the foreground server directly (`HOME=<iso> PI_DASHBOARD_NO_MDNS=1 node packages/server/bin/pi-dashboard.mjs --port <p> --pi-port <pp>`) so you own the PID and kill by PID — never `pi-dashboard stop` (it kills `:8000` via stale-port lsof).
- **Do NOT leave openspec poll enabled during browser QA on this repo** (many active changes) — it starves the WS heartbeat → blank client + dropped bridge. Set `enabled:false` in the isolated HOME config first.

## Verification

1. Isolated server runs on non-8000 ports with temp HOME; `lsof -i:8000` still shows the original live server PID unchanged.
2. Browser loads the isolated port and shows the NEW behavior (worktree/edit under test), not stale main-repo behavior.
3. Mockup reachable via the handed-back local + LAN URL and renders correctly in both dark and light.
