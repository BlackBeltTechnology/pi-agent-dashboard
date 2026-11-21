// Settings search mockup. In-memory only. Labels mirror SettingsPanel.tsx.
(function () {
  "use strict";
  const ICON = {
    key: "M7 14A2 2 0 0 1 5 12A2 2 0 0 1 7 10A2 2 0 0 1 9 12A2 2 0 0 1 7 14M12.65 10C11.83 7.67 9.61 6 7 6A6 6 0 0 0 1 12A6 6 0 0 0 7 18C9.61 18 11.83 16.33 12.65 14H17V18H21V14H23V10H12.65Z",
    tune: "M3 17V19H9V17H3M3 5V7H13V5H3M13 21V19H21V17H13V15H11V21H13M7 9V11H3V13H7V15H9V9H7M21 13V11H11V13H21M15 9H17V7H21V5H17V3H15V9Z",
    cog: "M12 15.5A3.5 3.5 0 0 1 8.5 12A3.5 3.5 0 0 1 12 8.5A3.5 3.5 0 0 1 15.5 12A3.5 3.5 0 0 1 12 15.5M19.43 12.97C19.47 12.65 19.5 12.33 19.5 12C19.5 11.67 19.47 11.34 19.43 11L21.54 9.37C21.73 9.22 21.78 8.95 21.66 8.73L19.66 5.27C19.54 5.05 19.27 4.96 19.05 5.05L16.56 6.05C16.04 5.66 15.5 5.32 14.87 5.07L14.5 2.42C14.46 2.18 14.25 2 14 2H10C9.75 2 9.54 2.18 9.5 2.42L9.13 5.07C8.5 5.32 7.96 5.66 7.44 6.05L4.95 5.05C4.73 4.96 4.46 5.05 4.34 5.27L2.34 8.73C2.21 8.95 2.27 9.22 2.46 9.37L4.57 11C4.53 11.34 4.5 11.67 4.5 12C4.5 12.33 4.53 12.65 4.57 12.97L2.46 14.63C2.27 14.78 2.21 15.05 2.34 15.27L4.34 18.73C4.46 18.95 4.73 19.03 4.95 18.95L7.44 17.94C7.96 18.34 8.5 18.68 9.13 18.93L9.5 21.58C9.54 21.82 9.75 22 10 22H14C14.25 22 14.46 21.82 14.5 21.58L14.87 18.93C15.5 18.67 16.04 18.34 16.56 17.94L19.05 18.95C19.27 19.03 19.54 18.95 19.66 18.73L21.66 15.27C21.78 15.05 21.73 14.78 21.54 14.63L19.43 12.97Z",
    server: "M4 1H20A1 1 0 0 1 21 2V6A1 1 0 0 1 20 7H4A1 1 0 0 1 3 6V2A1 1 0 0 1 4 1M4 9H20A1 1 0 0 1 21 10V14A1 1 0 0 1 20 15H4A1 1 0 0 1 3 14V10A1 1 0 0 1 4 9M4 17H20A1 1 0 0 1 21 18V22A1 1 0 0 1 20 23H4A1 1 0 0 1 3 22V18A1 1 0 0 1 4 17M9 5H10V3H9V5M9 13H10V11H9V13M9 21H10V19H9V21M5 3V5H7V3H5M5 11V13H7V11H5M5 19V21H7V19H5Z",
    grid: "M13 3V9H21V3M13 21H21V11H13M3 21H11V15H3M3 13H11V3H3V13Z",
    web: "M16.36 14C16.44 13.34 16.5 12.68 16.5 12C16.5 11.32 16.44 10.66 16.36 10H19.74C19.9 10.64 20 11.31 20 12C20 12.69 19.9 13.36 19.74 14M14.59 19.56C15.19 18.45 15.65 17.25 15.97 16H18.92C17.96 17.65 16.43 18.93 14.59 19.56M14.34 14H9.66C9.56 13.34 9.5 12.68 9.5 12C9.5 11.32 9.56 10.65 9.66 10H14.34C14.43 10.65 14.5 11.32 14.5 12C14.5 12.68 14.43 13.34 14.34 14M12 19.96C11.17 18.76 10.5 17.43 10.09 16H13.91C13.5 17.43 12.83 18.76 12 19.96M8 8H5.08C6.03 6.34 7.57 5.06 9.4 4.44C8.8 5.55 8.35 6.75 8 8M5.08 16H8C8.35 17.25 8.8 18.45 9.4 19.56C7.57 18.93 6.03 17.65 5.08 16M4.26 14C4.1 13.36 4 12.69 4 12C4 11.31 4.1 10.64 4.26 10H7.64C7.56 10.66 7.5 11.32 7.5 12C7.5 12.68 7.56 13.34 7.64 14M12 4.03C12.83 5.23 13.5 6.57 13.91 8H10.09C10.5 6.57 11.17 5.23 12 4.03M18.92 8H15.97C15.65 6.75 15.19 5.55 14.59 4.44C16.43 5.07 17.96 6.34 18.92 8M12 2C6.47 2 2 6.5 2 12A10 10 0 0 0 12 22A10 10 0 0 0 22 12A10 10 0 0 0 12 2Z",
    lock: "M12 17A2 2 0 0 0 14 15C14 13.89 13.1 13 12 13A2 2 0 0 0 10 15A2 2 0 0 0 12 17M18 8A2 2 0 0 1 20 10V20A2 2 0 0 1 18 22H6A2 2 0 0 1 4 20V10C4 8.89 4.9 8 6 8H7V6A5 5 0 0 1 12 1A5 5 0 0 1 17 6V8H18M12 3A3 3 0 0 0 9 6V8H15V6A3 3 0 0 0 12 3Z",
    cube: "M21 16.5C21 16.88 20.79 17.21 20.47 17.38L12.57 21.82C12.41 21.94 12.21 22 12 22C11.79 22 11.59 21.94 11.43 21.82L3.53 17.38C3.21 17.21 3 16.88 3 16.5V7.5C3 7.12 3.21 6.79 3.53 6.62L11.43 2.18C11.59 2.06 11.79 2 12 2C12.21 2 12.41 2.06 12.57 2.18L20.47 6.62C20.79 6.79 21 7.12 21 7.5V16.5M12 4.15L6.04 7.5L12 10.85L17.96 7.5L12 4.15Z",
    puzzle: "M20.5 11H19V7C19 5.89 18.1 5 17 5H13V3.5A2.5 2.5 0 0 0 10.5 1A2.5 2.5 0 0 0 8 3.5V5H4A2 2 0 0 0 2 7V10.8H3.5C5 10.8 6.2 12 6.2 13.5C6.2 15 5 16.2 3.5 16.2H2V20A2 2 0 0 0 4 22H7.8V20.5C7.8 19 9 17.8 10.5 17.8C12 17.8 13.2 19 13.2 20.5V22H17A2 2 0 0 0 19 20V16H20.5A2.5 2.5 0 0 0 23 13.5A2.5 2.5 0 0 0 20.5 11Z",
    wrench: "M22.7 19L13.6 9.9C14.5 7.6 14 4.9 12.1 3C10.1 1 7.1 0.6 4.7 1.7L9 6L6 9L1.6 4.7C0.4 7.1 0.9 10.1 2.9 12.1C4.8 14 7.5 14.5 9.8 13.6L18.9 22.7C19.3 23.1 19.9 23.1 20.3 22.7L22.6 20.4C23.1 20 23.1 19.3 22.7 19Z",
    file: "M14 2H6A2 2 0 0 0 4 4V20A2 2 0 0 0 6 22H18A2 2 0 0 0 20 20V8L14 2M18 20H6V4H13V9H18V20Z",
    pkg: "M2 10.96C1.5 10.68 1.35 10.07 1.63 9.59L3.13 7C3.24 6.8 3.41 6.66 3.6 6.58L11.43 2.18C11.59 2.06 11.79 2 12 2C12.21 2 12.41 2.06 12.57 2.18L20.47 6.62C20.66 6.72 20.82 6.88 20.91 7.08L22.36 9.6C22.64 10.08 22.47 10.69 22 10.96L21 11.54V16.5C21 16.88 20.79 17.21 20.47 17.38L12.57 21.82C12.41 21.94 12.21 22 12 22C11.79 22 11.59 21.94 11.43 21.82L3.53 17.38C3.21 17.21 3 16.88 3 16.5V10.96Z",
    cards: "M21.47 4.35L20.13 3.79V12.82L22.56 6.96C22.97 5.94 22.5 4.77 21.47 4.35M1.97 8.05L6.93 20C7.24 20.77 7.97 21.24 8.74 21.26C9 21.26 9.27 21.21 9.53 21.1L16.9 18.05C17.65 17.74 18.11 17 18.13 16.26C18.14 16 18.09 15.71 18 15.45L13 3.5C12.71 2.73 11.97 2.26 11.19 2.25C10.93 2.25 10.67 2.31 10.42 2.4L3.06 5.45C2.04 5.87 1.55 7.04 1.97 8.05M18.12 4.25A2 2 0 0 0 16.12 2.25H14.67L18.12 10.59",
    book: "M19 2L14 6.5V17.5L19 13V2M6.5 5C4.55 5 2.45 5.4 1 6.5V21.16C1 21.41 1.25 21.66 1.5 21.66C1.6 21.66 1.65 21.59 1.75 21.59C3.1 20.94 5.05 20.5 6.5 20.5C8.45 20.5 10.55 20.9 12 22C13.35 21.15 15.8 20.5 17.5 20.5C19.15 20.5 20.85 20.81 22.25 21.56C22.35 21.61 22.4 21.59 22.5 21.59C22.75 21.59 23 21.34 23 21.09V6.5C22.4 6.05 21.75 5.75 21 5.5V19C19.9 18.65 18.7 18.5 17.5 18.5C15.8 18.5 13.35 19.15 12 20V6.5C10.55 5.4 8.45 5 6.5 5Z",
    robot: "M12 2A2 2 0 0 1 14 4C14 4.74 13.6 5.39 13 5.73V7H14A7 7 0 0 1 21 14H22A1 1 0 0 1 23 15V18A1 1 0 0 1 22 19H21V20A2 2 0 0 1 19 22H5A2 2 0 0 1 3 20V19H2A1 1 0 0 1 1 18V15A1 1 0 0 1 2 14H3A7 7 0 0 1 10 7H11V5.73C10.4 5.39 10 4.74 10 4A2 2 0 0 1 12 2M7.5 13A2.5 2.5 0 0 0 5 15.5A2.5 2.5 0 0 0 7.5 18A2.5 2.5 0 0 0 10 15.5A2.5 2.5 0 0 0 7.5 13M16.5 13A2.5 2.5 0 0 0 14 15.5A2.5 2.5 0 0 0 16.5 18A2.5 2.5 0 0 0 19 15.5A2.5 2.5 0 0 0 16.5 13Z",
    text: "M14 2H6C4.89 2 4 2.89 4 4V20C4 21.11 4.89 22 6 22H18C19.11 22 20 21.11 20 20V8L14 2M18 20H6V4H13V9H18V20M8 12V14H16V12H8M8 16V18H13V16H8Z",
    palette: "M17.5 12A1.5 1.5 0 0 1 16 10.5A1.5 1.5 0 0 1 17.5 9A1.5 1.5 0 0 1 19 10.5A1.5 1.5 0 0 1 17.5 12M14.5 8A1.5 1.5 0 0 1 13 6.5A1.5 1.5 0 0 1 14.5 5A1.5 1.5 0 0 1 16 6.5A1.5 1.5 0 0 1 14.5 8M9.5 8A1.5 1.5 0 0 1 8 6.5A1.5 1.5 0 0 1 9.5 5A1.5 1.5 0 0 1 11 6.5A1.5 1.5 0 0 1 9.5 8M6.5 12A1.5 1.5 0 0 1 5 10.5A1.5 1.5 0 0 1 6.5 9A1.5 1.5 0 0 1 8 10.5A1.5 1.5 0 0 1 6.5 12M12 3A9 9 0 0 0 3 12A9 9 0 0 0 12 21A1.5 1.5 0 0 0 13.5 19.5C13.5 19.11 13.35 18.76 13.11 18.5C12.88 18.23 12.73 17.88 12.73 17.5A1.5 1.5 0 0 1 14.23 16H16A5 5 0 0 0 21 11C21 6.58 16.97 3 12 3Z",
  };

  // Static index: page -> sections -> fields. kw = synonyms, key = config path.
  const GROUPS = [
    { id: "models", label: "Models", pages: [
      { id: "providers", label: "Providers", icon: "key", sections: [
        { title: "Provider Authentication", fields: [
          { label: "Anthropic API key", type: "text", key: "providers.anthropic.apiKey", kw: ["token", "secret", "claude", "credential"] },
          { label: "OpenAI API key", type: "text", key: "providers.openai.apiKey", kw: ["token", "secret", "gpt", "credential"] },
        ]},
        { title: "Model roles", plugin: true, fields: [
          { label: "Default model", type: "select", key: "roles.default", kw: ["llm", "claude", "sonnet"] },
          { label: "Thinking level", type: "select", key: "roles.thinking", kw: ["reasoning", "effort"] },
        ]},
      ]},
    ]},
    { id: "pi", label: "pi", pages: [
      { id: "pi-settings", label: "pi settings", icon: "tune", sections: [
        { title: "Terminal", fields: [
          { label: "Inline images", type: "toggle", key: "terminal.images", kw: ["picture", "screenshot"] },
          { label: "Retry on overload", type: "toggle", key: "retry.enabled", kw: ["429", "rate limit", "backoff"] },
        ]},
      ]},
    ]},
    { id: "dashboard", label: "Dashboard", pages: [
      { id: "general", label: "General", icon: "cog", sections: [
        { title: "Interface", fields: [
          { label: "Language", type: "select", key: "ui.language", kw: ["locale", "i18n", "translation"] },
          { folder: true, label: "Theme", type: "select", key: "ui.theme", kw: ["dark mode", "light mode", "colour", "palette"] },
        ]},
        { title: "Chat display", fields: [
          { label: "Token stats bar", type: "toggle", key: "display.tokenStats", kw: ["cost", "usage"] },
          { label: "Context usage bar", type: "toggle", key: "display.contextBar", kw: ["window", "tokens"] },
          { label: "Reasoning blocks", type: "toggle", key: "display.reasoning", kw: ["thinking", "chain of thought"] },
          { label: "Reasoning auto-collapse", type: "toggle", key: "display.reasoningCollapse", kw: ["thinking", "fold"] },
          { label: "Keep tool groups collapsed by default", type: "toggle", key: "display.toolGroupsCollapsed", kw: ["fold", "compact"] },
          { label: "Fluid chat motion", type: "toggle", key: "display.fluidMotion", kw: ["animation", "reduce motion"] },
        ]},
        { title: "Debug", fields: [
          { label: "Capture pi session output (debug)", type: "toggle", key: "debug.captureOutput", kw: ["log", "stdout"] },
        ]},
      ]},
      { id: "server", label: "Server", icon: "server", sections: [
        { title: "Ports", fields: [
          { label: "HTTP Port", type: "number", value: 8000, key: "port", kw: ["listen", "bind", "address"] },
          { label: "Pi Gateway Port", type: "number", value: 9999, key: "piPort", kw: ["bridge", "websocket", "listen"] },
        ]},
        { title: "Idle shutdown", fields: [
          { label: "Auto Shutdown", type: "toggle", key: "autoShutdown", kw: ["idle", "stop", "exit"] },
        ]},
        { title: "Gateway", fields: [
          { label: "Enable Gateway", type: "toggle", key: "tunnel.enabled", kw: ["tunnel", "zrok", "remote access", "public url"] },
          { label: "Enable Watchdog", type: "toggle", key: "tunnel.watchdog", kw: ["tunnel", "reconnect"] },
          { label: "Probe interval", type: "number", value: 30, key: "tunnel.probeIntervalSec", kw: ["tunnel", "health check"] },
        ]},
        { title: "Server memory (V8 heap)", fields: [
          { label: "Server heap ceiling", type: "number", value: 4096, key: "server.heapMb", kw: ["heap", "memory", "oom", "ram", "max-old-space-size"], changed: true },
        ]},
        { title: "Memory Limits", fields: [
          { label: "Max replay events", type: "number", value: 5000, key: "maxReplayEvents", kw: ["memory", "history", "buffer"] },
        ]},
      ]},
      { id: "sessions", label: "Sessions", icon: "grid", sections: [
        { title: "New session defaults", fields: [
          { folder: true, label: "Session Strategy", type: "select", key: "spawnStrategy", kw: ["tmux", "headless", "spawn"] },
          { folder: true, label: "ask_user prompt timeout", type: "number", value: 600, key: "askUser.timeoutSec", kw: ["question", "wait"] },
        ]},
        { title: "Lifecycle & recovery", fields: [
          { folder: true, label: "Archive after", type: "number", value: 7, key: "archive.afterDays", kw: ["cleanup", "hide", "old sessions"] },
        ]},
        { title: "Session memory (V8 heap)", fields: [
          { label: "Session heap ceiling", type: "number", value: 2048, key: "session.heapMb", kw: ["heap", "memory", "oom", "ram"] },
        ]},
        { title: "Session card defaults", fields: [
          { folder: true, label: "Context bar", type: "tri", key: "cardSections.contextBar", kw: ["card", "tokens", "usage"] },
          { folder: true, label: "OpenSpec lifecycle", type: "tri", key: "cardSections.openspec", kw: ["card", "proposal", "spec"] },
          { folder: true, label: "Process line", type: "tri", key: "cardSections.process", kw: ["card", "pid"] },
        ]},
        { title: "Worktrees", fields: [
          { folder: true, label: "Auto-init worktrees", type: "toggle", key: "worktree.autoInit", kw: ["git", "branch"] },
        ]},
      ]},
    ]},
    { id: "network", label: "Network", pages: [
      { id: "remote", label: "Remote Servers", icon: "web", sections: [
        { title: "Remote servers", fields: [
          { label: "Server list", type: "text", key: "remoteServers", kw: ["peer", "host", "connect"] },
        ]},
      ]},
      { id: "security", label: "Security", icon: "lock", sections: [
        { title: "Authentication", fields: [
          { label: "Bypass hosts", type: "text", key: "auth.bypassHosts", kw: ["allowlist", "trusted", "login", "password"] },
          { label: "Bypass URLs", type: "text", key: "auth.bypassUrls", kw: ["allowlist", "login"] },
          { label: "OAuth redirect base", type: "text", key: "auth.oauthRedirectBase", kw: ["callback", "sso", "login"] },
        ]},
        { title: "Trusted Networks", fields: [
          { label: "Listen interface", type: "select", key: "bindHost", kw: ["bind", "lan", "0.0.0.0", "address", "port"] },
        ]},
      ]},
    ]},
    { id: "services", label: "Services", pages: [
      { id: "services", label: "All services", icon: "cube", sections: [
        { title: "Background polling (OpenSpec)", fields: [
          { label: "Enable OpenSpec", type: "toggle", key: "openspec.enabled", kw: ["proposal", "spec"] },
          { label: "Poll interval", type: "number", value: 30, key: "openspec.pollIntervalSeconds", kw: ["slow tick", "cpu", "refresh"] },
        ]},
      ]},
    ]},
    { id: "add-ons", label: "Add-ons", pages: [
      { id: "plugins", label: "Plugins", icon: "puzzle", sections: [
        { title: "Context mode", plugin: true, fields: [
          { label: "Search window", type: "number", value: 60000, key: "search.windowMs", kw: ["throttle", "rate limit"] },
        ]},
      ]},
    ]},
    { id: "advanced", label: "Advanced", pages: [
      { id: "developer", label: "Developer", icon: "wrench", sections: [
        { title: "Developer", fields: [
          { label: "Dev Build on Reload", type: "toggle", key: "dev.buildOnReload", kw: ["vite", "rebuild"] },
          { label: "Show plugin internals", type: "toggle", key: "dev.pluginInternals", kw: ["debug"] },
          { label: "Debug events", type: "toggle", key: "dev.debugEvents", kw: ["log", "trace"] },
        ]},
      ]},
    ]},
  ];

  // Folder settings (/folder/:cwd/settings/:page). Items carry a scope badge.
  const CWD = "~/Project/pi-agent-dashboard";
  const item = (label, scope, kw = [], extra = {}) => ({ label, type: "item", scope, key: extra.key || label, kw, ...extra });
  const FOLDER_GROUPS = [
    { id: "folder", label: "Folder", pages: [
      { id: "instructions", label: "Instructions", icon: "file", sections: [
        { title: "Instruction files", fields: [
          { label: "AGENTS.md", type: "file", key: "./AGENTS.md", kw: ["rules", "system prompt", "guidelines"] },
          { label: "docs/AGENTS.md", type: "file", key: "./docs/AGENTS.md", kw: ["rules", "docs"] },
          { label: ".pi/APPEND_SYSTEM.md", type: "file", key: "./.pi/APPEND_SYSTEM.md", kw: ["system prompt"] },
        ]},
      ]},
      { id: "add-ons", label: "Add-ons", icon: "pkg", sections: [
        { title: "Added here", fields: [
          item("pi-dashboard-code-review-toolkit", "local", ["review", "coderabbit", "lint"]),
          item("openspec-workflow", "local", ["proposal", "spec"]),
        ]},
        { title: "Turned off here", fields: [
          item("pi-dashboard-nano-banana", "global", ["image", "gemini"], { off: true }),
        ]},
      ]},
      { id: "cards", label: "Session cards", icon: "cards", sections: [
        { title: "Card sections (this folder)", fields: [
          { label: "Context bar", type: "tri", key: "cards.contextBar", kw: ["card", "tokens", "usage"], over: "Hide" },
          { label: "OpenSpec lifecycle", type: "tri", key: "cards.openspec", kw: ["card", "proposal", "spec"] },
          { label: "Process line", type: "tri", key: "cards.process", kw: ["card", "pid"] },
          { label: "Tags", type: "tri", key: "cards.tags", kw: ["card", "label"] },
        ]},
      ]},
    ]},
    { id: "resources", label: "Resources", pages: [
      { id: "skills", label: "Skills", icon: "book", sections: [{ title: "Skills", fields: [
        item("review-code", "local", ["review", "critique"]),
        item("code-review", "global", ["review", "coderabbit"]),
        item("implement", "local", ["rebuild", "restart", "worktree"]),
        item("ship-change", "local", ["merge", "pr", "worktree"]),
      ]}]},
      { id: "agents", label: "Agents", icon: "robot", sections: [{ title: "Agents", fields: [
        item("Audit", "local", ["security", "review"]),
        item("DocScribe", "local", ["docs"]),
      ]}]},
      { id: "extensions", label: "Extensions", icon: "puzzle", sections: [{ title: "Extensions", fields: [
        item("pi-dashboard bridge", "global", ["websocket"]),
        item("context-mode", "global", ["search", "index"]),
      ]}]},
      { id: "prompts", label: "Prompts", icon: "text", sections: [{ title: "Prompts", fields: [
        item("/review", "local", ["review", "diff"]),
      ]}]},
      { id: "themes", label: "Themes", icon: "palette", sections: [{ title: "Themes", fields: [
        item("nord", "global", ["dark", "colour"]),
      ]}]},
    ]},
  ];

  // Flatten
  let n = 0;
  function flatten(groups, view) {
    const entries = [], pages = {};
    for (const g of groups) for (const p of g.pages) {
      pages[p.id] = { ...p, group: g };
      for (const s of p.sections) for (const f of s.fields) {
        f.id = "f" + (n++);
        entries.push({ ...f, page: p, group: g, section: s, view });
      }
    }
    return { entries, pages };
  }
  const G = flatten(GROUPS, "global"), F = flatten(FOLDER_GROUPS, "folder");
  const DATA = { global: { groups: GROUPS, ...G }, folder: { groups: FOLDER_GROUPS, ...F } };

  const $ = (id) => document.getElementById(id);
  const q = $("q"), results = $("results"), nav = $("nav"), page = $("page"), filters = $("filters"), count = $("count"), chip = $("chip-changed");
  const state = { view: "global", page: "server", lastPage: { global: "server", folder: "cards" }, fromFolder: false, query: "", changedOnly: false, active: 0, dirty: false, hits: [] };
  const D = () => DATA[state.view];

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function hl(text, terms) {
    let out = esc(text);
    for (const t of terms) {
      if (!t) continue;
      const re = new RegExp("(" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig");
      out = out.replace(re, "<mark>$1</mark>");
    }
    return out;
  }
  const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[k]}"/></svg>`;
  const isChanged = (e) => e.changed || (e.over && true) || (state.dirty && (e.page.id === "server" || e.page.id === "general") && /heap|Port|Language/.test(e.label));

  function search(query) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const hits = [];
    const pool = state.view === "folder" ? [...F.entries, ...G.entries.filter((e) => e.folder)] : G.entries;
    for (const e of pool) {
      if (state.changedOnly && !isChanged(e)) continue;
      let score = 0, why = null;
      const ok = terms.every((t) => {
        if (e.label.toLowerCase().includes(t)) { score += e.label.toLowerCase().startsWith(t) ? 30 : 20; return true; }
        if (e.section.title.toLowerCase().includes(t)) { score += 10; return true; }
        if (e.page.label.toLowerCase().includes(t)) { score += 8; return true; }
        if (e.key.toLowerCase().includes(t)) { score += 6; why = why || { kind: "key" }; return true; }
        const kw = e.kw.find((k) => k.includes(t));
        if (kw) { score += 4; why = why || { kind: "kw", word: kw }; return true; }
        return false;
      });
      if (ok) hits.push({ e, score, why, terms });
    }
    hits.sort((a, b) => (a.e.view !== b.e.view ? (a.e.view === state.view ? -1 : 1) : b.score - a.score));
    return hits;
  }

  function renderNav() {
    nav.innerHTML = D().groups.map((g) => `
      <div class="group-label">${esc(g.label)}</div>
      ${g.pages.map((p) => `
        <button class="rail-item" data-page="${p.id}" ${p.id === state.page ? 'aria-current="page"' : ""}>
          ${svg(p.icon)}${esc(p.label)}${g.id === "resources" && state.view === "folder" ? `<span class="rail-count">${p.sections[0].fields.length}</span>` : ""}
          ${state.dirty && (p.id === "server" || p.id === "general") ? '<span class="dot" title="Unsaved changes on this page"></span>' : ""}
        </button>`).join("")}`).join("");
  }

  function renderResults() {
    const query = state.query.trim();
    const searching = query !== "";
    results.hidden = !searching; nav.hidden = searching; filters.hidden = !searching;
    q.setAttribute("aria-expanded", String(searching));
    if (!searching) { q.removeAttribute("aria-activedescendant"); return; }
    const hits = (state.hits = search(query));
    const pagesHit = new Set(hits.map((h) => h.e.page.id)).size;
    count.textContent = hits.length ? `${hits.length} setting${hits.length > 1 ? "s" : ""} · ${pagesHit} page${pagesHit > 1 ? "s" : ""}` : "No matches";
    if (!hits.length) {
      results.innerHTML = `<div class="empty">
        <p>No settings match <b>“${esc(query)}”</b>${state.changedOnly ? " among changed settings" : ""}.</p>
        <p class="hint">Try a broader word or a config key such as <code>port</code> or <code>auth.</code></p>
        <div class="sugg">${["memory", "tunnel", "theme", "timeout"].map((s) => `<button class="chip" data-sugg="${s}">${s}</button>`).join("")}</div>
        ${state.changedOnly ? '<p class="hint" style="margin-top:10px">Or turn off <b>Changed only</b>.</p>' : ""}
      </div>`;
      return;
    }
    state.active = Math.min(state.active, hits.length - 1);
    // group by view+page, preserving best-first order; foreign-view (global) groups trail
    const order = []; const byPage = new Map();
    for (const h of hits) {
      const k = h.e.view + ":" + h.e.page.id;
      if (!byPage.has(k)) { byPage.set(k, []); order.push({ k, p: h.e.page, view: h.e.view }); }
      byPage.get(k).push(h);
    }
    let i = 0, sepDone = false;
    results.innerHTML = order.map(({ k, p, view }) => {
      const foreign = view !== state.view;
      const sep = foreign && !sepDone ? (sepDone = true, `<div class="res-group res-sep" role="presentation"><span class="page-name">Global settings</span><span class="scope scope-global">global</span></div>
        <div class="res-sep-note">Apply to every folder. Opens Settings.</div>`) : "";
      const grp = DATA[view].pages[p.id].group.label;
      return `${sep}
      <div class="res-group" role="presentation">${esc(grp)} › <span class="page-name">${hl(p.label, hits[0].terms)}</span>
        ${p.sections.some((s) => s.plugin) ? '<span class="plugin-tag">plugin</span>' : ""}</div>
      ${byPage.get(k).map((h) => {
        const idx = i++;
        const why = h.why && h.why.kind === "kw" ? `<div class="res-why">matches “${esc(h.why.word)}”</div>`
                  : h.why && h.why.kind === "key" ? `<div class="res-why"><code>${hl(h.e.key, h.terms)}</code></div>` : "";
        const scope = h.e.scope ? `<span class="scope${h.e.scope === "global" ? " scope-global" : ""}">${h.e.scope}</span>` : "";
        return `<div class="res" role="option" id="opt-${idx}" data-idx="${idx}" aria-selected="${idx === state.active}">
          <div class="res-label"><span>${hl(h.e.label, h.terms)}</span>${scope}${isChanged(h.e) ? '<span class="dot" title="Changed"></span>' : ""}</div>
          <div class="res-crumb">${hl(h.e.section.title, h.terms)}</div>${why}
        </div>`;
      }).join("")}`;
    }).join("");
    // keep flat order identical to visual order
    state.hits = order.flatMap(({ k }) => byPage.get(k));
    q.setAttribute("aria-activedescendant", "opt-" + state.active);
    const o = $("opt-" + state.active); if (o) { const t = o.offsetTop; if (t < results.scrollTop) results.scrollTop = t; else if (t + o.offsetHeight > results.scrollTop + results.clientHeight) results.scrollTop = t + o.offsetHeight - results.clientHeight; }
  }

  function control(f) {
    const l = esc(f.label);
    switch (f.type) {
      case "toggle": return `<button class="toggle" role="switch" aria-checked="false" aria-label="${l}"></button>`;
      case "number": return `<input type="number" value="${f.value ?? 0}" aria-label="${l}">`;
      case "select": return `<select aria-label="${l}"><option>Default</option></select>`;
      case "tri": return `<div class="seg" role="group" aria-label="${l}">${["Default", "Show", "Hide"].map((o) => `<button aria-pressed="${(f.over || "Default") === o}">${o}</button>`).join("")}</div>`;
      case "file": return `<button class="btn link-btn">Open</button>`;
      case "item": return `<span class="scope${f.scope === "global" ? " scope-global" : ""}">${f.scope}</span><button class="toggle" role="switch" aria-checked="${!f.off}" aria-label="${l} enabled here"></button>`;
      default: return `<input type="text" aria-label="${l}" placeholder="…">`;
    }
  }

  function renderPage() {
    const p = D().pages[state.page];
    page.innerHTML = `<h2 class="page-title">${esc(p.label)}</h2>
      <div class="page-crumb">${esc(p.group.label)}${state.view === "folder" ? " · " + CWD : ""}</div>
      ${p.sections.map((s) => `<div class="section"><h3>${esc(s.title)}${s.plugin ? ' <span class="plugin-tag" style="font-weight:400;font-size:11px">plugin</span>' : ""}</h3>
        ${s.fields.map((f) => `<div class="field" id="${f.id}">
          <div class="field-text"><div class="field-label">${esc(f.label)}${isChanged({ ...f, page: p }) ? '<span class="dot" title="Changed"></span>' : ""}</div>
          <div class="field-desc"><code>${esc(f.key)}</code></div></div>
          ${control(f)}
        </div>`).join("")}</div>`).join("")}`;
  }

  function setView(view, fromFolder) {
    if (state.view === view) return;
    state.lastPage[state.view] = state.page;
    state.view = view; state.page = state.lastPage[view]; state.fromFolder = !!fromFolder;
    $("mock-view").value = view;
    $("title").textContent = view === "folder" ? "Folder settings" : "Settings";
    const st = $("subtitle"); st.hidden = view !== "folder"; st.textContent = CWD;
    $("back-folder").hidden = !(view === "global" && state.fromFolder);
    q.placeholder = view === "folder" ? "Search this folder + global" : "Search settings";
  }

  function go(pageId, fieldId, view) {
    if (view) setView(view, view === "global" && state.view === "folder");
    state.page = pageId; renderNav(); renderPage(); renderResults();
    if (fieldId) {
      const el = $(fieldId);
      if (el) {
        page.scrollTo({ top: el.offsetTop - page.clientHeight / 3, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
        el.querySelector("input,select,button")?.focus({ preventScroll: true });
      }
    } else page.scrollTop = 0;
  }
  function pick(idx) {
    const h = state.hits[idx]; if (!h) return;
    if (h.e.view !== state.view) setQuery("");  // leaving the folder: the global rail starts clean
    go(h.e.page.id, h.e.id, h.e.view);
  }
  function setQuery(v) { q.value = v; state.query = v; state.active = 0; renderResults(); }

  q.addEventListener("input", () => { state.query = q.value; state.active = 0; renderResults(); });
  q.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown") { ev.preventDefault(); state.active = Math.min(state.active + 1, state.hits.length - 1); renderResults(); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); state.active = Math.max(state.active - 1, 0); renderResults(); }
    else if (ev.key === "Enter") { ev.preventDefault(); pick(state.active); }
    else if (ev.key === "Escape") { ev.preventDefault(); setQuery(""); }
  });
  results.addEventListener("click", (ev) => {
    const r = ev.target.closest(".res"); if (r) { state.active = +r.dataset.idx; renderResults(); pick(state.active); return; }
    const s = ev.target.closest("[data-sugg]"); if (s) { setQuery(s.dataset.sugg); q.focus(); }
  });
  nav.addEventListener("click", (ev) => { const b = ev.target.closest("[data-page]"); if (b) go(b.dataset.page); });
  page.addEventListener("click", (ev) => {
    const sb = ev.target.closest(".seg button"); if (sb) { sb.parentElement.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === sb))); return; }
    const t = ev.target.closest(".toggle"); if (t) t.setAttribute("aria-checked", t.getAttribute("aria-checked") === "true" ? "false" : "true"); });
  chip.addEventListener("click", () => { state.changedOnly = !state.changedOnly; chip.setAttribute("aria-pressed", String(state.changedOnly)); state.active = 0; renderResults(); });
  document.addEventListener("keydown", (ev) => {
    const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || "");
    if ((ev.key === "/" && !typing) || (ev.key.toLowerCase() === "k" && (ev.metaKey || ev.ctrlKey))) { ev.preventDefault(); q.focus(); q.select(); }
  });

  // mockup controls
  $("mock-theme").addEventListener("change", (ev) => {
    const v = ev.target.value, root = document.documentElement;
    root.dataset.theme = v === "light" ? "light" : "dark";
    if (v === "nord") root.dataset.palette = "nord"; else delete root.dataset.palette;
  });
  $("mock-view").addEventListener("change", (ev) => { setView(ev.target.value, false); setQuery(""); go(state.page); });
  $("back-folder").addEventListener("click", () => { setView("folder", false); go(state.page); });
  $("mock-try").addEventListener("change", (ev) => { setQuery(ev.target.value); q.focus(); });
  $("mock-dirty").addEventListener("change", (ev) => {
    state.dirty = ev.target.checked;
    $("savebar").hidden = !state.dirty;
    const dc = $("dirty-count"); dc.hidden = !state.dirty; dc.textContent = "2";
    renderNav(); renderPage(); renderResults();
  });
  document.querySelector(".savebar").addEventListener("click", (ev) => { const a = ev.target.closest("[data-goto]"); if (a) { ev.preventDefault(); go(a.dataset.goto); } });

  renderNav(); renderPage(); renderResults();
})();
