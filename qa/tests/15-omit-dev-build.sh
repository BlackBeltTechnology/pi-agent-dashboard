#!/usr/bin/env bash
# Test: a fresh checkout builds the client under --omit=dev (issue #357).
#
# test-plan #X1. Two independent regressions are covered:
#
#   a) BUILD  — pi runs `npm install --omit=dev`, which drops devDependencies.
#      The @blackbelt-technology/pi-dashboard-web `prepare` script runs a Vite
#      build, so its direct build-time requirements must be runtime deps or the
#      build dies with `Cannot find module 'vite/package.json'`.
#   b) ENGINES — root `.npmrc` sets `engine-strict=true`; with the old
#      `<26` cap, npm aborted on Node 26 with EBADENGINE before anything ran.
#
# Three arms, because npm and pnpm resolve BOTH dependency graphs and
# `engine-strict` through different config cascades. A pass on one arm and a
# fail on another is the signal that the two engines have diverged:
#
#   1. npm  + engine-strict OFF  -> isolates (a), the BUILD failure.
#   2. npm  + engine-strict ON   -> the ONLY full-fidelity reproduction of the
#                                   real #357 codepath. Requires Node >= 26.
#   3. pnpm --prod --frozen-lockfile -> reproducibility against the locked tree.
#
# Not covered here: the end-to-end `pi install git:...` reproduction — that is
# the manual M1 check.
set -euo pipefail

echo "=== Test: --omit=dev client build (issue #357) ==="

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Default to the checkout this script lives in, at its CURRENT commit — so the
# test exercises the code under test. Defaulting to remote `develop` would
# silently validate a different tree than the one being changed (and always pass
# on a branch that has not landed yet). Overrides stay for remote reproduction.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_URL="${OMIT_DEV_REPO_URL:-$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)}"
REPO_REF="${OMIT_DEV_REPO_REF:-$(git -C "$SCRIPT_DIR" rev-parse HEAD)}"
echo "Source under test: $REPO_URL @ $REPO_REF"

# Resolve pnpm's omit-dev flag ONCE, up front. Newer pnpm majors prefer
# `--omit=dev`; a silently-accepted no-op flag would make arm 3 vacuous (it
# would install devDeps and "pass" without proving anything).
if pnpm install --help 2>&1 | grep -qE '(^|\s)-P,\s*--prod'; then
  PNPM_OMIT_FLAG="--prod"
elif pnpm install --help 2>&1 | grep -q -- '--omit'; then
  PNPM_OMIT_FLAG="--omit=dev"
else
  echo "FAIL: cannot determine pnpm's omit-dev flag (pnpm $(pnpm --version))"
  echo "      Arm 3 would install devDependencies and pass vacuously."
  exit 1
fi
echo "pnpm omit-dev flag: $PNPM_OMIT_FLAG (pnpm $(pnpm --version))"

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
echo "Runner Node: $(node --version)"

WORKDIR=$(mktemp -d)
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

# A pristine clone per arm: the build blocker only reproduces with no
# node_modules and no packages/client/dist present.
fresh_checkout() {
  local dest="$1"
  # Clone then checkout, rather than `--depth 1 --branch`: REPO_REF defaults to a
  # bare commit sha, which `--branch` does not accept.
  git clone --no-checkout "$REPO_URL" "$dest" >/dev/null 2>&1 || return 1
  git -C "$dest" checkout --quiet "$REPO_REF" || return 1
  if [ -e "$dest/node_modules" ] || [ -e "$dest/packages/client/dist" ]; then
    echo "FAIL: fresh checkout is not pristine (node_modules or client/dist present)"
    return 1
  fi
}

assert_client_built() {
  local dir="$1" arm="$2"
  if [ ! -f "$dir/packages/client/dist/index.html" ]; then
    echo "FAIL [$arm]: packages/client/dist/index.html missing after install."
    echo "             The client \`prepare\` Vite build did not run or failed."
    return 1
  fi
  echo "PASS [$arm]: packages/client/dist/index.html built"
}

FAILED=0

# --- Arm 1: npm, engine-strict bypassed -------------------------------------
# `--engine-strict=false` here is a TEST-ONLY bypass that scopes this arm to the
# BUILD failure. It is NOT a recommended install workaround — telling users to
# pass it would mask the engines regression arm 2 exists to catch.
echo ""
echo "--- Arm 1: npm install --omit=dev --engine-strict=false ---"
ARM1="$WORKDIR/arm1"
if fresh_checkout "$ARM1" && (cd "$ARM1" && npm install --omit=dev --engine-strict=false); then
  assert_client_built "$ARM1" "arm1" || FAILED=1
else
  echo "FAIL [arm1]: npm install --omit=dev exited non-zero"
  FAILED=1
fi

# --- Arm 2: npm, engine-strict ON (full-fidelity #357 repro) -----------------
echo ""
echo "--- Arm 2: npm install --omit=dev, engine-strict=true (Node >= 26) ---"
# Exactly 26, not `>= 26`: below 26 the engine-strict assertion passes trivially
# (vacuous), and above 26 the arm would fail for the RIGHT reason (27+ is outside
# the engines cap by design) while looking like a #357 regression.
if [ "$NODE_MAJOR" -ne 26 ]; then
  echo "SKIP [arm2]: runner Node is v$NODE_MAJOR; arm 2 requires Node 26 exactly."
  echo "             Below 26 the engine-strict assertion passes trivially and"
  echo "             proves nothing about the #357 EBADENGINE half; above 26 the"
  echo "             engines cap refuses by design, which is not a regression."
  echo "             Re-run under \`nvm use 26\` for real coverage."
else
  ARM2="$WORKDIR/arm2"
  # No --engine-strict override: the repo's own .npmrc engine-strict=true is in
  # force, exactly as it is when pi runs `npm install --omit=dev` on a clone.
  if fresh_checkout "$ARM2" && (cd "$ARM2" && npm install --omit=dev); then
    assert_client_built "$ARM2" "arm2" || FAILED=1
  else
    echo "FAIL [arm2]: npm install --omit=dev exited non-zero under engine-strict."
    echo "             If the log shows EBADENGINE, package.json#engines.node"
    echo "             refuses this Node — that is the #357 regression."
    FAILED=1
  fi
fi

# --- Arm 3: pnpm, locked tree ------------------------------------------------
echo ""
echo "--- Arm 3: pnpm install $PNPM_OMIT_FLAG --frozen-lockfile ---"
ARM3="$WORKDIR/arm3"
if fresh_checkout "$ARM3" && (cd "$ARM3" && pnpm install "$PNPM_OMIT_FLAG" --frozen-lockfile); then
  assert_client_built "$ARM3" "arm3" || FAILED=1
else
  echo "FAIL [arm3]: pnpm install $PNPM_OMIT_FLAG --frozen-lockfile exited non-zero"
  FAILED=1
fi

echo ""
if [ "$FAILED" -ne 0 ]; then
  echo "FAIL: --omit=dev client build regression (issue #357)."
  echo "      A pass on one arm and a fail on another means npm and pnpm"
  echo "      resolution have diverged — compare the arms above."
  exit 1
fi

echo "PASS: client builds under --omit=dev on every arm"
