#!/usr/bin/env bash
# Full render of a rebuild package with every gate: render.sh <packageDir> [appDir]
#   check-use-cases -> [architecture.json] check-architecture (+ --app) + arch
#   -> [ui/screens] ifml + check-ifml + round-trip ifml-diff (must be "no differences")
#   -> build-site with every viewer found -> <packageDir>/diagrams/catalog.html
# Stops at the first failing step. Viewer overrides (optional):
#   BPMN_JS_DIR  dir with bpmn-navigated-viewer.production.min.js, diagram-js.css, bpmn.css, bpmn-font/css/bpmn-embedded.css
#   MERMAID_JS   mermaid.min.js (default: found next to `mmdc` when installed)
#   IFML_JS_DIR  dir with ifml-navigated-viewer.production.min.js, diagram-js.css, ifml-font-embedded.css (default: vendored assets/ifml-js)
set -euo pipefail
if [ $# -lt 1 ]; then
  echo "usage: render.sh <packageDir> [appDir]" >&2
  exit 2
fi
PKG=$1
APP=${2:-}
SKILL=$(cd "$(dirname "$0")/.." && pwd)
DG=(node "$SKILL/scripts/diagrams.mjs")

echo "1 use cases"
"${DG[@]}" check-use-cases "$PKG"

if [ -f "$PKG/diagrams/architecture.json" ]; then
  echo "2 architecture (C4/C5)"
  "${DG[@]}" check-architecture "$PKG" ${APP:+--app "$APP"}
  "${DG[@]}" arch "$PKG" "$PKG/diagrams/architecture"
else
  echo "2 skip architecture (no diagrams/architecture.json)"
fi

if [ -d "$PKG/ui/screens" ]; then
  echo "3 IFML (export, check, round-trip)"
  "${DG[@]}" ifml "$PKG" "$PKG/ui/ifml.xmi"
  "${DG[@]}" check-ifml "$PKG/ui/ifml.xmi"
  "${DG[@]}" ifml-diff "$PKG" "$PKG/ui/ifml.xmi"
else
  echo "3 skip IFML (no ui/screens)"
fi

echo "4 catalog"
VIEW=()
B=${BPMN_JS_DIR:-$SKILL/../../../../pi-forms-bpmn/.pi/skills/bpmn-package-explorer/assets/bpmn-js}
if [ -f "$B/bpmn-navigated-viewer.production.min.js" ]; then
  VIEW+=(--bpmn-js "$B/bpmn-navigated-viewer.production.min.js" --bpmn-css "$B/diagram-js.css" --bpmn-css "$B/bpmn.css" --bpmn-css "$B/bpmn-font/css/bpmn-embedded.css")
else
  echo "  no bpmn-js viewer (set BPMN_JS_DIR)"
fi
M=${MERMAID_JS:-}
if [ -z "$M" ] && command -v mmdc >/dev/null 2>&1; then
  root=$(cd "$(dirname "$(realpath "$(command -v mmdc)")")/.." && pwd)
  M=$(find "$root" -path '*/mermaid/dist/mermaid.min.js' 2>/dev/null | head -1 || true)
fi
if [ -n "$M" ] && [ -f "$M" ]; then VIEW+=(--mermaid "$M"); else echo "  no mermaid (set MERMAID_JS)"; fi
I=${IFML_JS_DIR:-$SKILL/assets/ifml-js}
VIEW+=(--ifml-js "$I/ifml-navigated-viewer.production.min.js" --ifml-css "$I/diagram-js.css" --ifml-css "$I/ifml-font-embedded.css")
"${DG[@]}" build-site "$PKG" "$PKG/diagrams/catalog.html" "${VIEW[@]}"
echo "RENDER OK"
