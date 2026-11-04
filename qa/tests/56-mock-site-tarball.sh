#!/usr/bin/env bash
# Test: the live-component mock site runs from an INSTALLED tarball (test-plan X9).
# See change: add-live-component-mock-site (design D1, D10, D11).
#
# WHY: in this monorepo the package is a workspace symlink outside node_modules,
# so Node strips its TS and plugin-react refreshes its files. An installed
# consumer gets the package under node_modules, where neither holds. This packs
# packages/mockup-loop, installs it into a fresh React + Vite + Tailwind project,
# serves one mock, and checks the shell is transformed and the plugin answers.
#
# OPT-IN (needs network for npm install): not listed in run-all.sh.
#   bash qa/tests/56-mock-site-tarball.sh
# Inputs (optional):
#   QA_PREFIX   scratch dir (default: mktemp -d); QA_PREFIX_KEEP=1 keeps it
#   QA_PORT     site port (default 18956)
set -euo pipefail

echo "=== Test: mock site from an installed tarball (X9) ==="

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SCRATCH="${QA_PREFIX:-$(mktemp -d)}"
PORT="${QA_PORT:-18956}"
APP="$SCRATCH/app"
PID=""
FAILED=0
fail() { echo "FAIL: $*"; FAILED=1; }
cleanup() {
  [ -n "$PID" ] && kill -9 "$PID" 2>/dev/null || true
  [ -z "${QA_PREFIX_KEEP:-}" ] && rm -rf "$SCRATCH"
}
trap cleanup EXIT

# 1. Pack: listing must carry site/ + src/mock-site/*.mjs and no tests.
LIST=$(cd "$REPO/packages/mockup-loop" && npm pack --dry-run 2>&1)
echo "$LIST" | grep -q "site/Site.tsx" || fail "pack: site/Site.tsx missing"
echo "$LIST" | grep -q "src/mock-site/plugin.mjs" || fail "pack: src/mock-site/plugin.mjs missing"
echo "$LIST" | grep -q "src/mock-site/cli.mjs" || fail "pack: src/mock-site/cli.mjs missing"
echo "$LIST" | grep -q "__tests__" && fail "pack: tests leaked into the tarball"
TGZ=$(cd "$REPO/packages/mockup-loop" && npm pack --silent --pack-destination "$SCRATCH" | tail -1)
TGZ="$SCRATCH/$TGZ"
[ -f "$TGZ" ] || { echo "FAIL: npm pack produced no tarball"; exit 1; }

# 2. Fresh consumer project.
mkdir -p "$APP/mockups/2026-11-03-hello"
cat > "$APP/package.json" <<JSON
{ "name": "mock-site-consumer", "private": true, "type": "module",
  "dependencies": { "@blackbelt-technology/frontend-mockup-loop": "file:$TGZ",
    "vite": "^6.0.0", "@vitejs/plugin-react": "^4.3.0", "react": "^19.0.0", "react-dom": "^19.0.0",
    "tailwindcss": "^4.0.0", "@tailwindcss/vite": "^4.0.0", "typebox": "^1.3.6" } }
JSON
cat > "$APP/mockups/mock-site.config.ts" <<'TS'
import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { mockSite } from "@blackbelt-technology/frontend-mockup-loop/src/mock-site/plugin.mjs";
export default { plugins: [react(), tailwindcss(), mockSite({ projectRoot: path.resolve(__dirname, ".."), app: "./mock-site.app.tsx", title: "Consumer mocks" })] };
TS
cat > "$APP/mockups/mock-site.css" <<'CSS'
@import "tailwindcss";
@source ".";
CSS
cat > "$APP/mockups/mock-site.app.tsx" <<'TSX'
import type { ReactNode } from "react";
export async function setup() { await import("./mock-site.css"); }
export function Providers({ children }: { children: ReactNode }) { return <>{children}</>; }
TSX
cat > "$APP/mockups/2026-11-03-hello/mock.tsx" <<'TSX'
import { Fix, Issue, type Mock } from "mock-site/kit";
const mock: Mock = { title: "Hello", category: "Demo", frames: [{ title: "Hello - desktop",
  current: <Issue n={1} tip="old"><p className="mt-[7px]">old</p></Issue>,
  proposed: <Fix n={1} tip="new"><p className="mt-[7px]">new</p></Fix> }] };
export default mock;
TSX
(cd "$APP" && npm install --no-audit --no-fund --loglevel=error) || { echo "FAIL: npm install"; exit 1; }

# 3. Installed bin works without the site running.
(cd "$APP" && npx --no-install mock-decide list) | grep -q "2026-11-03-hello" || fail "mock-decide list did not find the mock"

# 4. Serve exactly like serve_mock_site does (host Vite + project config, strict port).
(cd "$APP" && node node_modules/vite/bin/vite.js --config mockups/mock-site.config.ts --port "$PORT" --strictPort > "$SCRATCH/vite.log" 2>&1) &
PID=$!
ok=""
for _ in $(seq 1 120); do
  if curl -fsS "http://127.0.0.1:$PORT/__mock/decisions" -o "$SCRATCH/decisions.json" 2>/dev/null; then ok=1; break; fi
  sleep 0.5
done
[ -n "$ok" ] || { cat "$SCRATCH/vite.log"; echo "FAIL: site not ready"; exit 1; }
grep -q '"mockSite":true' "$SCRATCH/decisions.json" || fail "/__mock/decisions lacks mockSite:true"

curl -fsS "http://127.0.0.1:$PORT/" -o "$SCRATCH/index.html" || fail "GET / failed"
SRC=$(grep -oE 'src="/@fs/[^"]+main\.tsx"' "$SCRATCH/index.html" | head -1 | sed -e 's/^src="//' -e 's/"$//')
[ -n "$SRC" ] || fail "HTML entry has no main.tsx script"
case "$SRC" in *node_modules*) ;; *) fail "entry is not served from node_modules: $SRC" ;; esac
curl -fsS "http://127.0.0.1:$PORT$SRC" -o "$SCRATCH/main.js" || fail "GET main.tsx failed"
grep -q "<Providers>" "$SCRATCH/main.js" && fail "main.tsx served untransformed (JSX left)"
grep -qE "jsx(DEV)?\(" "$SCRATCH/main.js" || fail "main.tsx not compiled to jsx calls"
SITE=$(echo "$SRC" | sed 's/main\.tsx$/Site.tsx/')
curl -fsS "http://127.0.0.1:$PORT$SITE" -o "$SCRATCH/site.js" || fail "GET Site.tsx failed"
grep -q "virtual:mock-site/mocks\|__x00__virtual:mock-site/mocks\|@id/__x00__virtual" "$SCRATCH/site.js" || fail "Site.tsx does not import the mocks module"

if [ "$FAILED" -ne 0 ]; then tail -20 "$SCRATCH/vite.log"; echo "=== FAILED ==="; exit 1; fi
echo "=== PASSED ==="
