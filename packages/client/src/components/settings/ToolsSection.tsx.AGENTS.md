# ToolsSection.tsx — index

Settings → General → **Tools** section. One row per registered tool: status badge, source, truncated path, expand-to-trail, override input, per-row rescan. Top-level: Rescan all / Reset overrides / Export diagnostics. `[Install ▾]` dropdown on missing rows when `installHints[hostOs]` exists; per-OS filter via `useHostPlatform`; `copyText` per command; row id `tool-row-<name>`; consumes deep-link target on mount. See change: register-bash-and-tool-install-help.
