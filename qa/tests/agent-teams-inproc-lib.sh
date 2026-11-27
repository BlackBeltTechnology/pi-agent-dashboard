#!/usr/bin/env bash
# Shared helpers of the in-process agent-teams L2 scripts (60-agent-teams-inproc-persistence.sh,
# 61-agent-teams-inproc-perf.sh). SOURCE it AFTER dist-only-lib.sh; it defines functions only (no output, no side effects).
# Lives in qa/tests so run-test.sh uploads it with the scripts. See change: add-agent-teams-in-process (task 2.7, B105).
#
# The two scripts run the lead of an in-process team against either
#   - the FAKE subagents extension (qa/fixtures/fake-subagents.ext.ts, loaded with `pi -e` on the lead only), or
#   - the REAL `@blackbelt-technology/pi-dashboard-subagents` package (>= 0.9.0, gate task 1.11) when QA_SUBAGENTS_PKG_DIR
#     names a checkout / install of it. Nothing is auto-detected: an older package (the installed 0.6.0) does not answer
#     `subagents:capabilities`, so only an explicit directory that passes the checks below counts.

# Upstream release that introduces the API; keep equal to SUBAGENTS_TARGET_RELEASE in
# packages/agent-teams-plugin/src/shared/subagents-contract.ts.
ATI_TARGET_RELEASE="0.9.0"

# ati_upstream_reason — prints why the real upstream package is NOT usable (empty line when it is). Exit 0 = usable.
ati_upstream_reason() {
  local dir="${QA_SUBAGENTS_PKG_DIR:-}"
  if [ -z "$dir" ]; then echo "QA_SUBAGENTS_PKG_DIR not set (the upstream release $ATI_TARGET_RELEASE is not installed here)"; return 1; fi
  if [ ! -f "$dir/package.json" ]; then echo "QA_SUBAGENTS_PKG_DIR=$dir has no package.json"; return 1; fi
  local verdict
  verdict=$(DIR="$dir" TARGET="$ATI_TARGET_RELEASE" node -e '
    const fs = require("fs"), path = require("path");
    const dir = process.env.DIR;
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    if (pkg.name !== "@blackbelt-technology/pi-dashboard-subagents") { console.log("package is " + pkg.name + ", not @blackbelt-technology/pi-dashboard-subagents"); process.exit(0); }
    const num = (v) => String(v).split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
    const [a, b] = [num(pkg.version), num(process.env.TARGET)];
    for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== (b[i] || 0)) { if ((a[i] || 0) < (b[i] || 0)) { console.log("version " + pkg.version + " < " + process.env.TARGET); process.exit(0); } break; } }
    // The release must actually answer the capability query (the 0.6.0 install does not).
    const found = (function walk(d, depth) {
      if (depth > 4) return false;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (walk(p, depth + 1)) return true; }
        else if (/\.(ts|js|mjs|cjs)$/.test(e.name) && fs.readFileSync(p, "utf8").includes("subagents:capabilities")) return true;
      }
      return false;
    })(dir, 0);
    console.log(found ? "" : "no source file of " + pkg.name + " handles subagents:capabilities");
  ') || { echo "could not inspect $dir"; return 1; }
  if [ -n "$verdict" ]; then echo "$verdict"; return 1; fi
  return 0
}

# ati_register_upstream <prefix> — add $QA_SUBAGENTS_PKG_DIR to the hermetic prefix's pi settings packages (what the harness
# `register_subagents` does), so a lead started with HOME=<prefix> loads the real package.
ati_register_upstream() {
  local settings="$1/.pi/agent/settings.json"
  mkdir -p "$(dirname "$settings")"
  node -e '
    const fs = require("fs");
    const [p, dir] = process.argv.slice(1);
    let s = {};
    try { s = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
    if (!Array.isArray(s.packages)) s.packages = [];
    if (!s.packages.includes(dir)) s.packages.push(dir);
    fs.writeFileSync(p, JSON.stringify(s, null, 2) + "\n");' "$settings" "$QA_SUBAGENTS_PKG_DIR"
}

# ati_stage_faux <prefix> <fixture dir> — the faux provider as a global extension of the hermetic prefix (dashboard-spawned
# teammates need the model too), exactly as 60-agent-teams-core.sh / 70-agent-teams-templates.sh stage it.
ati_stage_faux() {
  local dir="$1/.pi/agent/extensions/faux-provider"
  mkdir -p "$dir"
  cp "$2/faux-provider.ext.ts" "$dir/index.ts"
  cp "$2/faux-scenarios.ts" "$dir/faux-scenarios.ts"
}
