# faq.md — index

Recurring how-to + troubleshooting questions. Caveman style. Cross-refs README.md + docs/. Topics: media preview (PDF/video/AsciiDoc/YouTube); install paths (Electron/pi package/source, Windows Setup.exe/.zip/tarball/air-gapped); server start/daemon/status/auto-start; config; LAN exposure + pairing; OAuth; zrok tunnel + watchdog; headless-vs-tmux + session-type spawn; release/build/auto-update; npm Trusted Publishers; plugin architecture/slots; Electron native surfaces (tray, Doctor, white-screen VM, bundled native modules, `__dirname`, Vite main+preload); session-resume + spawn troubleshooting (Windows ENOENT, long paths, Gemini subagents, Node version updates); global-skill project disable persistence (file re-declare + anchored glob, session-start resolve, trust prompt, unparseable settings 409). trusted-network-vs-bind reachability (bind host voids trust; Tailscale `100.64.0.0/10` offer instead of `<self>/32`). Apple tools via iMCP + `pi-mcp-adapter` (Calendar/Contacts/Reminders, no Mail service). Connecting Claude Code / Cursor to dashboard MCP (Settings → Security → Paired Devices token mint, snippet, tunnel reachability, shell history hazard, legacy vs modern streaming capability, shutdown DELETE 405). See change: mcp-legacy-clients-and-token-issuance.

Gains "Why does my session die whenever it spawns subagents?": wide fan-out parent event loop stall mitigation, bridge admission gate, `maxConcurrentSubagents` config knob, saturation narrowing to 1, terminal refusal results, durable `subagent-admission-refused` record, grandchildren/flow scope caveat. See change: bound-subagent-fanout-under-host-pressure.

Caveman style. Cross-refs README.md + docs/. Auto-naming entry: starved vs waiting, budget, stop persistence

Gains “Why do the OpenSpec buttons do nothing?” → per-state fixes. See change: add-openspec-init-affordances. 

Gains "Doctrine not injected / first-contact nudge keeps firing?" → extension-not-loaded, missing doctrine key, legacy `AGENTS.md`, malformed config, `write` flag. See change: inject-dox-doctrine-and-describe. 

Gains "Why is a subagent or tool card stuck `running` after the session ended?" → orphan heal on `onEnded`, open-work derivation, synthesized `tool_execution_end` / `subagent_failed`, cold hydration parity. See change: heal-orphaned-tool-cards-on-session-end. 

Gains "Plugin pages 403 `network_not_allowed` after upgrade?" → auth-off tunnel + plugin/provider-auth API routes now guarded, app shell unaffected, remedy enable auth or add trusted network (Settings ▸ Servers). See change: add-universal-network-guard.
