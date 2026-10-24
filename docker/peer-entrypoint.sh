#!/usr/bin/env bash
# Peer-overlay entrypoint (compose.test.peer.yml): give the container a dummy
# interface `bridge0` carrying PI_PEER_BRIDGE_ADDR (a macOS-Virtualization-style
# shared bridge address), then hand over to the normal test entrypoint.
#
# The base image ships no `ip`; iproute2 is installed on demand (this overlay is
# opt-in and the container is root with NET_ADMIN). See change: harden-peer-address-identity.
set -euo pipefail

if [ -n "${PI_PEER_BRIDGE_ADDR:-}" ]; then
  if ! command -v ip >/dev/null 2>&1; then
    apt-get update -qq >/dev/null 2>&1 || true
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends iproute2 >/dev/null 2>&1 \
      || echo "[peer-entrypoint] could not install iproute2" >&2
  fi
  ip link add bridge0 type dummy
  ip addr add "${PI_PEER_BRIDGE_ADDR}" dev bridge0
  ip link set bridge0 up
  echo "[peer-entrypoint] bridge0 = ${PI_PEER_BRIDGE_ADDR}"
fi

exec /usr/local/bin/test-entrypoint.sh "$@"
