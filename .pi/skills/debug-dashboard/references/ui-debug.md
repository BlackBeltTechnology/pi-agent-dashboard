# UI Debug — Pointer

This file exists to redirect. UI/visual debugging belongs to the **`browser`** skill, shipped by the dashboard bridge extension to every pi session that loads `@blackbelt-technology/pi-dashboard-extension`. No repo-local install is needed.

## When to switch to the `browser` skill

| Symptom | Use the `browser` skill |
|---------|--------------------------|
| Layout looks wrong | ✓ Screenshot + visual inspection |
| Dark/light mode rendering off | ✓ Toggle + screenshot both |
| Responsive breakpoint broken | ✓ Test at multiple widths |
| Console error in the browser | ✓ Open devtools, capture errors |
| Blank page (after server is confirmed healthy) | ✓ Open + screenshot, check console |
| Click handler not firing | ✓ Inspect element, check React tree |
| Modal won't close | ✓ Visual confirmation |
| Pi Dashboard Electron shell (tray, wizard, doctor window) | ✓ Launch with `--debug-cdp`, attach via `agent-browser connect 9222` |

## When to stay in debug-dashboard

| Symptom | Stay here |
|---------|-----------|
| Server-side error (500, 502) | Check `server.log` |
| Bridge not connecting | Check WebSocket logs |
| API returns wrong data | Probe `/api/*` with `curl` |
| Auth blocks request | Check `auth` settings in config |
| Restart loop | Check `lsof`, PID file, server.log |

## Quick handoff

If you've ruled out the server and the issue is UI-only:

```bash
# Confirm server is healthy first
npx tsx ./scripts/health-probe.ts        # this skill

# Then switch
/skill:browser
```

The `browser` skill ships (via the bridge extension package):
- `scripts/detect-dashboard.sh` — auto-detect dashboard URL, mode, Vite status
- `references/web.md` — vendored `agent-browser` core + Pi Dashboard addenda (recipes, responsive testing)
- `references/electron.md` — vendored `agent-browser` electron + worked example for attaching to the Pi Dashboard Electron shell via `--debug-cdp`
