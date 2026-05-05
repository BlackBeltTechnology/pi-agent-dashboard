# iOS Visual Review

Take a screenshot of the pi-dashboard running in the iOS Simulator and send it to the `visual-qa` subagent for review.

## Quick Start

```bash
# 1. Take screenshot (ensure dashboard is running at localhost:8000)
chmod +x .pi/skills/ios-visual-review/scripts/screenshot.sh
SCREENSHOT=$(bash .pi/skills/ios-visual-review/scripts/screenshot.sh)

# 2. Send to visual-qa subagent for review
```

## Workflow

1. **Ensure dashboard is running** — the script health-checks `$PI_DASHBOARD_URL/api/health`
2. **Run `scripts/screenshot.sh`** — boots the simulator if needed, opens the dashboard URL in Safari, waits for load, takes a screenshot via `xcrun simctl io screenshot`
3. **The script prints the screenshot path** to stdout — capture it
4. **Send to `visual-qa` subagent** — pass the screenshot path and ask for review

## Env Vars

| Var | Default | Description |
|-----|---------|-------------|
| `PI_DASHBOARD_URL` | `http://127.0.0.1:8000` | Dashboard URL to screenshot |
| `SIM_UDID` | auto-detect | Simulator UDID (skip auto-detection) |
| `SIM_NAME` | `PWA-Test` | Simulator name to find |
| `IOS_PLATFORM_VERSION` | `26.4` | iOS runtime version |

## Prerequisites

- **macOS** with Xcode + Command Line Tools
- **iOS Simulator** created (`npm run ios-visual:sim:create` from `qa/ios-visual/`)
- **Dashboard running** at `PI_DASHBOARD_URL`

## Script Location

`.pi/skills/ios-visual-review/scripts/screenshot.sh`

Relative to project root. Always resolve with `$PWD` or project root.

## Subagent

Use `visual-qa` (user-level agent, model: `openai-codex/gpt-5.5`). It analyzes screenshots for:
- Layout breakage (overlaps, overflow, misalignment)
- Typography issues (wrong fonts, sizes, colors, clipped text)
- Color/style inconsistency
- Responsiveness bugs
- Visual artifacts (blur, glitches)
- Element state issues (hover/active/disabled)
- Dark/light theme mismatches

Pass the screenshot path and ask: "Review this screenshot for visual bugs. Focus on [specific area if any]."

## Notes

- The script boots the simulator, navigates to the dashboard, waits 4s for load, and takes a screenshot
- Simulator is shut down after screenshot (trap EXIT)
- Screenshots saved to `$TMPDIR/pi-screenshots/`
- Returns exit code 1 if dashboard is not running or simulator not found
