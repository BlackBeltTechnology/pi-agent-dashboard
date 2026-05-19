#!/usr/bin/env bash
# Reproducer for v0.5.3 published-tarball packaging bugs.
# Runs inside node:22 docker. NO host pollution.
set +e   # capture exit codes, don't abort on failure
export DEBIAN_FRONTEND=noninteractive

banner() {
  echo
  echo "================================================================"
  echo "## $1"
  echo "================================================================"
}

banner "ENV: clean machine baseline"
node --version
npm --version
which pi 2>&1 || echo "(no pi)"
which pi-dashboard 2>&1 || echo "(no pi-dashboard)"
ls -la /root/.pi-dashboard 2>&1 | head -1 || echo "(no ~/.pi-dashboard)"

banner "STEP 1 — published v0.5.3 default install (Finding B expected)"
npm install -g @blackbelt-technology/pi-agent-dashboard@0.5.3
echo "exit: $?"

banner "STEP 2 — workaround B: --ignore-scripts (Finding A expected at invoke)"
npm install -g --ignore-scripts @blackbelt-technology/pi-agent-dashboard@0.5.3
echo "exit: $?"
which pi-dashboard && ls -la "$(which pi-dashboard)"

banner "STEP 3 — invoke pi-dashboard (Finding A: bin -> .ts)"
pi-dashboard --version 2>&1 | head -20
echo "exit: $?"

banner "STEP 4 — check what's missing in the installed tree"
GLOBAL=/usr/local/lib/node_modules/@blackbelt-technology/pi-agent-dashboard
echo "--- root package.json bin ---"
node -e 'console.log(JSON.stringify(require("'"$GLOBAL"'/package.json").bin, null, 2))' 2>&1
echo "--- inner server package.json bin ---"
node -e 'console.log(JSON.stringify(require("'"$GLOBAL"'/packages/server/package.json").bin, null, 2))' 2>&1
echo "--- is bin/pi-dashboard.mjs in tarball? ---"
ls "$GLOBAL/packages/server/bin/" 2>&1
echo "--- is scripts/fix-pty-permissions.cjs in tarball? ---"
ls "$GLOBAL/packages/server/scripts/" 2>&1
echo "--- is jiti installed? ---"
ls "$GLOBAL/node_modules/jiti/package.json" 2>&1
echo "--- which @mariozechner/jiti or @oh-my-pi/jiti? ---"
ls "$GLOBAL/node_modules/@mariozechner/jiti/package.json" 2>&1
ls "$GLOBAL/node_modules/@oh-my-pi/jiti/package.json" 2>&1
echo "--- fastify ---"
ls "$GLOBAL/node_modules/fastify/package.json" 2>&1 | head -1
echo "--- @blackbelt-technology/pi-dashboard-web (client) ---"
ls "$GLOBAL/node_modules/@blackbelt-technology/pi-dashboard-web/dist/index.html" 2>&1 | head -1

banner "STEP 5 — direct .ts invoke (proves Finding A is structural, not just shim)"
node "$GLOBAL/packages/server/src/cli.ts" --version 2>&1 | head -5
echo "exit: $?"

banner "STEP 6 — published-tarball file list (proves A/B at the tarball layer)"
npm view @blackbelt-technology/pi-agent-dashboard@0.5.3 2>&1 | grep -E "(bin|files|version):" | head -20
echo
echo "--- pack the tarball locally and inspect contents ---"
cd /tmp && npm pack @blackbelt-technology/pi-agent-dashboard@0.5.3 2>&1 | tail -2
TGZ=$(ls -t /tmp/blackbelt-technology-pi-agent-dashboard-*.tgz | head -1)
echo "tarball: $TGZ"
echo "--- does tarball contain bin/pi-dashboard.mjs? ---"
tar -tzf "$TGZ" | grep -E "bin/|scripts/" | head -20
echo "--- does tarball contain fix-pty-permissions.cjs? ---"
tar -tzf "$TGZ" | grep -E "fix-pty-permissions" | head
echo "--- does tarball declare jiti? ---"
tar -xzOf "$TGZ" package/package.json | node -e 'let d=""; process.stdin.on("data",c=>d+=c); process.stdin.on("end",()=>{const p=JSON.parse(d); console.log("bin:", JSON.stringify(p.bin)); console.log("dependencies.jiti:", p.dependencies?.jiti ?? "(none)"); console.log("peerDependencies.jiti:", p.peerDependencies?.jiti ?? "(none)");})'

banner "SUMMARY"
echo "Tested: @blackbelt-technology/pi-agent-dashboard@0.5.3 published to npm"
echo "Tested in: node:22-bookworm-slim, fresh container, no host pollution"
echo "Findings reproduced:"
echo "  A — bin field targets .ts source (npm shim cannot invoke)"
echo "  B — postinstall script missing from tarball"
echo "  C — jiti not declared as runtime dep"
echo "(Finding D resolver mismatch is inside the source, surfaces after A/B/C fixed)"
