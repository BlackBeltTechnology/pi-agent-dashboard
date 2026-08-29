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

  # The board drop-targeting specs need a column deep enough to overflow its
  # visible height (≥14 cards) and a 64-card column for the frame-budget
  # assertion. Generated here so 64 change directories stay out of the repo.
  # See change: fix-openspec-board-drop-targeting.
  # Sentinel is the LAST card written, not the first: a boot interrupted
  # mid-generation would otherwise look complete and leave a short fixture.
  BOARD_FX=/fixtures/openspec-board/openspec/changes
  if [ -d "/fixtures/openspec-board/openspec" ] && ! [ -d "${BOARD_FX}/board-card-64" ]; then
    for n in $(seq 1 64); do
      # Two-digit, zero-padded — `card()` in tests/e2e/helpers/openspec-board.ts
      # pads to the same width, so the names must match exactly. printf keeps
      # that contract explicit instead of resting on GNU `seq -w`.
      i=$(printf '%02d' "${n}")
      mkdir -p "${BOARD_FX}/board-card-${i}"
      printf '# Proposal - board card %s\n\n## Why\n\nBoard drop-target fixture card.\n' "${i}" \
        > "${BOARD_FX}/board-card-${i}/proposal.md"
      # One unchecked task each, so every card derives the same in-progress
      # state and the cards render at a uniform height.
      printf '# Tasks - board card %s\n\n## 1. Fixture\n\n- [ ] 1.1 Fixture card.\n' "${i}" \
        > "${BOARD_FX}/board-card-${i}/tasks.md"
    done
    echo "[test-entrypoint] board fixture ready: 64 changes in ${BOARD_FX}"
  fi
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

  # --- OAuth provider seed (PI_E2E_OAUTH=1) ---------------------------------
  # `oauth-redirect-base.spec.ts` asserts on `/auth/*` routes, which only exist
  # when the server booted with at least one RESOLVABLE provider: the auth
  # plugin returns early on an empty registry, registering no route and no
  # reload hook (design D6 of config-override-oauth-redirect-base).
  #
  # The provider therefore has to be on disk BEFORE the server starts. A spec
  # cannot arrange that itself: `pi-state` is a RAM-backed tmpfs (compose.test
  # .yml), so every container start hands the server a fresh, empty `~/.pi` and
  # discards anything a previous process wrote through `PUT /api/config`. That
  # is the harness's isolation model, not a bug — so the seed goes here.
  #
  # `github` is the one built-in provider that resolves with NO network I/O
  # (static endpoints, no OIDC discovery), so this works in an offline CI box.
  #
  # `bypassUrls:["/"]` is MANDATORY and load-bearing: requests from the
  # Playwright host arrive as NON-loopback, so an armed auth gate with no bypass
  # would lock every other spec out of the shared harness. The prefix matches
  # every URL, so the gate denies nothing while still registering the routes
  # this spec needs.
  #
  # Opt-in only: unset (the default) leaves the harness exactly as it was.
  # See change: config-override-oauth-redirect-base.
  if [ "${PI_E2E_OAUTH:-}" = "1" ]; then
    node -e '
      const fs = require("node:fs");
      const [out, base] = process.argv.slice(1);
      let cfg = {};
      try { cfg = JSON.parse(fs.readFileSync(out, "utf8")); } catch {}
      cfg.auth = {
        ...(cfg.auth ?? {}),
        secret: "e2e-auth-secret-32-chars-longxxxx",
        providers: { github: { clientId: "e2e-client-id", clientSecret: "e2e-client-secret" } },
        bypassUrls: ["/"],
        redirectBaseUrl: base,
      };
      fs.writeFileSync(out, JSON.stringify(cfg) + "\n");
    ' "${PI_DIR}/dashboard/config.json" "${PI_E2E_OAUTH_BASE:-https://pi-e2e-a.example.com}"
    echo "[test-entrypoint] PI_E2E_OAUTH: seeded github provider + bypassUrls:[/] + redirectBaseUrl=${PI_E2E_OAUTH_BASE:-https://pi-e2e-a.example.com} → config.json"
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

  # --- ctx.ui.notify driver: the only L3 lever on the notify path ---
  # The faux model can emit tool calls but cannot call `ctx.ui.notify`, so the
  # `notify-probe` scenario calls this fixture's `e2e_notify` tool instead.
  # See change: split-notify-from-prompt-request.
  NOTIFY_EXT_DIR="${PI_DIR}/agent/extensions/e2e-notify"
  if [ -f "${FAUX_SRC}/e2e-notify.ext.ts" ] && [ ! -f "${NOTIFY_EXT_DIR}/index.ts" ]; then
    mkdir -p "${NOTIFY_EXT_DIR}"
    cp "${FAUX_SRC}/e2e-notify.ext.ts" "${NOTIFY_EXT_DIR}/index.ts"
    ln -sfn /app/node_modules "${NOTIFY_EXT_DIR}/node_modules"
    echo "[test-entrypoint] PI_E2E_SEED: staged notify driver → ${NOTIFY_EXT_DIR}"
  fi

  # --- Custom-entry driver (change: render-inline-reasoning-and-custom-entries):
  # the faux model can only emit tool calls, so `pi.sendMessage` /
  # `pi.appendEntry` need a fixture tool — the `custom-entries` scenario calls
  # `e2e_custom_message` / `e2e_custom_entry` to drive the REAL bridge forward
  # + replay paths.
  CUSTOM_EXT_DIR="${PI_DIR}/agent/extensions/e2e-custom"
  if [ -f "${FAUX_SRC}/e2e-custom.ext.ts" ]; then
    # Copy index.ts only when absent; repair the node_modules link whenever
    # absent — a prior partial seed (index.ts without the link) must still
    # resolve its imports (CodeRabbit: idempotent seeding).
    if [ ! -f "${CUSTOM_EXT_DIR}/index.ts" ]; then
      mkdir -p "${CUSTOM_EXT_DIR}"
      cp "${FAUX_SRC}/e2e-custom.ext.ts" "${CUSTOM_EXT_DIR}/index.ts"
      echo "[test-entrypoint] PI_E2E_SEED: staged custom-entry driver → ${CUSTOM_EXT_DIR}"
    fi
    [ -e "${CUSTOM_EXT_DIR}/node_modules" ] || ln -sfn /app/node_modules "${CUSTOM_EXT_DIR}/node_modules"
  fi

  # --- Synthetic Agent-tick producer (throttle L3, change: reduce-bridge-tick-
  # bandwidth) --- Registers an `Agent` tool that streams tool_execution_update
  # frames at a deterministic cadence (via a `[[ticks:N@Mms]]` sentinel) for the
  # cadence rows (F1/P1/P2/P3/F5). It SHADOWS the real subagents Agent tool
  # (first-registration-wins), so it is staged ONLY under PI_SYNTH_AGENT_TICKS=1
  # and `register_subagents` is SKIPPED below — the two never coexist. The
  # nested-faux subagent cannot be scripted in the harness (see change
  # measurement.md, Bug 2), so a synthetic same-shape producer is the L3
  # substrate.
  SYNTH_EXT_DIR="${PI_DIR}/agent/extensions/faux-agent-ticks"
  if [ "${PI_SYNTH_AGENT_TICKS:-}" = "1" ] && [ -f "${FAUX_SRC}/faux-agent-ticks.ext.ts" ] && [ ! -f "${SYNTH_EXT_DIR}/index.ts" ]; then
    mkdir -p "${SYNTH_EXT_DIR}"
    cp "${FAUX_SRC}/faux-agent-ticks.ext.ts" "${SYNTH_EXT_DIR}/index.ts"
    ln -sfn /app/node_modules "${SYNTH_EXT_DIR}/node_modules"
    echo "[test-entrypoint] PI_SYNTH_AGENT_TICKS: staged synthetic Agent-tick producer → ${SYNTH_EXT_DIR}"
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
  # The stub MUST be loadable. Registering it in `packages[]` makes pi load it as
  # an extension, and an entry-less manifest is FATAL at startup under pi 0.83:
  #   Failed to load extension "/fixtures/local-pkg/image-fit-extension":
  #     Cannot find module '/fixtures/local-pkg/image-fit-extension'
  # That killed every spawned session, so every spawn-based E2E spec failed far
  # from its real assertion. A no-op `pi.extensions` entry keeps the fixture's
  # ACTUAL point intact (dir basename decorated differently from package.json
  # #name, so the pure-string sourcesMatch rule cannot match) while letting pi
  # start. See change: restore-ask-user-tool-state-on-reconnect.
  LOCAL_PKG_DIR="/fixtures/local-pkg/image-fit-extension"
  if [ ! -f "${LOCAL_PKG_DIR}/package.json" ]; then
    mkdir -p "${LOCAL_PKG_DIR}"
    printf '%s\n' '{ "name": "@blackbelt-technology/pi-image-fit-extension", "version": "0.0.1", "type": "module", "pi": { "extensions": ["index.js"] } }' \
      > "${LOCAL_PKG_DIR}/package.json"
  fi
  # Entry is deliberately inert: this fixture exists to be NAME-MATCHED on the
  # extensions card, never to do work.
  if [ ! -f "${LOCAL_PKG_DIR}/index.js" ]; then
    printf '%s\n' 'export default function localImageFitStub() {}' \
      > "${LOCAL_PKG_DIR}/index.js"
  fi
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

  # --- Plugin-page fixture states (change: plugin-settings-pages) ---
  # Two user-installed plugins in ~/.pi/dashboard/plugins/ whose STATUS is the
  # point, not their behaviour. The plugin settings page must render host chrome
  # + the right banner for each, and the nav rail must keep both (membership
  # keys on `enabled`, not `loaded` — design D4).
  #   e2e-broken     server entry throws on load     -> status.error
  #   e2e-needs-req  requires an absent pi extension -> missingRequirements
  # Both claim `settings-section` so they earn a page and a nav child.
  # Idempotent: each is written only when its manifest is absent.
  PLUGINS_DIR="${PI_DIR}/dashboard/plugins"

  BROKEN_DIR="${PLUGINS_DIR}/e2e-broken"
  mkdir -p "${BROKEN_DIR}"
  if [ ! -f "${BROKEN_DIR}/package.json" ]; then
    printf '%s\n' '{ "name": "e2e-broken-plugin", "version": "0.0.1", "type": "module" }' \
      > "${BROKEN_DIR}/package.json"
  fi
  if [ ! -f "${BROKEN_DIR}/dashboard-plugin.json" ]; then
    cat > "${BROKEN_DIR}/dashboard-plugin.json" <<'JSON'
{
  "id": "e2e-broken",
  "displayName": "E2E Broken",
  "server": "./server.js",
  "claims": [{ "slot": "settings-section", "component": "Settings" }]
}
JSON
  fi
  if [ ! -f "${BROKEN_DIR}/server.js" ]; then
    printf '%s\n' 'throw new Error("Bridge path conflict: e2e-broken cannot load");' \
      > "${BROKEN_DIR}/server.js"
  fi
  echo "[test-entrypoint] PI_E2E_SEED: errored plugin fixture ready → ${BROKEN_DIR}"

  NEEDS_REQ_DIR="${PLUGINS_DIR}/e2e-needs-req"
  mkdir -p "${NEEDS_REQ_DIR}"
  if [ ! -f "${NEEDS_REQ_DIR}/package.json" ]; then
    printf '%s\n' '{ "name": "e2e-needs-req-plugin", "version": "0.0.1", "type": "module" }' \
      > "${NEEDS_REQ_DIR}/package.json"
  fi
  if [ ! -f "${NEEDS_REQ_DIR}/dashboard-plugin.json" ]; then
    cat > "${NEEDS_REQ_DIR}/dashboard-plugin.json" <<'JSON'
{
  "id": "e2e-needs-req",
  "displayName": "E2E Needs Requirement",
  "requires": { "piExtensions": ["pi-e2e-absent-extension"] },
  "claims": [{ "slot": "settings-section", "component": "Settings" }]
}
JSON
  fi
  echo "[test-entrypoint] PI_E2E_SEED: unmet-requirement plugin fixture ready → ${NEEDS_REQ_DIR}"

  # A plugin that DEPENDS on another, so disabling the dependency cascades and
  # the toggle raises the cascade-confirm dialog. No monorepo plugin declares
  # dependsOn, so without this fixture the cascade path is unreachable at L3.
  DEPENDENT_DIR="${PLUGINS_DIR}/e2e-dependent"
  mkdir -p "${DEPENDENT_DIR}"
  if [ ! -f "${DEPENDENT_DIR}/package.json" ]; then
    printf '%s\n' '{ "name": "e2e-dependent-plugin", "version": "0.0.1", "type": "module" }' \
      > "${DEPENDENT_DIR}/package.json"
  fi
  if [ ! -f "${DEPENDENT_DIR}/dashboard-plugin.json" ]; then
    cat > "${DEPENDENT_DIR}/dashboard-plugin.json" <<'JSON'
{
  "id": "e2e-dependent",
  "displayName": "E2E Dependent",
  "dependsOn": ["e2e-needs-req"],
  "claims": [{ "slot": "settings-section", "component": "Settings" }]
}
JSON
  fi
  echo "[test-entrypoint] PI_E2E_SEED: dependency-cascade plugin fixture ready → ${DEPENDENT_DIR}"

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
    SA_GLOBAL="/usr/local/lib/node_modules/@blackbelt-technology/pi-dashboard-subagents"
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
      # Tool-name precedence is FIRST-registration-wins across packages[]
      # (pi `ExtensionRunner.getAllRegisteredTools`). pi-flows registers its own
      # `ask_user` ({question,type}) at LOAD time, so if it precedes the
      # dashboard bridge every faux `ask_user` scenario fails schema validation
      # and no interactive widget ever mounts. Pin the bridge FIRST so the
      # dashboard's `ask_user` ({method,title}) is the one the agent calls.
      # See change: split-notify-from-prompt-request.
      node -e '
        const fs = require("node:fs");
        const path = require("node:path");
        const [p, dir, bridge] = process.argv.slice(1);
        let s = {};
        try { s = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
        if (!Array.isArray(s.packages)) s.packages = [];
        if (!s.packages.includes(dir)) s.packages.push(dir);
        s.packages = [bridge, ...s.packages.filter((e) => e !== bridge)];
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, JSON.stringify(s, null, 2) + "\n");
      ' "${SETTINGS}" "${PF_GLOBAL}" "/app/packages/extension"
    }

    # The `tool_execution_update` producer. Registered unconditionally (not under
    # a PI_TEST_PEERS arm) because the collapse scenarios need it in every peer
    # shape, and it registers no `ask_user`, so it cannot disturb the
    # first-registration-wins tool precedence `register_flows` guards.
    # See change: collapse-superseded-tool-execution-updates.
    register_subagents() {
      ln -sfn "${SA_GLOBAL}" "${NM}/@blackbelt-technology/pi-dashboard-subagents"
      node -e '
        const fs = require("node:fs");
        const path = require("node:path");
        const [p, dir, bridge] = process.argv.slice(1);
        let s = {};
        try { s = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
        if (!Array.isArray(s.packages)) s.packages = [];
        if (!s.packages.includes(dir)) s.packages.push(dir);
        s.packages = [bridge, ...s.packages.filter((e) => e !== bridge)];
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, JSON.stringify(s, null, 2) + "\n");
      ' "${SETTINGS}" "${SA_GLOBAL}" "/app/packages/extension" \
        && echo "[test-entrypoint] registered pi-dashboard-subagents (tool_execution_update producer)"
    }
    # Skip the real subagents producer on the synthetic-tick arm: the synthetic
    # `Agent` tool owns the tool name there (first-registration-wins), and the
    # two must never coexist. See change: reduce-bridge-tick-bandwidth.
    if [ "${PI_SYNTH_AGENT_TICKS:-}" = "1" ]; then
      echo "[test-entrypoint] PI_SYNTH_AGENT_TICKS=1: skipping subagents producer (synthetic Agent tool owns the tool name)"
    else
      register_subagents
    fi

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
# NO_SUPERVISE: the base entrypoint now supervises the daemon itself, which
# would block before this script's smoke checks ever ran. We do our own
# supervising in step 4, with the same shared helper.
PI_ENTRYPOINT_NO_SUPERVISE=1 /usr/local/bin/entrypoint.sh "$@" \
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

# Single-dashboard invariant (fix-bridge-autostart-port-resolution, test-plan
# #X6): exactly ONE dashboard may answer inside the container. The harness
# runs on ${PORT}; a second listener on the production default 8000 means a
# session misresolved its auto-start ports and launched a competitor — the
# original split-brain incident (two dashboards answering while server.pid
# named the 8000 process).
if [ "${PORT}" != "8000" ]; then
  if curl --connect-timeout 1 --max-time 2 -fsS "http://localhost:8000/api/health" >/dev/null 2>&1; then
    smoke_fail "a second dashboard answers on default port 8000 (split-brain: auto-start launched a competitor)"
  fi
  echo "[test-entrypoint] single-dashboard invariant OK (nothing on :8000)"
fi

echo "[test-entrypoint] SMOKE PASSED → dashboard ready on http://localhost:${PORT}"

# --- 3b. Independent (NOT dashboard-spawned) pi session --------------------
# Every session the dashboard spawns is SIGTERMed by `shutdownHeadlessProcesses()`
# on shutdown — "GONE and can never reattach" (server.ts). So a dashboard-spawned
# session can never demonstrate reconnect-after-restart: there is nothing left to
# re-register. This launches a pi that the dashboard did NOT spawn, exactly like a
# TUI session a user started themselves. It is absent from `headlessPidRegistry`,
# so a server restart leaves it running and its bridge reconnects — the real-world
# path `restore-ask-user-tool-state-on-reconnect` repairs.
#
# `--mode rpc` speaks JSON-RPC over stdio; with stdin closed it reads EOF and
# exits immediately, so `tail -f /dev/null` holds the pipe open. `setsid` detaches
# it from PID 1's process group so a restart cannot cascade into it.
# PI_DIR is only assigned inside the PI_E2E_SEED block above, but this line is
# evaluated unconditionally — so under `set -u` a plain (unseeded) test-up.sh
# died here immediately after its own smoke reported "dashboard ready",
# exiting 1 and failing every e2e health check. Default it the same way the
# seed block does.
INDEPENDENT_LOG="${PI_DIR:-${HOME:-/home/pi}/.pi}/dashboard/independent-session.log"
# DEFAULT OFF. Enabled explicitly by tests/e2e/global-setup.ts (and by hand for
# manual QA) because it adds a session card every spec would otherwise see.
# The session registers as `source:"tui"`, survives `/api/restart`, and
# re-registers over the bridge — which requires the `--pi-port` propagation fix
# in packages/server/src/spawn-process/restart-helper.ts, without which the
# restarted gateway falls back to 9999 and no live bridge can reconnect.
# Consumed by the reconnect scenario in tests/e2e/faux-ask.spec.ts (#F6).
if [ "${PI_E2E_INDEPENDENT_SESSION:-0}" = "1" ] && [ "${PI_E2E_SEED:-}" = "1" ]; then
  # DEDICATED cwd, never the shared /fixtures/sample-git. A session's cwd forms
  # a sidebar folder group, so parking this one in the fixture every other spec
  # asserts on perturbs them (directory-home.spec.ts fails outright). Its own
  # directory keeps the extra card in its own group; #F6 resolves the session by
  # `source:"tui"`, so the cwd is irrelevant to it.
  INDEPENDENT_CWD="${INDEPENDENT_SESSION_CWD:-/fixtures/independent-session}"
  mkdir -p "${INDEPENDENT_CWD}"
  if [ -d "${INDEPENDENT_CWD}" ]; then
    # Point the bridge at the RUNNING gateway. `config.json` carries no `piPort`,
    # so the bridge would default to 9999, find nothing, and try to AUTOSTART a
    # second dashboard — which fails with "readiness timeout" and leaves the
    # session connected to nothing.
    INDEPENDENT_URL="ws://localhost:${PI_GATEWAY_PORT:-18999}"
    setsid env PI_DASHBOARD_URL="${INDEPENDENT_URL}" \
      sh -c "cd '${INDEPENDENT_CWD}' && tail -f /dev/null | pi --mode rpc" \
      >> "${INDEPENDENT_LOG}" 2>&1 &
    echo "[test-entrypoint] PI_E2E_SEED: independent pi session launched in ${INDEPENDENT_CWD} → ${INDEPENDENT_URL} (log: ${INDEPENDENT_LOG})"
  else
    echo "[test-entrypoint] WARN: independent-session cwd ${INDEPENDENT_CWD} missing; skipped"
  fi
fi

# --- 4. Keep PID 1 alive for the daemon's lifetime -------------------------
# Same helper the base entrypoint uses, so the harness and the deployment
# cannot drift apart again — this loop existing ONLY here is what let the
# deployment ship without supervision while every E2E run stayed green.
# shellcheck source=docker/supervise-daemon.sh
. /usr/local/bin/supervise-daemon.sh
supervise_daemon "${PIDFILE}" "dashboard daemon" || smoke_fail "server.pid not found at ${PIDFILE}"
