#!/usr/bin/env bash
# SoundCraft -> EffectCraft -> FilmCraft round trip through pi-craft + pi-craft verify (task 8.1/8.2).
set -euo pipefail
W=$(mktemp -d); cd "$W"; echo "work dir: $W"
# inputs: 5 s plain background, 3 s tone
ffmpeg -v error -y -f lavfi -i testsrc=size=1280x720:rate=30:duration=5 -c:v libx264 -pix_fmt yuv420p plain.mp4
ffmpeg -v error -y -f lavfi -i sine=frequency=440:duration=5 tone.wav
# 1. SoundCraft: gain -6 dB and bounce
pi-craft soundcraft exec run --cmd session.new --cmd "file.import_audio={\"path\":\"$W/tone.wav\"}" --cmd edit.select_all --cmd 'clip.gain={"db":-6}' --bounce mix.wav
pi-craft verify mix.wav --duration 5±0.1 --max-peak -20
# 2. EffectCraft: animated title with alpha
pi-craft effectcraft exec --empty --save-as t.ecproj run \
  comp.new '{"name":"Title","width":1280,"height":720,"frameRate":30,"duration":5}' \
  layer.newText '{"text":"Fade","size":160,"position":[640,360]}' \
  prop.addKey '{"layer":"Fade","path":"transform/opacity","time":2,"value":0}' \
  prop.addKey '{"layer":"Fade","path":"transform/opacity","time":3,"value":100}'
pi-craft effectcraft exec --project t.ecproj render --out title.mov --format prores --prores 4444 --channels rgba
pi-craft verify title.mov --alpha --size 1280x720 --duration 5±0.1
# 3. FilmCraft: assemble background + title overlay + mix
pi-craft filmcraft exec --save-as p.fcproj import plain.mp4 mix.wav title.mov > import.out
cat import.out
cat > assemble.jsonl <<'EOF'
{"id":"file.newSequence","params":{"name":"main","width":1280,"height":720,"fps":30,"fromItem":1}}
{"id":"source.open","params":{"item":3}}
{"id":"timeline.setTargeting","params":{"track":"V1","targeted":false}}
{"id":"timeline.setTargeting","params":{"track":"V2","targeted":true,"sourcePatch":true}}
{"id":"timeline.setTargeting","params":{"track":"A1","targeted":false}}
{"id":"playhead.set","params":{"seconds":0}}
{"id":"source.overwrite","params":{}}
{"id":"source.open","params":{"item":2}}
{"id":"timeline.setTargeting","params":{"track":"V2","targeted":false}}
{"id":"timeline.setTargeting","params":{"track":"A1","targeted":true,"sourcePatch":true}}
{"id":"playhead.set","params":{"seconds":0}}
{"id":"source.overwrite","params":{}}
EOF
pi-craft filmcraft exec --project p.fcproj --save run assemble.jsonl
pi-craft filmcraft exec --project p.fcproj export final.mp4 --format h264
# final: 5 s, h264+aac, title absent at 0.2 s, present at 3 s (vs the plain background)
pi-craft verify final.mp4 --duration 5±0.1 --has-video --has-audio --size 1280x720 --codec video=h264 --codec audio=aac \
  --max-peak -20 --frame-diff 3:plain.mp4\>0.5 --frame-diff 0.2:plain.mp4\<0.1
echo ROUNDTRIP-OK
