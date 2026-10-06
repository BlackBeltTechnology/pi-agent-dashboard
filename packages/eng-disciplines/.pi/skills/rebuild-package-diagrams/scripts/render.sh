#!/usr/bin/env bash
# Full render of a rebuild package with every gate: render.sh <packageDir> [appDir]
#   check-use-cases -> [architecture.json] check-architecture (+ --app) + arch
#   -> [ui/screens] ifml + check-ifml + round-trip ifml-diff (must be "no differences")
#   -> [diagrams/sequences|state-machines|objects] check-sequences/check-states (--app) + check-objects + behaviour export
#   -> build-site with every viewer found -> <packageDir>/diagrams/catalog.html
#   -> [diagrams/uc-links] check-uc-links --complete (gate; links feed screens/uiActions of use cases)
#   -> [diagrams/variability] check-variability --complete (APP) + export (diagrams/variability-matrix/)
#   -> [diagrams/crud] check-crud + crud export (diagrams/crud-matrix/)
#   -> check-size report (diagrams over the size budget are split into overview + parts)
# MAX_NODES / MAX_EDGES set the size budget (default 30 / 40); STRICT_SIZE=1 fails when a part stays over it.
# LOCAL=1 also gates and embeds real-data object diagrams from <packageDir>/_local/objects (local builds only).
# USAGE_JOB=<job.json>: gate the usage mapping against every logged type; with LOCAL=1 also aggregate
#   per-customer usage into <packageDir>/_local/usage (privacy-gated) and embed it in the local catalog.
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
BUDGET=(--max-nodes "${MAX_NODES:-30}" --max-edges "${MAX_EDGES:-40}")

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
  rm -rf "$PKG/ui/ifml-parts"
  "${DG[@]}" ifml-parts "$PKG" "$PKG/ui/ifml-parts" "${BUDGET[@]}"
else
  echo "3 skip IFML (no ui/screens)"
fi

D=$PKG/diagrams
if [ -d "$D/sequences" ] || [ -d "$D/state-machines" ] || [ -d "$D/objects" ] || { [ -n "${LOCAL:-}" ] && [ -d "$PKG/_local/objects" ]; }; then
  echo "3b behaviour (sequence, collaboration, state machine, object)"
  "${DG[@]}" check-sequences "$PKG" ${APP:+--app "$APP"}
  "${DG[@]}" check-states "$PKG" ${APP:+--app "$APP"}
  "${DG[@]}" check-objects "$PKG" ${LOCAL:+--local}
  "${DG[@]}" behaviour "$PKG" "$D/behaviour" "${BUDGET[@]}"
else
  echo "3b skip behaviour (no diagrams/sequences, state-machines or objects)"
fi

if [ -d "$D/uc-links" ]; then
  echo "3b'' use-case UI links (gate, every use case)"
  "${DG[@]}" check-uc-links "$PKG" --complete
else
  echo "3b'' skip use-case links (no diagrams/uc-links)"
fi

if [ -f "$D/variability/features.json" ]; then
  echo "3bv customer variability (gate, every varying config path)"
  if [ -n "$APP" ]; then "${DG[@]}" check-variability "$PKG" "$APP" --complete; else echo "  (no APP: cite lines not checked)"; fi
  "${DG[@]}" variability "$PKG" "$D/variability-matrix"
else
  echo "3bv skip variability (no diagrams/variability/features.json)"
fi

if [ -f "$D/usage/mapping.json" ]; then
  echo "3bu usage evidence (mapping gate; counts only with LOCAL=1 and USAGE_JOB)"
  if [ -n "${USAGE_JOB:-}" ] && [ -n "$APP" ]; then "${DG[@]}" check-usage "$PKG" "$APP" "$USAGE_JOB" --complete; fi
  if [ -n "${LOCAL:-}" ] && [ -n "${USAGE_JOB:-}" ]; then
    "${DG[@]}" usage "$PKG" "$USAGE_JOB" "$PKG/_local/usage"
    "${DG[@]}" check-usage-output "$PKG/_local/usage" "$USAGE_JOB"
  fi
else
  echo "3bu skip usage (no diagrams/usage/mapping.json)"
fi

if [ -d "$D/crud" ]; then
  echo "3b' CRUD matrix"
  "${DG[@]}" check-crud "$PKG"
  "${DG[@]}" crud "$PKG" "$D/crud-matrix"
else
  echo "3b' skip CRUD (no diagrams/crud)"
fi

echo "3c size budget (${MAX_NODES:-30} nodes / ${MAX_EDGES:-40} edges)"
"${DG[@]}" check-size "$PKG" "${BUDGET[@]}" ${STRICT_SIZE:+--strict} | tail -1

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
OUT=$PKG/diagrams/catalog.html
if [ -n "${LOCAL:-}" ]; then VIEW+=(--local); OUT=$PKG/_local/catalog.local.html; mkdir -p "$PKG/_local"; fi
"${DG[@]}" build-site "$PKG" "$OUT" "${VIEW[@]}" "${BUDGET[@]}"
echo "RENDER OK"
