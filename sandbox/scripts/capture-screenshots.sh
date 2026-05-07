#!/bin/bash
# Capture desktop + mobile screenshots for design flow
# Usage: ./sandbox/scripts/capture-screenshots.sh [url] [output-dir]
# Default: http://localhost:8000 → screenshots/

URL="${1:-http://localhost:8000}"
OUT="${2:-screenshots}"

mkdir -p "$OUT"

echo "[capture] Desktop (1280x3000)..."
browser open "$URL" && browser wait 2000
browser set viewport 1280 3000 && browser screenshot
TMP=$(ls -t ~/.agent-browser/tmp/screenshots/*.png | head -1)
cp "$TMP" "$OUT/desktop.png"
echo "[capture] → $OUT/desktop.png"

browser close

echo "[capture] Mobile (375x3000)..."
browser open "$URL" && browser wait 2000
browser set viewport 375 3000 && browser screenshot
TMP=$(ls -t ~/.agent-browser/tmp/screenshots/*.png | head -1)
cp "$TMP" "$OUT/mobile.png"
echo "[capture] → $OUT/mobile.png"

browser close
echo "[capture] Done"
