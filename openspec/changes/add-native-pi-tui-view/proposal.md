## Why

Issue #468: "Would love a *Use native Pi UI* option." Two motivations, one ergonomic and one structural.

**Ergonomic:** users who already live in pi's TUI elsewhere pay a constant context-switch tax when the dashboard renders the same session differently. "The terminal window can run the TUI but it is awkward" — the capability technically exists (open a terminal card, type `pi`) but it is a *second, unrelated* session, not a view onto the one on the card.

**Structural:** the web chat can never reach parity. Extension entry renderers registered via `pi.registerEntryRenderer()` are **pi-TUI components that emit ANSI lines**. There is no general way to re-render them in React — `render-inline-reasoning-and-custom-entries` can only give them an honest generic fallback. Any user whose extension renders custom chat content is permanently second-class in the web view. A native TUI view is the only path to true parity, and the dashboard already owns every primitive needed to build it: a node-pty terminal manager, a WebSocket terminal gateway, an xterm.js view that already mounts *inside the chat stream* (`inline-terminal`), and a `spawnStrategy: "tmux"` that already launches a real interactive pi TUI.

## What Changes

A session gains a second, selectable chat surface: the **native view**, an xterm.js pane showing pi's own TUI. Three attachment tiers, chosen automatically by what the session actually is:

- **Tier A — dashboard-spawned under tmux (interactive).** `spawnStrategy: "tmux"` already runs pi as a TUI in tmux session `pi-dashboard`. The native view is a server-side PTY running `tmux attach` pinned to that session's window, streamed over the existing terminal gateway. Requires: the bridge reports its `TMUX_PANE` at register time (today a pane is only findable by scanning `PI_DASHBOARD_SPAWN_TOKEN`), and `TerminalManager.spawn()` accepts an argv instead of only spawning a bare shell.
- **Tier B — terminal-spawned, already under tmux (interactive).** Identical mechanism; the bridge reports `TMUX`/`TMUX_PANE` from the user's own tmux. Requires server and pi on the same host.
- **Tier C — no attachable PTY (read-only mirror).** The dashboard cannot attach to a foreign TTY (`reptyr` does not exist on macOS; `TIOCSTI` injection is blocked on current kernels). Instead the bridge **tees pi's rendered ANSI stream** when `ctx.mode === "tui"` and forwards it over the existing bridge WebSocket; the browser replays it into a read-only xterm. Input does not need the PTY — the dashboard already delivers prompts to terminal sessions through the bridge — so the surface is "native rendering + the existing prompt box". The mirror carries pi's real `columns`/`rows` so the browser pane can be pinned to those dimensions; a mismatched pane garbles output, so size is part of the contract, not a detail.
- **Headless has no TTY at all.** A `--mode rpc` session can never be mirrored. For those, the native view offers an explicit **respawn-under-tmux** action (fork/resume the session under `spawnStrategy: "tmux"`) rather than silently showing nothing. Never automatic — it is a process restart and the user must consent.
- **Setting.** Display preference `nativeTuiView: "off" | "auto" | "always"` (default `"off"`), global with the existing per-session override, **plus** a per-session toggle in the chat header so a user can flip surfaces without opening settings. `auto` = native whenever a tier A/B PTY is attachable, web chat otherwise. `always` = additionally accept the tier C read-only mirror.
- Not in scope: attaching across hosts, remoting a Windows console session, re-rendering pi's TUI as HTML, or replacing the web chat as the default surface.

## Capabilities

### New Capabilities
- `native-tui-view`: the view itself — tier selection, capability probing, per-session toggle, fallback ladder, and what happens when attachment fails mid-session.
- `tui-output-mirror`: the tier C read-only path — bridge-side ANSI tee, size reporting, bounded buffering/backpressure, replay on reconnect, and the read-only guarantee.
- `tmux-pane-attach`: locating and attaching a server PTY to a specific tmux window/pane, including multi-client sizing and detach/cleanup.

### Modified Capabilities
- `terminal-emulator`: `TerminalManager.spawn()` gains an argv/command so a PTY can run something other than the login shell.
- `session-spawn`: the tmux spawn path records the window/pane identity it creates, so the native view can target it.
- `chat-display-preferences`: adds `nativeTuiView` to `DisplayPrefs`, presets, and `mergeDisplayPrefs`.
- `settings-panel`: adds the `nativeTuiView` control.
- `chat-view`: the chat surface becomes selectable; states which surface renders and what the header toggle does.

## Impact

- `packages/server/src/terminal/terminal-manager.ts` — argv-capable spawn; a PTY whose command is `tmux attach`.
- `packages/server/src/terminal/terminal-gateway.ts` — reuse for the native pane; no new transport.
- `packages/server/src/spawn-process/process-manager.ts` — record the tmux window created by `buildTmuxCommand`.
- `packages/extension/src/` — report `TMUX`/`TMUX_PANE` + terminal size in `session_register`; the tier C stdout tee.
- `packages/shared/src/protocol.ts` — register-message fields, mirror frames, size updates.
- `packages/client/src/components/chat/` + `components/terminal/` — the native pane and the header toggle.
- **Security**: a tmux attach is an *interactive shell-adjacent surface* reached from the browser. Anyone who can open the native view can type into the user's real pi process. It must inherit the dashboard's existing terminal auth/authorization posture exactly, with no new bypass.
- **Platform**: tier A/B are POSIX+tmux only. Windows and no-tmux hosts land on tier C or the web chat; the tier ladder must degrade visibly, never silently.

## Discipline Skills

- `security-hardening` — a browser-reachable interactive attach to a live pi process, plus untrusted ANSI bytes rendered into xterm; authorization parity with the existing terminal surface is the central risk.
- `doubt-driven-review` — the tier ladder and the "respawn under tmux" action are the irreversible/expensive decisions; stress-test them before the specs stand.
- `performance-optimization` — a PTY stream at TUI redraw rates is a continuous high-frequency channel; it must not regress the transcript or the event pipeline. Budget before building.
- `observability-instrumentation` — attach/detach/tier-selection/mirror-drop need to be diagnosable; "the native view is blank" must have a readable cause.
- `systematic-debugging` — terminal sizing, tmux multi-client resize, and ANSI corruption are classic guess-and-fail territory; evidence first.
- `review-code` — multi-package change spanning extension, server, shared, and client.
