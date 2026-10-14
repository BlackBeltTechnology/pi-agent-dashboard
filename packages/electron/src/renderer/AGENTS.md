# DOX — packages/electron/src/renderer

Files in this directory. One row per bundled renderer page (loaded `file://` by trusted app windows only).

| File | Purpose |
|------|---------|
| `connecting.html` | "Connecting to ‹name›" pairing window. Phases proving/confirm/waiting/terminal. TOFU shows full fp + compare prompt; editable device name; code `NNNN NNNN` + countdown; unencrypted notice for http; Stop waiting. All dynamic text via `textContent`. CSP `default-src 'none'`. Bridge `window.connecting`. See change: add-electron-server-windows. |
| `doctor.html` | Doctor window page (`window.electron.doctor`). Copy-as-Markdown name and message cells use inline `cell` (backslash, pipe, line endings; mirrors `shared/src/md-table-cell.ts`). See change: fix-codeql-small-findings. |
| `remote-connect.html` | Connect window: Paired / Discovered / Enter a URL (Open in window, Use as remote dashboard) / Recent remote dashboards. Live updates via `servers:changed`. Bridge `window.remoteConnect`. See change: add-electron-server-windows. |
