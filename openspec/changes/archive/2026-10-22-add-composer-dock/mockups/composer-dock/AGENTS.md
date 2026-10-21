# DOX — openspec/changes/add-composer-dock/mockups/composer-dock

As-built vs proposed static board for change `add-composer-dock` (explore option C). Open `index.html` via `serve_mockup`. No app code touched. See change: add-composer-dock.

| File | Purpose |
|---|---|
| `AGENTS.md` | Per-file record for this dir. |
| `asbuilt.css` | Replica of shipped chat-pane bottom stack (context strip `ToolbarGroup`s, `StatusBar`, `QueuePanel`, `YoloComposerStrip` `.ab-yolo`, `CommandInput` card). Raw palette literals on purpose (shipped debt). Probe-exempt. |
| `board.css` | Board chrome: toolbar, nav, frame captions, `data-view` both/asbuilt/proposed. Tokens only. |
| `dock.css` | Proposed recipes: `.dock` (flex column, overflow hidden) → `.dock-scroll` (lanes scroll) + `.dock-yolo` footer (warning triple, `.heavy` unscoped, never scrolls) / `.lane` / `.wait-pill` (neutral) / stretched `.lane-toggle` / `.lrow` / `.lc-seg` lifecycle / `.dock-sum` compact chips / `.card` / `.tb` toolbar / `.ring` / `.model-chip` / `.act` action / `.menu`. Width classes `w-mid` <880, `w-narrow` <640, `w-xs` <420, `vp-mobile` ≤390. Tokens only; one `#fff` on `--accent-solid`. |
| `icons.js` | `ICON` map generated from `@mdi/js` (54 + ShieldAlertOutline, OpenInNew, TextSearch, PlayCircleOutline, TimerSandEmpty). |
| `index.html` | Board shell. `renderScenario(id, keep)`, per-frame state map `FRAMES`, click delegation (`data-act` lane / menu), Escape closes menus, probe badge. Query params `theme`, `width`, `view`. |
| `probe.js` | Contrast + text-size probe (computed-contrast rules, copied from improve-canvas-html-and-url-ux kit) plus 24 px target check. `__probeAll()` per scenario, proposed frames only. |
| `scenarios.js` | Data (`PROCS`, `SUBAGENTS`, `COMMANDS`, `FILES`, `TASKS`, `QUEUE`, `YOLO` scoped/unscoped copy from `yolo.coverage*`) + renderers: `laneModels` (one lane shape; Processes groups Subagents/Commands/Background) → `dockRows` (wide) / `dockCompact` (<520), both via `dockShell` (scroll region + `yoloLine` footer + sibling sr-only status); `card`, `plusMenu`, `deliveryMenu`, `modelPop`, `actionCluster`, `ring` (every width, non-focusable meter), `asBuiltPane`. `SCENARIOS` S1–S8 (S6 YOLO) with D1–D24. |
| `tokens.css` | Theme tokens (base dark, base light, nord dark). Copied unchanged from improve-canvas-html-and-url-ux kit. |
| `ui-plan.md` | Surface, lane→source→actions table, token map, states, decisions D1–D24, spec impact, probe + rubric, resolved answers, cross-board opens (session-header-reorg D10). |
