---
name: ios-visual-review
description: >
  Take a screenshot of the pi-dashboard in the iOS Simulator and send it
  to the visual-qa subagent for review. Uses Appium + XCUITest (same
  infrastructure as qa/ios-visual tests). Boots simulator, opens dashboard
  URL in Safari via WDIO, performs a described action (focus input, idle,
  navigate), captures a native screenshot (keyboard, status bar, home
  indicator visible).
  Use when: visual QA of dashboard changes on iOS, verifying layout fixes
  on iPhone viewport, reviewing mobile UI after CSS changes.
license: MIT
metadata:
  author: pi-dashboard
  version: "2.0"
---

# iOS Visual Review

Take a screenshot of the pi-dashboard in the **iOS Simulator** (real Safari, real UIKit keyboard) using the project's Appium + XCUITest stack — the same stack powering `qa/ios-visual` regression tests. Then send the screenshot to the `visual-qa` subagent for analysis.

## Quick Start

```bash
# 1. Take a screenshot with a described action
node .pi/skills/ios-visual-review/scripts/screenshot.mjs --action focus-input --session <session-id>

# 2. Capture the path printed to stdout
# 3. Send to visual-qa subagent for review
```

## Workflow

1. **Ensure dashboard is running** — script health-checks `$PI_DASHBOARD_URL/api/health`
2. **Run `screenshot.mjs` with the desired `--action`** — the script:
   - Finds or boots the iOS simulator (`PWA-Test`, iOS 26.4)
   - Starts Appium (or reuses running instance)
   - Creates a WDIO session against Safari on the simulator
   - Navigates to `$PI_DASHBOARD_URL`, waits for SPA root
   - Dismisses native Safari popups (coachmark)
   - Performs the requested action
   - **Draws app boundary**: red dashed outline around `#root` + dims browser chrome outside — so QA can clearly distinguish app UI from Safari/system chrome
   - Saves a native-context screenshot (keyboard, status bar, home indicator)
   - Prints the screenshot path to stdout
3. **Capture the path** from stdout
4. **Send to `visual-qa` subagent** — pass the screenshot path and ask: "Review this screenshot for visual bugs. Focus on [specific area]."

## Actions

| `--action` | Description |
|------------|-------------|
| `idle` | Land on dashboard root, wait, screenshot — no interaction |
| `focus-input` | Native-tap the chat textarea, wait for iOS software keyboard, screenshot |

Default: `idle`.

## Options

| Flag | Description |
|------|-------------|
| `--action <name>` | Action to perform (default: `idle`) |
| `--session <id>` | Session ID to navigate to before action (for `focus-input`) |
| `--url <url>` | Override dashboard URL (env: `PI_DASHBOARD_URL`) |

## Env Vars

| Var | Default | Description |
|-----|---------|-------------|
| `PI_DASHBOARD_URL` | `http://127.0.0.1:8000` | Dashboard base URL |
| `SIM_UDID` | auto-detect | Simulator UDID (skip auto-detection) |
| `SIM_NAME` | `PWA-Test` | Simulator name |
| `IOS_PLATFORM_VERSION` | `26.4` | iOS runtime version |
| `APPIUM_HOME` | `qa/ios-visual/.tmp/appium-home` | Appium home dir |

## Prerequisites

- **macOS** with Xcode 16+ + Command Line Tools
- **iOS Simulator** created: `cd qa/ios-visual && npm run sim:create`
- **Appium driver** installed: `cd qa/ios-visual && npm install && npm run driver:install`
- **Dashboard running** at `$PI_DASHBOARD_URL`

## Script Location

```
.pi/skills/ios-visual-review/scripts/screenshot.mjs   ← Appium + WDIO (actions)
```

Always resolve relative to project root.

## Subagent

Use `visual-qa` (user-level, model: `openai-codex/gpt-5.5`). It provides a **general visual quality assessment**:
- **Bugs**: layout breakage, typography, colors, responsiveness, artifacts, safe-area issues
- **Improvements**: visual hierarchy, density, alignment, contrast, interactivity, overall polish
- **What's good**: highlights successful visual decisions

Pass the screenshot path and ask for a broad review:

> "Review this iOS screenshot. Give me a visual quality assessment — any layout or styling issues? What looks good? What could be improved?"

For focused checks, narrow the scope:

> "Focus on the chat input area — is send button visible, is there any clipping?"

## Example Session

```
User: "проверь поле ввода когда в нем курсор"

Agent:
  1. node .pi/skills/ios-visual-review/scripts/screenshot.mjs --action focus-input --session <id>
     → /tmp/pi-screenshots/ios-focus-input-2026-05-05T12-00-00.png
  2. subagent visual-qa: "Review this iOS screenshot. Give me a visual quality
     assessment — any issues? What looks good? What could be improved?"
```
