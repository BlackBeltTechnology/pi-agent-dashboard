#!/usr/bin/env bash
# Docker-based parity check (task 10.2).
#
#   ./parity/run.sh                      # offline converter parity only
#   SONIOX_API_KEY=... PARITY_SAMPLE=/abs/clip.m4a ./parity/run.sh   # + live e2e
#
# Run from the package dir (packages/video-transcription). The offline tier is
# deterministic and needs no key; the live tier activates only when both
# SONIOX_API_KEY and PARITY_SAMPLE are set.
set -euo pipefail

pkg_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$pkg_dir"

image="pi-video-transcription-parity"
docker build -f parity/Dockerfile -t "$image" .

args=()
mount=()
if [[ -n "${SONIOX_API_KEY:-}" && -n "${PARITY_SAMPLE:-}" ]]; then
  if [[ ! -f "$PARITY_SAMPLE" ]]; then
    echo "PARITY_SAMPLE not found: $PARITY_SAMPLE" >&2
    exit 1
  fi
  base="$(basename "$PARITY_SAMPLE")"
  mount=(-v "$(cd "$(dirname "$PARITY_SAMPLE")" && pwd)/$base:/sample/$base:ro")
  args=(-e "SONIOX_API_KEY=$SONIOX_API_KEY" -e "PARITY_SAMPLE=/sample/$base")
fi

docker run --rm ${mount[@]+"${mount[@]}"} ${args[@]+"${args[@]}"} "$image"
