#!/usr/bin/env bash
# Diagnose the Panerelay path — driving the user's OWN logged-in browser.
#
# Platform-independent: macOS, Linux, WSL, Git-Bash. Discovers every path
# through the tools themselves rather than hardcoding OS locations.
#
# Usage:
#   bash check-panerelay.sh            # fast, no network
#   bash check-panerelay.sh --deep     # also runs `@panerelay/setup doctor` (needs npx + network)
#
# Output (key=value):
#   AGENT_BROWSER=0.33.2
#   VERSION_OK=yes
#   PLUGIN=registered
#   NATIVE_HOST=/Users/me/.panerelay/bin/panerelay-native-host.cjs
#   EXTENSION=connected
#   TABS=3
#   READY=yes
#
# Non-ready runs always emit a NEXT= line with the single next action.
#
# NOTE: agent-browser reports plugin failures as a bare
#   "Plugin 'panerelay' returned success=false"
# and drops the plugin's actual message. On probe failure this script asks the
# native host directly (step 5b) so the REAL cause is surfaced — most often
# several registered browsers, not a disconnected extension.

set -uo pipefail   # NOTE: no -e; probes are expected to fail and are handled

DEEP=no
[ "${1:-}" = "--deep" ] && DEEP=yes

# Unique per run. A session daemon STICKS to the browser it first resolved, so a
# name reused across runs replays the earlier (possibly failed) binding and the
# probe keeps failing after the real cause is fixed. Do NOT "fix" that with
# `close --all` — that flag is not session-scoped and kills every session,
# including unrelated ones the user is driving.
SESSION="${PANERELAY_CHECK_SESSION:-panerelay-check-$$}"

# ── 1. CLI present ─────────────────────────────────────────────────

if ! command -v agent-browser >/dev/null 2>&1; then
  echo "AGENT_BROWSER=not-installed"
  echo "READY=no"
  echo "NEXT=install the CLI: pi install npm:pi-agent-browser"
  exit 0
fi

VER=$(agent-browser --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
echo "AGENT_BROWSER=${VER:-unknown}"

# ── 2. Version gate: Panerelay needs the plugin provider (>= 0.33.0) ─

MIN="0.33.0"
if [ -n "$VER" ] && [ "$(printf '%s\n%s\n' "$MIN" "$VER" | sort -t. -k1,1n -k2,2n -k3,3n | head -1)" = "$MIN" ]; then
  echo "VERSION_OK=yes"
else
  echo "VERSION_OK=no"
  echo "READY=no"
  echo "NEXT=upgrade to >= $MIN (npm install -g agent-browser@latest); --provider needs plugin support"
  exit 0
fi

# ── 3. Provider plugin registered in the agent-browser user config ──

CONFIG="$HOME/.agent-browser/config.json"
if [ -f "$CONFIG" ] && grep -q '"panerelay"' "$CONFIG" 2>/dev/null; then
  echo "PLUGIN=registered"
else
  echo "PLUGIN=missing"
  echo "READY=no"
  echo "NEXT=run: npx --yes @panerelay/setup --agent-browser   (omit --global-default)"
  exit 0
fi

# Warn if Panerelay was made the global default — it should stay opt-in.
if grep -qE '"(defaultProvider|provider)"[[:space:]]*:[[:space:]]*"panerelay"' "$CONFIG" 2>/dev/null; then
  echo "GLOBAL_DEFAULT=yes"
else
  echo "GLOBAL_DEFAULT=no"
fi

# ── 4. Native messaging host binary ────────────────────────────────

HOST=$(grep -oE '"command"[[:space:]]*:[[:space:]]*"[^"]+"' "$CONFIG" 2>/dev/null \
        | head -1 | sed -E 's/.*"command"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
if [ -n "${HOST:-}" ] && [ -f "$HOST" ]; then
  echo "NATIVE_HOST=$HOST"
else
  echo "NATIVE_HOST=missing"
  echo "READY=no"
  echo "NEXT=re-run: npx --yes @panerelay/setup --agent-browser"
  exit 0
fi

# ── 5. Live probe — the only check that proves the browser is reachable

PROBE=$(agent-browser --session "$SESSION" --provider panerelay tab list 2>&1)
PROBE_RC=$?

if [ $PROBE_RC -eq 0 ]; then
  echo "EXTENSION=connected"
  echo "TABS=$(printf '%s\n' "$PROBE" | grep -cE '^\s*[→ ]*\[t[0-9]+\]')"
  echo "READY=yes"
elif printf '%s' "$PROBE" | grep -qi 'all-tabs authorization'; then
  # Extension IS connected; consent is simply narrower than this command needs.
  echo "EXTENSION=connected"
  echo "AUTHORIZATION=per-tab"
  echo "READY=no"
  echo "NEXT=open the Panerelay side panel and authorize all tabs (or drive one authorized tab)"
else
  # ── 5b. agent-browser hid the reason — ask the native host directly ──
  #
  # A bare `success=false` carries no diagnosis. The plugin protocol does:
  # speak browser.launch to the host and read its `error` field verbatim.
  RAW=$(printf '%s' \
    '{"protocol":"agent-browser.plugin.v1","type":"browser.launch","capability":"browser.provider","request":{"sessionName":"'"$SESSION"'"}}' \
    | node "$HOST" --agent-browser-plugin 2>/dev/null)

  REASON=$(printf '%s' "$RAW" \
    | sed -n 's/.*"error"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/p' | head -1)

  if printf '%s' "$RAW" | grep -q '"success"[[:space:]]*:[[:space:]]*true'; then
    # Host hands out a browser fine; only the CLI hop failed.
    echo "EXTENSION=connected"
    echo "READY=no"
    echo "NEXT=host is healthy but the agent-browser CLI hop failed — usually a session daemon stuck on an earlier binding; re-run with PANERELAY_CHECK_SESSION=<fresh-name>"
  elif printf '%s' "$REASON" | grep -qi 'Multiple Panerelay browsers'; then
    # The common case: several Chrome processes carry the extension, so the
    # plugin refuses to guess which one to drive.
    echo "EXTENSION=connected"
    echo "AMBIGUOUS_BROWSER=yes"
    # Surface every candidate UUID so the caller can pick one.
    printf '%s' "$REASON" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' \
      | while read -r id; do echo "BROWSER_ID=$id"; done
    echo "READY=no"
    echo "NEXT=re-run with PANERELAY_BROWSER_ID=<one of the BROWSER_ID values above> (try each: the right one lists your real tabs)"
  elif [ -n "$REASON" ]; then
    # Host gave a specific diagnosis — pass it through rather than guess.
    echo "EXTENSION=connected"
    echo "READY=no"
    echo "NEXT=$REASON"
  else
    echo "EXTENSION=disconnected"
    echo "READY=no"
    echo "NEXT=install/reload the Panerelay extension in the target Chrome profile, then open its side panel"
  fi
  echo "DETAIL=$(printf '%s' "$PROBE" | head -1 | cut -c1-160)"
fi

# ── 6. Optional deep check ─────────────────────────────────────────

if [ "$DEEP" = "yes" ] && command -v npx >/dev/null 2>&1; then
  echo "--- doctor ---"
  npx --yes @panerelay/setup doctor --agent-browser --lang en </dev/null 2>&1 \
    | grep -E '✅|⚠️|❌' | head -20
fi
