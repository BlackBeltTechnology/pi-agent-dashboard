#!/bin/bash
# Execute browser scenarios from JSON and capture screenshots
# Usage: ./sandbox/scripts/run-scenarios.sh <scenario.json> [output-dir]
# 
# scenario.json format — array of steps:
# [
#   {"open": "http://localhost:8000"},
#   {"wait": 2000},
#   {"set viewport": "1280 3000"},
#   {"screenshot": "desktop-overview"},
#   {"click": ".session-card"},
#   {"screenshot": "selected-card"},
#   {"set viewport": "375 3000"},
#   {"screenshot": "mobile-overview"}
# ]
#
# Supported step keys: open, wait, screenshot, click, scroll, press, set viewport

set -e

SCENARIO="${1:?Usage: $0 <scenario.json> [output-dir]}"
OUT="${2:-screenshots}"
mkdir -p "$OUT"

if [ ! -f "$SCENARIO" ]; then
  echo "ERROR: $SCENARIO not found"
  exit 1
fi

echo "[scenario] Loading $SCENARIO → $OUT/"

# Parse JSON and execute each step
python3 -c "
import json, subprocess, sys, os, time

scenario = json.load(open('$SCENARIO'))
out_dir = '$OUT'

def run(cmd):
    print(f'  → {cmd}')
    result = subprocess.run(['agent-browser'] + cmd.split(), capture_output=True, text=True)
    if result.returncode != 0 and 'screenshot' not in cmd:
        print(f'  ⚠ {result.stderr.strip()[:200]}')

for i, step in enumerate(scenario):
    print(f'[{i+1}/{len(scenario)}]', end=' ')
    
    if 'open' in step:
        run(f'open {step[\"open\"]}')
    elif 'wait' in step:
        time.sleep(step['wait'] / 1000)
        print(f'wait {step[\"wait\"]}ms')
    elif 'screenshot' in step:
        name = step['screenshot']
        run('screenshot')
        # Find latest screenshot and copy it
        tmp = sorted([f for f in os.listdir(os.path.expanduser('~/.agent-browser/tmp/screenshots/')) if f.endswith('.png')])
        if tmp:
            latest = os.path.expanduser(f'~/.agent-browser/tmp/screenshots/{tmp[-1]}')
            dest = f'{out_dir}/{name}.png'
            subprocess.run(['cp', latest, dest])
            print(f'  → {dest}')
    elif 'click' in step:
        run(f'click {step[\"click\"]}')
    elif 'scroll' in step:
        run(f'scroll {step[\"scroll\"]}')
    elif 'press' in step:
        run(f'press {step[\"press\"]}')
    elif 'set viewport' in step:
        run(f'set viewport {step[\"set viewport\"]}')
    elif 'close' in step:
        run('close')
    else:
        print(f'skip unknown: {list(step.keys())}')
    
    time.sleep(0.3)

print(f'[scenario] Done — {len(scenario)} steps, screenshots in {out_dir}/')
" 2>&1

echo "[scenario] Complete"
