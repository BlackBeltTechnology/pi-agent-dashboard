#!/usr/bin/env bash
# reattach-head.sh — thin shim around reattach-head.mjs.
#
# The Node implementation is the canonical one (cross-platform: macOS, Linux,
# Windows under PowerShell/cmd/Git Bash, WSL). This shim exists for callers
# that prefer `.sh` ergonomics or that pipe into the script via shebang.
#
# All flags / args / exit codes / stdout are passed through verbatim.
#
# See: .pi/skills/jj-workspace/scripts/reattach-head.mjs
#      .pi/skills/jj-workspace/SKILL.md "Reattaching a detached git HEAD"

set -eu

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$HERE/reattach-head.mjs" "$@"
