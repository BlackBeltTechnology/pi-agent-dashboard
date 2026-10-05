#!/usr/bin/env bash
# yt-srt.sh — download YouTube subtitles (SRT) for a channel, playlist or video(s)
# without downloading media. Idempotent: an archive file skips already-fetched IDs.
#
# Usage: yt-srt.sh [-o OUT_DIR] [-s SINCE] [-l LANGS] [-n MAX] URL [URL...]
#   -o OUT_DIR  output dir            (default ~/Documents/Media/youtube/<channel-handle|misc>)
#   -s SINCE    upload-date lower bound, yt-dlp syntax: YYYYMMDD | now-6months | today-30days
#   -l LANGS    subtitle langs        (default "en.*,en"; manual subs preferred, auto-subs fallback)
#   -n MAX      max playlist items to scan (default 200)
# Output: <OUT_DIR>/<YYYYMMDD>_<id>_<title>.<lang>.srt + index.tsv (id, date, duration, url, title)
set -euo pipefail

OUT=""; SINCE=""; LANGS="en.*,en"; MAX=200
while getopts "o:s:l:n:h" opt; do
  case $opt in
    o) OUT=$OPTARG ;; s) SINCE=$OPTARG ;; l) LANGS=$OPTARG ;; n) MAX=$OPTARG ;;
    h|*) sed -n '2,11p' "$0"; exit 0 ;;
  esac
done
shift $((OPTIND - 1))
[ $# -ge 1 ] || { sed -n '2,11p' "$0"; exit 2; }

export PATH="$HOME/.local/bin:$PATH"
command -v yt-dlp >/dev/null || { echo "yt-dlp missing: pipx install yt-dlp (or brew install yt-dlp)" >&2; exit 3; }

if [ -z "$OUT" ]; then
  handle=$(printf '%s' "$1" | sed -nE 's#.*/@([^/]+).*#\1#p')
  OUT="$HOME/Documents/Media/youtube/${handle:-misc}"
fi
mkdir -p "$OUT"

args=(
  --skip-download --ignore-errors --no-overwrites
  --write-subs --write-auto-subs --sub-langs "$LANGS" --convert-subs srt
  --download-archive "$OUT/.archive.txt" --force-write-archive
  --playlist-end "$MAX"
  --sleep-subtitles 2 --sleep-requests 1
  -o "$OUT/%(upload_date)s_%(id)s_%(title).80B.%(ext)s"
  --print-to-file "%(id)s	%(upload_date)s	%(duration)s	%(webpage_url)s	%(title)s" "$OUT/index.tsv"
)
# Channel uploads are newest-first: stop at the first video older than SINCE.
[ -n "$SINCE" ] && args+=(--dateafter "$SINCE" --break-on-reject)

# Bare channel URL → its uploads tab.
urls=()
for u in "$@"; do
  if [[ $u =~ youtube\.com/@[^/]+/?$ ]]; then urls+=("${u%/}/videos"); else urls+=("$u"); fi
done

yt-dlp "${args[@]}" "${urls[@]}" || true   # break-on-reject exits non-zero by design
sort -u -o "$OUT/index.tsv" "$OUT/index.tsv" 2>/dev/null || true

# One track per video: prefer en-orig (original ASR) over en (re-timed copy) over others.
for f in "$OUT"/*.en-orig.srt; do
  [ -e "$f" ] || continue
  base="${f%.en-orig.srt}"; rm -f "$base.en.srt" "$base.en.txt"
done

# Retry-safety: drop archive entries whose subtitles failed (e.g. HTTP 429) so a rerun refetches them.
if [ -f "$OUT/.archive.txt" ]; then
  while read -r ext id; do
    ls "$OUT"/*_"$id"_*.srt >/dev/null 2>&1 && echo "$ext $id"
  done < "$OUT/.archive.txt" > "$OUT/.archive.tmp" && mv "$OUT/.archive.tmp" "$OUT/.archive.txt"
fi
missing=$(cut -f1 "$OUT/index.tsv" | while read -r id; do ls "$OUT"/*_"$id"_*.srt >/dev/null 2>&1 || echo "$id"; done | wc -l | tr -d ' ')
[ "$missing" = 0 ] || echo "WARN: $missing video(s) without subtitles (rate-limited?) — rerun later to retry" >&2

# Compact <base>.txt sidecar: "[mm:ss] line", rolling auto-sub duplicates removed.
for srt in "$OUT"/*.srt; do
  [ -e "$srt" ] || continue
  txt="${srt%.srt}.txt"; [ -s "$txt" ] && continue
  awk '
    /-->/ { split($1, t, /[:,]/); ts = sprintf("%02d:%02d", t[1]*60 + t[2], t[3]); next }
    /^[0-9]+$/ || /^[[:space:]]*$/ { next }
    { gsub(/<[^>]*>/, ""); sub(/[[:space:]]+$/, ""); if ($0 != "" && $0 != last) { print "[" ts "] " $0; last = $0 } }
  ' "$srt" > "$txt"
done
echo "SRT files: $(ls "$OUT"/*.srt 2>/dev/null | wc -l | tr -d ' ')  →  $OUT"
