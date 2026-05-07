# Responsive Testing

Test layouts across device sizes using `agent-browser set viewport` — no browser restart needed.

## Viewport Presets

| Name    | Width | Height | Use case              |
|---------|-------|--------|-----------------------|
| mobile  | 375   | 667    | iPhone SE / small phone |
| tablet  | 768   | 1024   | iPad / tablet portrait |
| desktop | 1280  | 720    | Standard laptop        |
| wide    | 1920  | 1080   | Full HD monitor        |

## One-Shot Capture (Design Flow)

Quick capture of both viewports for design mockups:

```bash
browser open http://localhost:8000 && browser wait 2000
browser set viewport 1280 3000 && browser screenshot
cp ~/.agent-browser/tmp/screenshots/screenshot-*.png screenshots/desktop.png
browser close

browser open http://localhost:8000 && browser wait 2000
browser set viewport 375 3000 && browser screenshot
cp ~/.agent-browser/tmp/screenshots/screenshot-*.png screenshots/mobile.png
```

## Multi-Viewport Workflow

Test the same page across all viewports in one browser session:

```
browser open http://localhost:8000
browser wait --load networkidle

browser set viewport 1280 720
browser screenshot

browser set viewport 375 667
browser screenshot

browser set viewport 768 1024
browser screenshot

browser set viewport 1920 1080
browser screenshot

browser close
```

The LLM receives all four screenshots and can compare layouts.

## Dark / Light Mode Testing

Switch color scheme at runtime:

```
browser set media dark
browser screenshot

browser set media light
browser screenshot
```

Combine with viewport changes for a full matrix:

```
browser set viewport 375 667
browser set media dark
browser screenshot

browser set media light
browser screenshot

browser set viewport 1280 720
browser set media dark
browser screenshot

browser set media light
browser screenshot
```

## Tips

- **Start with desktop** (default 1280×720) to verify baseline, then check mobile.
- **The dashboard has a mobile shell** (`MobileShell.tsx`) that activates below ~768px. Test at 375×667 to verify it.
- **Check sidebar collapse** — the sidebar may hide or overlay on narrow viewports.
- **Annotated screenshots** (`browser screenshot --annotate`) are especially helpful at mobile sizes where elements are tightly packed.
