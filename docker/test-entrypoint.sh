#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# pi-dashboard TEST entrypoint — wraps the base entrypoint with:
#   1. A path-parity overlay so ${HOST_CWD} is writable inside the container
#      while host files stay untouched (writes land in a throwaway tmpfs).
#   2. A fail-fast smoke check (HTTP /api/health + one WS connect) that exits
#      non-zero before a human is directed to a browser.
#
# TEST_COPY_MODE=1 swaps the overlay for a plain `cp -a` onto a tmpfs — no
# CAP_SYS_ADMIN needed (for locked-down hosts). Slower, RAM-heavy on big trees.
#
# See openspec change docker-test-harness, design.md (Decisions 3 + 4).
# ---------------------------------------------------------------------------
set -euo pipefail

LOWER="/mnt/test-lower"
# upper + work MUST share one filesystem (overlayfs requirement) — both live
# under the single /mnt/test-overlay tmpfs declared in compose.test.yml.
UPPER="/mnt/test-overlay/upper"
WORK="/mnt/test-overlay/work"

# --- 1. Path-parity mount --------------------------------------------------
if [ -n "${HOST_CWD:-}" ]; then
  mkdir -p "${HOST_CWD}"
  if [ "${TEST_COPY_MODE:-}" = "1" ]; then
    # Copy-mode fallback: no overlay, no capability. ${HOST_CWD} is a tmpfs
    # (declared in compose.test.yml) so the copy never touches the host.
    echo "[test-entrypoint] TEST_COPY_MODE=1 → cp -a ${LOWER}/. ${HOST_CWD}"
    # Fail fast: a failed workspace copy means the QA run can't proceed.
    cp -a "${LOWER}/." "${HOST_CWD}/"
  else
    echo "[test-entrypoint] overlay ${LOWER} (ro) + tmpfs upper → ${HOST_CWD}"
    mkdir -p "${UPPER}" "${WORK}"
    mount -t overlay overlay \
      -o "lowerdir=${LOWER},upperdir=${UPPER},workdir=${WORK}" \
      "${HOST_CWD}"
  fi
else
  echo "[test-entrypoint] HOST_CWD unset → no path-parity mount (fixtures only)"
fi

# --- 1b. Materialize VCS fixtures as real repos (ephemeral tmpfs) ----------
if [ -d /fixtures-src ] && [ -d /fixtures ]; then
  cp -a /fixtures-src/. /fixtures/ 2>/dev/null || true
  export GIT_AUTHOR_NAME="pi-test" GIT_AUTHOR_EMAIL="pi-test@localhost"
  export GIT_COMMITTER_NAME="pi-test" GIT_COMMITTER_EMAIL="pi-test@localhost"
  # git-init the baked VCS fixtures (sample-git + the worktree-init hook
  # fixtures for change friendlier-worktree-init). Each becomes a real repo so
  # init-status resolves its declared `.pi/settings.json#worktreeInit` hook.
  for fx in sample-git sample-hook-ok sample-hook-fail; do
    if [ -d "/fixtures/${fx}" ] && ! [ -d "/fixtures/${fx}/.git" ]; then
      ( cd "/fixtures/${fx}" \
        && git init -q \
        && git add -A \
        && git commit -q -m "initial fixture commit" ) \
        && echo "[test-entrypoint] git fixture ready: /fixtures/${fx}"
    fi
  done
fi

# --- 1c. E2E credential + network seed (gated; BEFORE base entrypoint) ------
# Playwright scenario specs (tests/e2e/*.spec.ts beyond smoke) need to clear
# the LandingPage onboarding gate (step 1 = providersReady) AND let the
# in-container browser — whose source IP is the docker gateway, NOT loopback —
# pass createNetworkGuard for guarded endpoints (directory listing, providers).
# Seeded here, before the base entrypoint, so seed-auth.js + config seeding
# both no-op (files already exist). Gated behind PI_E2E_SEED so manual
# test-up.sh QA stays UI-only. Disposable, RAM-backed, localhost-published
# container only — trust scoped to RFC1918 (docker SNAT gateway source IP).
if [ "${PI_E2E_SEED:-}" = "1" ]; then
  PI_DIR="${HOME:-/home/pi}/.pi"
  mkdir -p "${PI_DIR}/agent" "${PI_DIR}/dashboard"
  if [ ! -f "${PI_DIR}/agent/auth.json" ]; then
    # Fake OAuth credential for a provider with a local OAuth handler
    # (anthropic). /api/provider-auth/status reports authenticated:true →
    # providersReady true. Never valid: a spawned session registers over the
    # bridge BEFORE any model call, so card-appearance is independent of key
    # validity.
    EXP=$(( ($(date +%s) + 31536000) * 1000 ))
    printf '{"anthropic":{"type":"oauth","access":"e2e-fake","refresh":"e2e-fake","expires":%s}}\n' "${EXP}" \
      > "${PI_DIR}/agent/auth.json"
    chmod 600 "${PI_DIR}/agent/auth.json"
    echo "[test-entrypoint] PI_E2E_SEED: seeded fake anthropic oauth → auth.json"
  fi
  if [ ! -f "${PI_DIR}/dashboard/config.json" ]; then
    # `trustedNetworks` is the SOURCE field; loadConfig() merges it into the
    # derived `resolvedTrustedNetworks` that createNetworkGuard reads. Seeding
    # the derived field directly is ignored (recomputed at load).
    #
    # This USED to seed only the RFC1918 blocks on the assumption that
    # published-port traffic is always SNAT'd through a private bridge gateway
    # (Linux 172.17.x, Docker Desktop 192.168.65.x). That assumption does NOT
    # hold: on a host running a VPN/secure-DNS layer (e.g. Cloudflare WARP) the
    # peer address the container observes for host traffic can be a PUBLIC
    # address (observed: 172.67.221.13 — outside 172.16.0.0/12, which spans only
    # 172.16-172.31). Every browser request then failed createNetworkGuard, so
    # the UI rendered "Network not allowed" + "Server offline" and every
    # scenario spec died in `pinDirectory` — nondeterministically, depending on
    # the host's network stack.
    #
    # The trust boundary here is the CONTAINER, not the IP range: this is a
    # disposable, RAM-backed, localhost-published test container seeded with a
    # fake credential, and it is torn down (with volumes) after the run. So the
    # seed trusts any peer by default. Override with PI_E2E_TRUSTED_NETWORKS
    # (comma-separated) to narrow it on a host where RFC1918 does hold.
    # `defaultModel` makes the bridge call pi.setModel(faux/faux-1) on each
    # brand-new UI-spawned session (bridge-default-model-gate) so the round-trip
    # specs reach a key-free model with no --model flag.
    # `modelProxy` enabled + one seeded proxy API key so the OAuth-filter E2E
    # spec (tests/e2e/model-proxy-oauth-filter.spec.ts) can auth to /v1/*. Key
    # cleartext is a fixed constant shared with the spec (E2E_PROXY_KEY below);
    # stored hash = sha256(cleartext). Disposable localhost container only.
    # See change: filter-oauth-incompatible-models.
    E2E_PROXY_KEY="pi-proxy-e2e-oauth-filter-000000000000000000000000000000"
    node -e '
      const crypto = require("node:crypto");
      const fs = require("node:fs");
      const [key, spawnStrategy, out, trusted] = process.argv.slice(1);
      const hash = crypto.createHash("sha256").update(key).digest("hex");
      const networks = (trusted || "").split(",").map((s) => s.trim()).filter(Boolean);
      const cfg = {
        spawnStrategy: spawnStrategy || "tmux",
        trustedNetworks: networks.length > 0 ? networks : ["0.0.0.0/0"],
        defaultModel: "faux/faux-1",
        modelProxy: {
          enabled: true,
          maxConcurrentStreams: 16,
          perKeyConcurrentStreams: 4,
          logRequests: false,
          apiKeys: [{ id: "e2e", label: "e2e-oauth-filter", hash, scopes: ["all"], createdAt: 0 }],
        },
      };
      fs.writeFileSync(out, JSON.stringify(cfg) + "\n");
    ' "${E2E_PROXY_KEY}" "${PI_SPAWN_STRATEGY:-tmux}" "${PI_DIR}/dashboard/config.json" "${PI_E2E_TRUSTED_NETWORKS:-}"
    echo "[test-entrypoint] PI_E2E_SEED: seeded trustedNetworks (${PI_E2E_TRUSTED_NETWORKS:-0.0.0.0/0}) + defaultModel + modelProxy apiKey → config.json"
  fi

  # --- Faux model: stage the fixture as a global auto-discovered extension ---
  # pi auto-discovers ~/.pi/agent/extensions/*/index.ts (no -e, no trust gate).
  # Subdir form is required because the extension imports ./faux-scenarios.js.
  # The Dockerfile COPYs qa/fixtures to /app/qa/fixtures. No-op when present.
  FAUX_SRC="/app/qa/fixtures"
  FAUX_EXT_DIR="${PI_DIR}/agent/extensions/faux-provider"
  if [ -f "${FAUX_SRC}/faux-provider.ext.ts" ] && [ ! -f "${FAUX_EXT_DIR}/index.ts" ]; then
    mkdir -p "${FAUX_EXT_DIR}"
    cp "${FAUX_SRC}/faux-provider.ext.ts" "${FAUX_EXT_DIR}/index.ts"
    cp "${FAUX_SRC}/faux-scenarios.ts" "${FAUX_EXT_DIR}/faux-scenarios.ts"
    # The fixture imports `@earendil-works/pi-ai`, unresolvable from
    # ~/.pi/agent/extensions/. Symlink /app/node_modules (where the repo dep
    # lives) into the extension dir so node/jiti resolves pi-ai from here.
    ln -sfn /app/node_modules "${FAUX_EXT_DIR}/node_modules"
    echo "[test-entrypoint] PI_E2E_SEED: staged faux extension → ${FAUX_EXT_DIR}"
  fi

  # Also seed pi's own settings.json defaultModel (read at pi startup) so the
  # faux model is selected even before the bridge gate runs. Merge — never
  # clobber existing keys. No-op when already set.
  SETTINGS="${PI_DIR}/agent/settings.json"
  if [ ! -f "${SETTINGS}" ] || ! grep -q '"defaultModel"' "${SETTINGS}" 2>/dev/null; then
    node -e '
      const fs = require("node:fs");
      const p = process.argv[1];
      let cfg = {};
      try { cfg = JSON.parse(fs.readFileSync(p, "utf8")); } catch { cfg = {}; }
      if (!cfg.defaultModel) cfg.defaultModel = "faux/faux-1";
      fs.mkdirSync(require("node:path").dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n");
    ' "${SETTINGS}"
    echo "[test-entrypoint] PI_E2E_SEED: seeded defaultModel → settings.json"
  fi

  # --- Faux role-preset: every role -> faux/faux-1 (change: add-flow-plugin-e2e-tests) ---
  # Delivery decision (design Open Question resolved): IMAGE-BAKED via this seed
  # step, matching auth.json/config.json/settings.json above. Lets flow agents
  # using `model: @role` resolve to the key-free faux model AND exercises the
  # model:resolve path (a field-bug class). Strips the fixture's `_comment` doc
  # key so pi never sees an unknown field. No-op when providers.json exists.
  ROLES_SRC="/app/qa/fixtures/faux-roles.json"
  PROVIDERS="${PI_DIR}/agent/providers.json"
  if [ -f "${ROLES_SRC}" ] && [ ! -f "${PROVIDERS}" ]; then
    node -e '
      const fs = require("node:fs");
      const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      delete c._comment;
      fs.writeFileSync(process.argv[2], JSON.stringify(c, null, 2) + "\n");
    ' "${ROLES_SRC}" "${PROVIDERS}"
    echo "[test-entrypoint] PI_E2E_SEED: seeded faux role-preset → providers.json"
  fi

  # --- Decoration-mismatched local install (change: match-local-installs-by-package-name) ---
  # A local checkout whose DIRECTORY basename is decorated differently from its
  # published npm name: dir `image-fit-extension` vs name
  # `@blackbelt-technology/pi-image-fit-extension`. The pure-string sourcesMatch
  # basename rule cannot match these, so the recommended-extensions enrichment
  # must fall back to reading package.json#name to report the entry Active.
  # Registered in settings.json packages[] => it lands in activeSources, which is
  # the site that drives the card's Active/Remove button.
  # Manifest creation and settings registration are INDEPENDENT: /fixtures is
  # repopulated from the image each run while ~/.pi lives on a separate tmpfs,
  # so the two can legitimately disagree. Gating registration on "package.json
  # absent" would skip it whenever the dir survives but settings.json does not,
  # leaving the E2E spec without its active source. Both halves are idempotent.
  # The manifest MUST be loadable as a real pi extension, not just a name+version
  # stub. Registering the path in packages[] makes pi LOAD it on every session
  # start, and pi treats a failed extension load as FATAL (exit 1). A stub with no
  # entry point therefore killed every spawned session before it could register,
  # so no card ever rendered and every spec using spawnFreshGitSession timed out
  # at 60s with no server-side error to show for it. The entry must resolve AND
  # default-export a factory function; either alone still exits 1.
  LOCAL_PKG_DIR="/fixtures/local-pkg/image-fit-extension"
  if [ ! -f "${LOCAL_PKG_DIR}/package.json" ]; then
    mkdir -p "${LOCAL_PKG_DIR}"
    printf '%s\n' '{ "name": "@blackbelt-technology/pi-image-fit-extension", "version": "0.0.1", "type": "module", "main": "index.js" }' \
      > "${LOCAL_PKG_DIR}/package.json"
  fi
  # Idempotent alongside the manifest guard above: /fixtures may survive with a
  # legacy entry-less package.json from an older image, so write the entry
  # unconditionally and repair `main`/`type` if they are missing.
  printf '%s\n' 'export default function imageFitFixtureExtension() {' \
                '  return { name: "image-fit-fixture" };' \
                '}' > "${LOCAL_PKG_DIR}/index.js"
  node -e '
    const fs = require("node:fs");
    const [p] = process.argv.slice(1);
    const d = JSON.parse(fs.readFileSync(p, "utf8"));
    let changed = false;
    if (d.main !== "index.js") { d.main = "index.js"; changed = true; }
    if (d.type !== "module") { d.type = "module"; changed = true; }
    if (changed) fs.writeFileSync(p, JSON.stringify(d, null, 2) + "\n");
  ' "${LOCAL_PKG_DIR}/package.json"
  # Always ensure settings.json packages[] carries the path (no-op when present).
  node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const [p, dir] = process.argv.slice(1);
    let s = {};
    try { s = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
    if (!Array.isArray(s.packages)) s.packages = [];
    if (!s.packages.includes(dir)) s.packages.push(dir);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(s, null, 2) + "\n");
  ' "${PI_DIR}/agent/settings.json" "${LOCAL_PKG_DIR}"
  echo "[test-entrypoint] PI_E2E_SEED: decorated local install registered → ${LOCAL_PKG_DIR}"

  # --- Flow-plugin e2e peers, selected by PI_TEST_PEERS (change: add-flow-plugin-e2e-tests) ---
  # Variants: both | no-am | legacy | bad-registration. UNSET => skipped entirely
  # (non-flow specs run exactly as before). The pi-flows engine + anthropic peer
  # are baked globally by the Dockerfile; here we selectively wire them so the L3
  # harness can drive real flows and assert the bridge state machine:
  #   - pi-flows engine -> settings.json packages[] (pi loads it => flow discovery
  #     + run) AND a bare `pi-flows` node_modules symlink for the bridge tier-1
  #     probe. Present in every variant (all variants still run flows).
  #   - anthropic-messages peer -> a node_modules symlink under the SESSION cwd so
  #     the bridge's tier-1 `createRequire(cwd).resolve` hits. The symlink NAME
  #     selects scoped vs legacy resolution.
  # bad-registration flips the escape hatch so the bridge is NOT mirrored into
  # packages[] (invisible to pi = the "no sessions reporting" condition).
  if [ -n "${PI_TEST_PEERS:-}" ]; then
    PF_GLOBAL="/usr/local/lib/node_modules/@blackbelt-technology/pi-flows"
    AM_GLOBAL="/usr/local/lib/node_modules/@blackbelt-technology/pi-anthropic-messages"
    SESSION_CWD="/fixtures/sample-git"
    NM="${SESSION_CWD}/node_modules"
    SETTINGS="${PI_DIR}/agent/settings.json"
    mkdir -p "${NM}/@blackbelt-technology" "${NM}/@pi"

    # Pre-trust the session cwd. The .pi/flows resources (project settings +
    # flows/agents) make /fixtures/sample-git "trust-requiring": a headless RPC
    # session would BLOCK on pi's interactive "Trust project folder?" prompt and
    # never register -> REGISTER_TIMEOUT, no card. Seed pi's trust store
    # (~/.pi/agent/trust.json, cwd -> true; walks parents) so every spawned
    # session auto-trusts. See change: add-flow-plugin-e2e-tests.
    node -e '
      const fs = require("node:fs");
      const [p, cwd] = process.argv.slice(1);
      let d = {};
      try { d = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
      d[cwd] = true;
      fs.writeFileSync(p, JSON.stringify(d, null, 2) + "\n");
    ' "${PI_DIR}/agent/trust.json" "${SESSION_CWD}" \
      && echo "[test-entrypoint] PI_TEST_PEERS: pre-trusted ${SESSION_CWD} (trust.json)"

    register_flows() {
      ln -sfn "${PF_GLOBAL}" "${NM}/pi-flows"
      node -e '
        const fs = require("node:fs");
        const path = require("node:path");
        const [p, dir] = process.argv.slice(1);
        let s = {};
        try { s = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
        if (!Array.isArray(s.packages)) s.packages = [];
        if (!s.packages.includes(dir)) s.packages.push(dir);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, JSON.stringify(s, null, 2) + "\n");
      ' "${SETTINGS}" "${PF_GLOBAL}"
    }

    case "${PI_TEST_PEERS}" in
      both)
        register_flows
        ln -sfn "${AM_GLOBAL}" "${NM}/@blackbelt-technology/pi-anthropic-messages"
        ;;
      no-am)
        register_flows
        # anthropic peer intentionally ABSENT -> bridge parks in waiting_peers
        ;;
      legacy)
        register_flows
        ln -sfn "${AM_GLOBAL}" "${NM}/@pi/anthropic-messages"   # legacy name only
        ;;
      bad-registration)
        register_flows
        ln -sfn "${AM_GLOBAL}" "${NM}/@blackbelt-technology/pi-anthropic-messages"
        export PI_DASHBOARD_DISABLE_PLUGIN_BRIDGE_PACKAGES_WRITE=1
        ;;
      *)
        echo "[test-entrypoint] WARN: unknown PI_TEST_PEERS='${PI_TEST_PEERS}' (both|no-am|legacy|bad-registration)" >&2
        ;;
    esac

    # Loading the pi-flows engine (jiti TS-compile of the whole engine) on a COLD
    # RPC spawn can exceed the 30s spawnRegisterTimeoutMs default under container
    # load -> the dashboard-spawned session hits REGISTER_TIMEOUT and no card
    # appears. Two mitigations (harness-only):
    #  1) bump spawnRegisterTimeoutMs in the seeded config.json (clamped 120000),
    #  2) warm the jiti compile cache once here so the FIRST UI-spawned session
    #     reuses cached JS instead of paying the full compile in the register
    #     window. Both gated on PI_TEST_PEERS so non-flow runs are unaffected.
    CFG="${PI_DIR}/dashboard/config.json"
    node -e '
      const fs = require("node:fs");
      const p = process.argv[1];
      let c = {};
      try { c = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
      c.spawnRegisterTimeoutMs = 90000;
      fs.writeFileSync(p, JSON.stringify(c) + "\n");
    ' "${CFG}" && echo "[test-entrypoint] PI_TEST_PEERS: bumped spawnRegisterTimeoutMs=90000"
    # Warm the jiti compile cache in the BACKGROUND so it never delays container
    # readiness (the health gate below must not wait ~40s for the compile). By
    # the time a spec spawns its first session the cache is warm (or warming);
    # the bumped spawnRegisterTimeoutMs covers any residual cold compile.
    echo "[test-entrypoint] PI_TEST_PEERS: warming pi-flows jiti compile cache (background)..."
    ( cd "${SESSION_CWD}" && timeout 120 pi --list-models >/dev/null 2>&1 || true ) &
    echo "[test-entrypoint] PI_TEST_PEERS=${PI_TEST_PEERS}: wired flow-plugin e2e peers"
  fi
fi

# --- 2. Launch the dashboard daemon via the base entrypoint ----------------
# The base entrypoint seeds auth/config, starts tmux, then runs
# `pi-dashboard start` — which spawns a DETACHED server daemon (pidfile below)
# and returns once it polls healthy. We keep PID 1 alive afterward (step 4).
PORT="${DASHBOARD_PORT:-18000}"
PIDFILE="${HOME:-/home/pi}/.pi/dashboard/server.pid"
echo "[test-entrypoint] launching dashboard daemon via base entrypoint..."
# The base launcher waits up to 30s for readiness then exits non-zero, but the
# server is spawned DETACHED (unref'd) and SURVIVES that timeout — cold-start
# via the jiti TS loader can exceed 30s on a loaded host. Tolerate a non-zero
# return; our own health poll below is the authority on readiness.
/usr/local/bin/entrypoint.sh "$@" \
  || echo "[test-entrypoint] base launcher exited non-zero (likely readiness timeout); daemon is detached, polling health..."

# --- 3. Fail-fast smoke check ----------------------------------------------
smoke_fail() {
  echo "[test-entrypoint] SMOKE FAILED: $1" >&2
  [ -f "${PIDFILE}" ] && kill -TERM "$(cat "${PIDFILE}")" 2>/dev/null || true
  exit 1
}

# Confirm HTTP /api/health. Poll generously — a slow jiti cold-start may still
# be initializing after the base launcher's 30s window elapsed.
healthy=0
for _ in $(seq 1 90); do
  if curl --connect-timeout 1 --max-time 2 -fsS "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 1
done
[ "${healthy}" = "1" ] || smoke_fail "GET /api/health did not return 200 within ~90s"
echo "[test-entrypoint] health OK"

# One WebSocket connect to /ws (Node 22 ships a global WebSocket client).
node -e '
  const url = process.argv[1];
  const ws = new WebSocket(url);
  const t = setTimeout(() => { console.error("ws connect timeout"); process.exit(1); }, 5000);
  ws.onopen = () => { clearTimeout(t); ws.close(); process.exit(0); };
  ws.onerror = (e) => { clearTimeout(t); console.error("ws error", (e && e.message) || e); process.exit(1); };
' "ws://localhost:${PORT}/ws" || smoke_fail "WebSocket connect to /ws failed"
echo "[test-entrypoint] websocket OK"

echo "[test-entrypoint] SMOKE PASSED → dashboard ready on http://localhost:${PORT}"

# --- 4. Keep PID 1 alive for the daemon's lifetime -------------------------
SERVER_PID="$(cat "${PIDFILE}" 2>/dev/null || true)"
[ -n "${SERVER_PID}" ] || smoke_fail "server.pid not found at ${PIDFILE}"
trap 'kill -TERM "${SERVER_PID}" 2>/dev/null || true' TERM INT
while kill -0 "${SERVER_PID}" 2>/dev/null; do
  sleep 5
done
echo "[test-entrypoint] dashboard daemon (pid ${SERVER_PID}) exited"
