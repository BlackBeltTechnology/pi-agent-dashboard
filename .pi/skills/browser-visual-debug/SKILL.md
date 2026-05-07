---
name: browser-visual-debug
description: >
  Visual debugging with a real browser. Open pages, take screenshots, inspect
  elements, test responsive layouts, and hunt console errors — all from pi.
  Use when: verifying UI changes visually, debugging layout issues, checking
  responsive behavior, investigating blank pages or JS errors, testing dark/light
  mode rendering.
license: MIT
metadata:
  author: pi-dashboard
  version: "1.0"
---

# Browser Visual Debug

Give the agent eyes. Use the `browser` tool to open pages, interact with elements, take screenshots, and reason about the rendered UI via vision.

## Prerequisites

- **`pi-agent-browser` package** must be installed. It registers the `browser` tool.
  If not available, run: `pi install npm:pi-agent-browser`
- **Vision-capable model** required for screenshot analysis (Claude Sonnet/Opus, GPT-4o, Gemini Pro).
  Without vision, use `browser snapshot -i` for text-based element inspection and `browser get text` for content checks.

## Quick Reference

### 1. Detect the dashboard URL

```bash
bash "$SKILL_DIR/scripts/detect-dashboard.sh"
```

This outputs `DASHBOARD_URL`, `MODE`, and optionally `VITE_URL`.

### 2. Open, wait, screenshot

```
browser open http://localhost:8000
browser wait --load networkidle
browser screenshot
```

The screenshot is returned inline as an image — the LLM sees it directly.

### 3. Inspect interactive elements

```
browser snapshot -i
```

Returns `@ref` handles (e.g., `@e1`, `@e3`) for clickable/fillable elements.

### 4. Interact and verify

```
browser click @e3
browser screenshot
```

Always screenshot after mutations to see the result.

### 5. Clean up

```
browser close
```

## Core Workflows

### Visual Verification

_"I just changed a component — does it look right?"_

1. Open the dashboard and wait for it to load:
   ```
   browser open http://localhost:8000
   browser wait --load networkidle
   ```
2. Take a screenshot:
   ```
   browser screenshot
   ```
3. Reason about what you see vs what's expected.
4. If checking a specific area, use an annotated screenshot:
   ```
   browser screenshot --annotate
   ```
5. Close when done:
   ```
   browser close
   ```

### Interactive Debugging

_"Something breaks when I click X"_

1. Open and get element refs:
   ```
   browser open http://localhost:8000
   browser wait --load networkidle
   browser snapshot -i
   ```
2. Interact with the element:
   ```
   browser click @e5
   ```
3. Screenshot to see what happened:
   ```
   browser screenshot
   ```
4. Re-snapshot if the page changed:
   ```
   browser snapshot -i
   ```
5. Repeat interact → screenshot → snapshot cycle as needed.

### Responsive Checks

_"Does this work on mobile?"_

See [references/responsive-testing.md](references/responsive-testing.md) for viewport presets and workflow.

Quick version:
```
browser open http://localhost:8000
browser wait --load networkidle
browser screenshot
browser set viewport 375 667
browser screenshot
browser set viewport 768 1024
browser screenshot
```

Compare the three screenshots for layout issues.

### Console Error Hunting

_"The page is blank / something isn't rendering"_

1. Open the page:
   ```
   browser open http://localhost:8000
   browser wait --load networkidle
   ```
2. Check for JavaScript errors:
   ```
   browser console
   ```
3. Check for failed network requests:
   ```
   browser network
   ```
4. Take a screenshot to correlate visible state with errors:
   ```
   browser screenshot
   ```
5. If errors reference specific files, fix them and reload:
   ```
   browser reload
   browser wait --load networkidle
   browser screenshot
   ```

## Dashboard-Specific Recipes

Read [references/dashboard-recipes.md](references/dashboard-recipes.md) for detailed recipes tied to dashboard component files.

## Best Practices

1. **Always wait for `networkidle`** after `open` or `reload` — the dashboard is a React SPA that needs time to hydrate.
2. **Screenshot after every mutation** — `click`, `fill`, `type`, `press` may change the page. Always screenshot to see the result.
3. **Use `--annotate`** for element identification — overlays numbered labels on the screenshot so you can correlate visual elements with `@ref` handles.
4. **Use `snapshot -i` before interacting** — get the `@ref` handles first, then click/fill.
5. **Close the browser when done** — `browser close` prevents orphaned Chromium processes.
6. **Prefer element screenshots for large pages** — reduces token cost vs full-page captures.
7. **Chain commands for SPA navigation** — after clicking a link that triggers a route change, `wait --load networkidle` before screenshotting.

## Sandbox Mode

Use `--sandbox` to operate against the design sandbox (Docker-based pi-dashboard with seed data) instead of a live dashboard instance.

### Detection

```bash
bash "$SKILL_DIR/scripts/detect-dashboard.sh" --sandbox
```

Outputs `DASHBOARD_URL=http://localhost:8000 MODE=sandbox` — no port probing, no Vite detection. The sandbox's dashboard always runs on port 8000.

### Scenario-Driven Automation

Use `--scenario <path>` to execute a JSON step file:

```bash
browser-visual-debug --sandbox --scenario screenshots/scenario.json
```

The scenario file is a JSON array of step objects. Steps execute sequentially and halt on first error.

#### Step Vocabulary

| Action | Required params | Optional params | Description |
|--------|----------------|-----------------|-------------|
| `open` | `url` (string) | — | Navigate to URL |
| `click` | `selector` (string) | — | Click element matching selector |
| `fill` | `selector` (string), `value` (string) | — | Clear and type into input |
| `type` | `selector` (string), `value` (string) | — | Type without clearing |
| `select` | `selector` (string), `value` (string) | — | Select dropdown option |
| `press` | `key` (string) | — | Press keyboard key (e.g., `Enter`, `Tab`, `Escape`) |
| `wait` | — | `condition` (`"networkidle"` \| `"load"`), `ms` (number) | Wait for condition or duration. `networkidle` waits until no requests in flight for ≥500ms, 30s timeout |
| `screenshot` | `name` (string) | `fullPage` (boolean, default false) | Capture screenshot to `screenshots/<name>.png`. Creates `screenshots/` directory if missing |
| `scroll` | `direction` (`"up"` \| `"down"` \| `"left"` \| `"right"`) | `px` (number) | Scroll viewport |
| `snapshot` | — | `interactive` (boolean, default false) | Capture DOM snapshot; `interactive: true` returns `@ref` handles |

#### Execution Contract

- Steps execute **sequentially** in array order.
- Any non-screenshot step that fails (element not found, navigation timeout, invalid selector) **halts execution immediately** with an error message referencing the step index, action, and failure reason.
- `screenshot` steps write PNG files to `screenshots/<name>.png` relative to the change directory.
- An invalid scenario JSON file (parse failure) produces an error referencing the file path.
- A step with an unknown `action` or missing required parameter produces an error referencing the step index.

#### Example Scenario

```json
[
  { "action": "open",   "url": "http://localhost:8000" },
  { "action": "wait",   "condition": "networkidle" },
  { "action": "screenshot", "name": "01-sidebar-initial" },
  { "action": "click",  "selector": "text=Settings" },
  { "action": "wait",   "ms": 500 },
  { "action": "screenshot", "name": "02-settings-panel" },
  { "action": "click",  "selector": "text=General" },
  { "action": "wait",   "ms": 300 },
  { "action": "screenshot", "name": "03-general-settings" }
]
```

### End-to-End Recipe

See [references/sandbox-recipes.md](references/sandbox-recipes.md) for the full sandbox lifecycle recipe (docker-compose up → scenario execution → screenshot capture → docker-compose down).

## Command Reference

See [references/commands-cheatsheet.md](references/commands-cheatsheet.md) for the full quick-reference table.
