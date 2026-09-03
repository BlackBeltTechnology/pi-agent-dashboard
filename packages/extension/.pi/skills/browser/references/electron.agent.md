# electron.md — index

Pull-only condensed map. Source: packages/extension/.pi/skills/browser/references/electron.md. Electron app + CDP workflow → key command/fact.

## Core Workflow
- Loop — launch Electron with remote debugging → `agent-browser connect 9222` → `snapshot -i` → interact via `@eN` refs → re-snapshot after state change.
- Launch+connect — `open -a "Slack" --args --remote-debugging-port=9222`; `agent-browser connect 9222`.

## Launching Electron Apps with CDP
- Every Electron app supports `--remote-debugging-port` (built into Chromium).
- macOS — `open -a "<App>" --args --remote-debugging-port=9222`: Slack 9222, VS Code 9223, Discord 9224, Figma 9225, Notion 9226, Spotify 9227.
- Linux — `slack --remote-debugging-port=9222`, `code --remote-debugging-port=9223`, `discord --remote-debugging-port=9224`.
- Windows — full exe path: `"C:\Users\%USERNAME%\AppData\Local\slack\slack.exe" --remote-debugging-port=9222`, `...\Programs\Microsoft VS Code\Code.exe` 9223.
- Quit running instance first — flag must be present at launch time; relaunch with flag.

## Connecting
- `agent-browser connect 9222` — subsequent commands target connected app, no `--cdp` needed.
- `--cdp 9222` per command; `--auto-connect` discovers a running Chromium-based app.

## Tab Management
- `agent-browser tab` — list all targets (windows, webviews).
- `tab 2` switch by index; `tab --url "*settings*"` switch by URL pattern.

## Webview Support
- Electron `<webview>` elements auto-discovered as targets with `type: "webview"`.
- Switch via `agent-browser tab 1`, then interact normally (snapshot, click, screenshot).
- Works via raw CDP connection.

## Common Patterns
- Inspect+Navigate — launch, `sleep 3`, connect, snapshot, `click @eN`, re-snapshot.
- Screenshots — `screenshot app-state.png`, `--full`, `--annotate`.
- Extract data — snapshot -i, `get text @e5`, `snapshot --json > app-state.json`.
- Fill forms — snapshot, fill, `press Enter`, `wait 1000`.
- Multiple apps — `--session slack connect 9222` / `--session vscode connect 9223`; interact independently.

## Color Scheme
- CDP default may be `light` — `--color-scheme dark snapshot -i` or `AGENT_BROWSER_COLOR_SCHEME=dark`.

## Troubleshooting
- "Connection refused"/"Cannot connect" — app not launched with flag; was already running (quit + relaunch); port in use — `lsof -i :9222`.
- App launches but connect fails — `sleep 3` after launch; webview init takes time.
- Elements missing in snapshot — multiple webviews; `agent-browser tab` to list, switch to right target.
- Cannot type — `keyboard type "text"` at current focus (no selector) or `keyboard inserttext "text"` to bypass key events (custom input components).

## Supported Apps
- Any Electron app works — Slack, Discord, Teams, Signal, Telegram Desktop; VS Code, GitHub Desktop, Postman, Insomnia; Figma, Notion, Obsidian; Spotify, Tidal; Todoist, Linear, 1Password.

## Worked example: Pi Dashboard
- Opt-in CDP — `--debug-cdp` CLI flag or `PI_DEBUG_CDP` env var; flag takes precedence; default port 9222.
- Single-instance contract — must fully quit + relaunch; `--debug-cdp` on a running instance only logs a warning to stderr; Chromium stands up CDP server at browser-process init, no API to enable later.
- macOS — `osascript -e 'quit app "PI Dashboard"'`; `open -a "PI Dashboard" --args --debug-cdp` (default 9222); custom port `--debug-cdp=9333`.
- Linux/Windows — `PI_DEBUG_CDP=1 /path/to/pi-dashboard` (default 9222); `PI_DEBUG_CDP=9444` custom port.
- Dev (this repo) — `cd packages/electron && npm run dev:cdp`.
- Activation proof — stderr line `[debug-cdp] CDP listening on :9222 — local automation is enabled`; line missing = CDP not active → halt recipe, tell user to relaunch with flag.
- Connect + list windows — `agent-browser connect 9222`; `agent-browser tab` shows main window `http://localhost:8000/`, wizard `file:///.../wizard.html`, doctor `file:///.../doctor.html`; switch with `tab <index>`.
- Drive windows — `tab 0` + `screenshot pi-dashboard.png` (main); `tab 1` + `snapshot -i` → click "Launch dashboard" (wizard); `tab 2` + `screenshot doctor.png` (doctor).
- Cleanup — `agent-browser close` disconnects session but does NOT quit the app (CDP stays active for next connection); end CDP entirely by quitting the app.
