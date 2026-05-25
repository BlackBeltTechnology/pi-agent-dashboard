# UI Debug — Pointer

This file exists to redirect. UI/visual debugging belongs to the **`browser-visual-debug`** skill, which is already in `.pi/skills/browser-visual-debug/`.

## When to switch to browser-visual-debug

| Symptom | Use browser-visual-debug |
|---------|--------------------------|
| Layout looks wrong | ✓ Screenshot + visual inspection |
| Dark/light mode rendering off | ✓ Toggle + screenshot both |
| Responsive breakpoint broken | ✓ Test at multiple widths |
| Console error in the browser | ✓ Open devtools, capture errors |
| Blank page (after server is confirmed healthy) | ✓ Open + screenshot, check console |
| Click handler not firing | ✓ Inspect element, check React tree |
| Modal won't close | ✓ Visual confirmation |

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
# Read .pi/skills/browser-visual-debug/SKILL.md
```

The browser-visual-debug skill ships:
- `scripts/detect-dashboard.sh` — auto-detect dashboard URL, mode, Vite status
- Recipes for dashboard screenshots, responsive testing, console error capture
- agent-browser cheatsheet
