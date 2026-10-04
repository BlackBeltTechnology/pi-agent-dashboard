# AI model catalog

Source: [AI Search](https://www.youtube.com/@theAIsearch) weekly AI-news videos, 2026-04-05 → 2026-10-04, 57 videos.
Built by the `youtube-srt` skill (`packages/video-transcription/.pi/skills/youtube-srt/`): auto-captions → per-video LLM extraction → `build-catalog.py`.

589 models · 302 open-weights · 297 local-runnable.

Caveats: auto-caption ASR → names may be misheard; specs = as claimed in the video, unverified; a model seen in several videos keeps its latest stated facts.

**Start here:** [picks.md](picks.md) — curated best-for-task / best-per-hardware shortlist.

## By function

| Category | Models | Open | Local |
|---|---|---|---|
| [LLMs (general chat / reasoning)](llm.md) | 94 | 55 | 51 |
| [Coding models & agents](coding.md) | 16 | 9 | 9 |
| [Multimodal / omni models](multimodal-omni.md) | 30 | 18 | 13 |
| [Image generation](image-gen.md) | 50 | 29 | 29 |
| [Image editing](image-edit.md) | 20 | 12 | 13 |
| [Video generation](video-gen.md) | 48 | 22 | 23 |
| [Video editing](video-edit.md) | 21 | 16 | 15 |
| [Music generation](music.md) | 17 | 12 | 12 |
| [Text-to-speech & voice cloning](tts-voice.md) | 17 | 11 | 11 |
| [Speech recognition](asr-speech.md) | 10 | 6 | 6 |
| [Realtime voice assistants](realtime-voice.md) | 11 | 0 | 0 |
| [3D generation](3d.md) | 45 | 32 | 31 |
| [World models & interactive worlds](world-model.md) | 41 | 29 | 26 |
| [Avatars & lip-sync](avatar-lipsync.md) | 9 | 4 | 4 |
| [Agents & AI tools](agent.md) | 52 | 12 | 19 |
| [Robotics](robotics.md) | 70 | 14 | 15 |
| [Science & medical](science-medical.md) | 21 | 7 | 6 |
| [Other](embedding-other.md) | 17 | 14 | 14 |

## By hardware

[Local-runnable models by VRAM tier](local-hardware.md)

## Data

`models.jsonl` — merged records, one model per line (`mentions[]` = video id, date, timestamp).

## Regenerate

```bash
S=packages/video-transcription/.pi/skills/youtube-srt/scripts
$S/yt-srt.sh -s now-6months "https://www.youtube.com/@theAIsearch"   # fetch new transcripts
# run extraction subagents (see SKILL.md) → <out>/extract/*.jsonl
python3 $S/build-catalog.py ~/Documents/Media/youtube/theAIsearch/extract docs/models
```
