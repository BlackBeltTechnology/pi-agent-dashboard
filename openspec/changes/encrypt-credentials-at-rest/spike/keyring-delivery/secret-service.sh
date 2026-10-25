#!/bin/sh
# Runs INSIDE node:24-bookworm-slim (see run.sh `secretservice` section; /w2 MUST be an exec tmpfs —
# a default noexec tmpfs makes dlopen fail with "failed to map segment", see the `noexec` section).
# Case A: unlocked gnome-keyring on a private session bus -> expect round-trip.
# Case B: session bus but keyring daemon never unlocked (locked/absent collection, no prompter) -> hang or typed error?
set -u
apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq --no-install-recommends dbus dbus-x11 gnome-keyring libsecret-1-0 >/dev/null 2>&1 \
  || { echo "apt install failed"; exit 0; }
cd /w2 && npm init -y >/dev/null && npm i --no-audit --no-fund @napi-rs/keyring@2.1.2 >/dev/null 2>&1 && cp /w/probe.cjs .
echo -n "  A unlocked gnome-keyring: "
dbus-run-session -- sh -c 'printf spike | gnome-keyring-daemon --unlock --components=secrets >/dev/null 2>&1; timeout 40 node probe.cjs' 2>&1 | tail -1
echo -n "  B bus up, no keyring daemon: "
dbus-run-session -- sh -c 'timeout 40 node probe.cjs; echo "exit=$?"' 2>&1 | tail -2 | tr '\n' ' '; echo
echo -n "  C daemon started but NOT unlocked: "
dbus-run-session -- sh -c 'gnome-keyring-daemon --start --components=secrets >/dev/null 2>&1; timeout 40 node probe.cjs; echo "exit=$?"' 2>&1 | tail -2 | tr '\n' ' '; echo
