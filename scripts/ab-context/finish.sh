#!/usr/bin/env bash
cd "$(dirname "$0")"
while pgrep -f 'bash ./run.sh' >/dev/null; do sleep 30; done
node extract.mjs runs/*.jsonl > rows.jsonl 2>/dev/null
node analyze.mjs rows.jsonl > report.txt 2>&1
echo "FINISHED $(date)" >> report.txt
