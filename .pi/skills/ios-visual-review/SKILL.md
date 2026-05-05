---
name: ios-visual-review
description: >
  Take a screenshot of the pi-dashboard in the iOS Simulator and send it
  to the visual-qa subagent for review. Uses Appium + XCUITest (same
  infrastructure as qa/ios-visual tests). Boots simulator, opens dashboard
  URL in Safari via WDIO, performs a described action (focus input, idle,
  navigate), captures web + native screenshots.
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
   - Saves web-context + native-context screenshots
   - Prints the web screenshot path to stdout
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

Use `visual-qa` (user-level, model: `openai-codex/gpt-5.5`). It analyzes screenshots for:
- **Layout**: overlaps, overflow, misalignment, broken grid/flex
- **Typography**: wrong fonts/sizes/colors, clipped text
- **Colors & styles**: inconsistency, missing shadows/borders/rounding
- **Responsiveness**: elements missing/visible when they shouldn't be
- **Visual artifacts**: blur, pixelation, glitches
- **Element states**: hover/active/disabled appearance
- **Dark/light theme**: inconsistency between themes

Pass the screenshot path and ask for review. The subagent returns findings with severity tags (🔴 Critical / 🟠 High / 🟡 Medium / ⚪ Low).

## Example Session

```
User: "проверь поле ввода когда в нем курсор"

Agent:
  1. node .pi/skills/ios-visual-review/scripts/screenshot.mjs --action focus-input
     → /tmp/pi-screenshots/ios-web-focus-input-2026-05-05T12-00-00.png
  2. subagent visual-qa: "Review this screenshot. Focus on the chat input field
     and the send button — both should be visible and not clipped by the keyboard
     or safe area."
```
