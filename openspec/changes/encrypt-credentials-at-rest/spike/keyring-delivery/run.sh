#!/usr/bin/env bash
# Delivery spike for @napi-rs/keyring (encrypt-credentials-at-rest, tasks 1.2-1.4, 1.7).
# Host: Apple-silicon macOS with nvm Node builds, Rosetta, docker (optional).
# Works only in a throwaway dir ($WORK); touches the login keychain only through
# probe.cjs, which deletes its own pi-dash-keyring-spike-<pid> entries.
#
#   bash run.sh [section...]     sections: matrix electron select rosetta sign skew missing docker secretservice noexec
#
# Output: one line per probe; FINDINGS.md records the interpreted results.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../../../.." && pwd)"
VER="${KEYRING_VERSION:-2.1.2}"
NODE_X64_VER="${NODE_X64_VER:-v24.15.0}"
WORK="${WORK:-/tmp/keyring-delivery-spike}"
NVM="${NVM_DIR:-$HOME/.nvm}/versions/node"
ELECTRON_BIN="$REPO/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
[ -x "$ELECTRON_BIN" ] || ELECTRON_BIN="$(cd "$REPO/../.." 2>/dev/null && pwd)/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
SECTIONS="${*:-matrix electron select rosetta sign skew missing docker secretservice noexec}"

mkdir -p "$WORK"
fresh() { # fresh <dir> [npm install args...] → installs @napi-rs/keyring@$VER into $WORK/<dir>
  local d="$WORK/$1"; shift
  rm -rf "$d"; mkdir -p "$d"; cp "$HERE/probe.cjs" "$d/"
  (cd "$d" && npm init -y >/dev/null && npm install --no-audit --no-fund "$@" "@napi-rs/keyring@$VER" >/dev/null 2>"$d/npm.err") \
    || { echo "  npm install failed: $(tail -1 "$d/npm.err")"; return 1; }
}
pkgs() { ls "$WORK/$1/node_modules/@napi-rs" | tr '\n' ' '; }
want() { [[ " $SECTIONS " == *" $1 "* ]]; }

echo "# keyring-delivery spike — @napi-rs/keyring@$VER — $(uname -ms) — $(date -u +%FT%TZ)"

if want matrix; then
  echo "## matrix: Node versions (main thread + worker)"
  fresh base
  for n in "$NVM"/v*; do (cd "$WORK/base" && timeout 40 "$n/bin/node" probe.cjs 2>&1 | tail -1); done
fi

if want electron; then
  echo "## electron: ELECTRON_RUN_AS_NODE fallback (server launcher fallback when bundled Node is missing)"
  [ -d "$WORK/base" ] || fresh base
  if [ -x "$ELECTRON_BIN" ]; then
    (cd "$WORK/base" && ELECTRON_RUN_AS_NODE=1 timeout 40 "$ELECTRON_BIN" probe.cjs 2>&1 | tail -1)
  else echo "  SKIP: no Electron binary at $ELECTRON_BIN"; fi
fi

if want select; then
  echo "## select: which platform package does npm install? (bundle-server cross-build inputs)"
  fresh sel-default && echo "  default:                         $(pkgs sel-default)"
  npm_config_target_arch=x64 fresh sel-target-arch && echo "  npm_config_target_arch=x64:      $(pkgs sel-target-arch)"
  fresh sel-cpu --cpu=x64 && echo "  --cpu=x64:                       $(pkgs sel-cpu)"
  fresh sel-both --cpu=x64 --cpu=arm64 && echo "  --cpu=x64 --cpu=arm64:           $(pkgs sel-both)"
  fresh sel-linux --os=linux --cpu=x64 --libc=glibc && echo "  --os=linux --cpu=x64 --libc=glibc: $(pkgs sel-linux)"
  fresh sel-win --os=win32 --cpu=x64 && echo "  --os=win32 --cpu=x64:            $(pkgs sel-win)"
fi

if want rosetta; then
  echo "## rosetta: x64 Node (Intel-mac leg / --mac-both cross build) on this host"
  if ! arch -x86_64 /usr/bin/true 2>/dev/null; then echo "  SKIP: Rosetta not installed"; else
    X64="$WORK/node-$NODE_X64_VER-darwin-x64"
    [ -x "$X64/bin/node" ] || (cd "$WORK" && curl -fsSL "https://nodejs.org/dist/$NODE_X64_VER/node-$NODE_X64_VER-darwin-x64.tar.gz" | tar xz) \
      || echo "  download of x64 Node failed"
    if [ -x "$X64/bin/node" ]; then
      [ -d "$WORK/base" ] || fresh base
      echo -n "  x64 node + arm64-only install (host-arch bundle shipped to Intel): "
      (cd "$WORK/base" && arch -x86_64 "$X64/bin/node" probe.cjs 2>&1 | tail -1)
      fresh x64 --cpu=x64
      echo -n "  x64 node + --cpu=x64 install:                                  "
      (cd "$WORK/x64" && arch -x86_64 "$X64/bin/node" probe.cjs 2>&1 | tail -1)
      rm -rf "$WORK/x64-wrapped"; mkdir -p "$WORK/x64-wrapped"; cp "$HERE/probe.cjs" "$WORK/x64-wrapped/"
      (cd "$WORK/x64-wrapped" && arch -x86_64 "$X64/bin/node" "$X64/lib/node_modules/npm/bin/npm-cli.js" init -y >/dev/null \
        && arch -x86_64 "$X64/bin/node" "$X64/lib/node_modules/npm/bin/npm-cli.js" install --no-audit --no-fund "@napi-rs/keyring@$VER" >/dev/null 2>&1)
      echo "  install run under 'arch -x86_64' x64 npm (build-installer.sh --mac-both): $(pkgs x64-wrapped)"
    fi
  fi
fi

if want sign; then
  echo "## sign: hardened-runtime bundled Node vs third-party-team .node (library validation)"
  [ -d "$WORK/base" ] || fresh base
  SRC_NODE="$(command -v node)"
  echo "  upstream node: $(codesign -dv "$SRC_NODE" 2>&1 | grep -E '^TeamIdentifier' ) DLV=$(codesign -d --entitlements - "$SRC_NODE" 2>&1 | grep -c disable-library-validation)"
  echo "  binding:       $(codesign -dv "$WORK/base/node_modules/@napi-rs/keyring-darwin-$(uname -m | sed s/x86_64/x64/)"/*.node 2>&1 | grep -E '^TeamIdentifier')"
  ENT_FULL="$REPO/packages/electron/entitlements.plist"
  ENT_NODLV="$WORK/entitlements-no-dlv.plist"
  /usr/bin/sed '/disable-library-validation/,+1d' "$ENT_FULL" > "$ENT_NODLV"
  for variant in full no-dlv; do
    B="$WORK/node-signed-$variant"; cp "$SRC_NODE" "$B"
    ent="$ENT_FULL"; [ "$variant" = no-dlv ] && ent="$ENT_NODLV"
    codesign --force --sign - --options runtime --entitlements "$ent" "$B" >/dev/null 2>&1
    echo -n "  ad-hoc + runtime + entitlements=$variant: "
    (cd "$WORK/base" && timeout 40 "$B" probe.cjs 2>&1 | tail -1)
  done
fi

if want skew; then
  echo "## skew: main package and platform package at different versions"
  T="$(uname -m | sed s/x86_64/x64/)"
  fresh skew
  (cd "$WORK/skew" && npm install --no-audit --no-fund --no-save "@napi-rs/keyring-darwin-$T@2.1.1" >/dev/null 2>&1)
  echo "  installed: main=$(node -p "require('$WORK/skew/node_modules/@napi-rs/keyring/package.json').version") platform=$(node -p "require('$WORK/skew/node_modules/@napi-rs/keyring-darwin-$T/package.json').version")"
  echo -n "  default:                         "; (cd "$WORK/skew" && node probe.cjs 2>&1 | tail -1)
  echo -n "  NAPI_RS_ENFORCE_VERSION_CHECK=1: "; (cd "$WORK/skew" && NAPI_RS_ENFORCE_VERSION_CHECK=1 node probe.cjs 2>&1 | tail -1)
fi

if want missing; then
  echo "## missing: platform package absent (bundle built for another arch / --omit=optional)"
  fresh missing && rm -rf "$WORK/missing/node_modules/@napi-rs/keyring-"*
  (cd "$WORK/missing" && node probe.cjs 2>&1 | tail -1)
  fresh omit --omit=optional && echo "  --omit=optional installs: $(pkgs omit)"
fi

if want docker; then
  echo "## docker: no session D-Bus (image base node:24-bookworm-slim) + alpine"
  if ! docker info >/dev/null 2>&1; then echo "  SKIP: docker not running"; else
    for img in node:24-bookworm-slim node:22-alpine; do
      echo -n "  $img: "
      docker run --rm -v "$HERE/probe.cjs:/w/probe.cjs:ro" -w /w "$img" sh -c \
        "npm init -y >/dev/null; npm i --no-audit --no-fund @napi-rs/keyring@$VER >/dev/null 2>&1; echo -n \"[\$(ls node_modules/@napi-rs | tr '\n' ' ')] \"; timeout 40 node probe.cjs" 2>&1 | tail -1
    done
  fi
fi

if want secretservice; then
  echo "## secretservice: Linux Secret Service (gnome-keyring on a private session bus) in node:24-bookworm-slim"
  if ! docker info >/dev/null 2>&1; then echo "  SKIP: docker not running"; else
    timeout 600 docker run --rm -v "$HERE/probe.cjs:/w/probe.cjs:ro" -v "$HERE/secret-service.sh:/w/ss.sh:ro" \
      --tmpfs /w2:exec node:24-bookworm-slim sh /w/ss.sh 2>&1 | tail -4
  fi
fi

if want noexec; then
  echo "## noexec: binding installed on a noexec mount (hardened /home, /tmp, tmpfs)"
  if ! docker info >/dev/null 2>&1; then echo "  SKIP: docker not running"; else
    echo -n "  "
    docker run --rm -v "$HERE/probe.cjs:/w/probe.cjs:ro" --tmpfs /w2:noexec node:24-bookworm-slim sh -c \
      "cd /w2 && npm init -y >/dev/null && npm i --no-audit --no-fund @napi-rs/keyring@$VER >/dev/null 2>&1 && cp /w/probe.cjs . && node -e \"try{require('@napi-rs/keyring');console.log('loaded')}catch(e){const s=[];const w=x=>{if(!x)return;if(Array.isArray(x))return x.forEach(w);s.push(String(x.message).replace(/\\s+/g,' '));w(x.cause)};w(e.cause);console.log('top=', e.message.slice(0,40), '| root=', (s.find(m=>/map segment|dlopen/.test(m))||'?').slice(-80))}\"" 2>&1 | tail -1
  fi
fi
