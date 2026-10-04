# Model picks — best for task / best for hardware

Hand-curated. Never written by `build-catalog.py`; renderer ignores this file. Refresh by hand after each regen.

Caveat: facts = presenter claims per weekly video, unverified. Window 2026-04-05 → 2026-10-04. Newer model in same family usually supersedes older; only models mentioned in a video appear.

## How to read tiers

Tier = smallest hardware class a local model runs on. Generated list: [local-hardware.md](local-hardware.md).
T0 phone/CPU/laptop · T1 ≤ 8 GB · T2 ≤ 16 GB · T3 ≤ 32 GB (4090/5090) · T4 ≤ 128 GB workstation (RTX 6000 / DGX Spark / Mac) · T5 multi-GPU.
`est.` = tier estimated from checkpoint size, not stated on video.

## Best for task

### LLM — general chat / reasoning

| Pick | Why | Open | Local tier | Source date |
|---|---|---|---|---|
| [Gemini 4 Argon](llm.md) | Beats GPT-6 Astra + best Claude on average. #1 long-horizon agentic coding, Vals Index. 1M-token output | — | cloud | 2026-10-04 |
| [Claude Opus 5.5](llm.md) | #1 Artificial Analysis intelligence index. Best for design, 3D, long multi-hour agentic sessions | — | cloud | 2026-09-24 |
| [GPT-6.1 Soul](llm.md) | Near-Astra intelligence at ~1/5 price. Most cost-efficient frontier model | — | cloud | 2026-10-04 |
| [Mimo 2.6 Pro](llm.md) | Leading open-weights. Tops AA open-model index. ~13¢/task | yes | T5 (est.) | 2026-09-27 |
| [GLM 5.3](coding.md) | Most intelligent open-weights model runnable locally. Near best GPT/Claude | yes | T5 | 2026-08-16 |
| [Qwen 3.8 27B](llm.md) | Best medium local model. Multimodal, 1M ctx, beats Opus 4.6 Max. One GPU | yes | T2 | 2026-08-16 |

### Coding

| Pick | Why | Open | Local tier | Source date |
|---|---|---|---|---|
| [Claude Opus 5.5](llm.md) | #1 agentic coding + computer use. Beats Fable 5.1 / GPT-6 Astra | — | cloud | 2026-09-24 |
| [Gemini 4 Argon](llm.md) | #1 on long-horizon agentic coding bench | — | cloud | 2026-10-04 |
| [Gemini 3.8 Flash](multimodal-omni.md) | #1 Deep SWE long-horizon. 348 tok/s. Cheap | — | cloud | 2026-09-06 |
| [GLM 5.3](coding.md) | Most intelligent open-weights coding model. Ties Kimi K3 with far fewer params | yes | T5 | 2026-08-16 |
| [Ornith 1.5](coding.md) | 397B beats GLM 5.2 (2× size). 9B 4-bit GGUF under 6 GB | yes | T1 | 2026-08-23 |
| [Laguna S 2.1](coding.md) | ~100B, 1M ctx, verify/backtrack loop. Self-reported Deep SWE 40% | yes | T2 | 2026-07-26 |

### Multimodal / omni

| Pick | Why | Open | Local tier | Source date |
|---|---|---|---|---|
| [Qwen 3.8 Omni Flash](multimodal-omni.md) | Beats Gemini 3.8 Flash on audiovisual/audio/speech. 1M ctx (~1 h video). Cheap | — | cloud | 2026-09-20 |
| [Gemini 3.8 Flash](multimodal-omni.md) | SOTA scientific figures + long video. #1 Deep SWE. 348 tok/s | — | cloud | 2026-09-06 |
| [Gemini 3.7 Flash](multimodal-omni.md) | Fastest widely available (340 tok/s). Top small/flash on frontier code | — | cloud | 2026-08-16 |
| [Dots 3 Note](multimodal-omni.md) | Best open ARC-AGI-2. Performs near ~10× larger models | yes | T5 (est.) | 2026-09-27 |
| [Nemotron 3 Nano Omni](multimodal-omni.md) | One model for video/audio/image/text. Temporal video compression | yes | T2 | 2026-05-03 |
| [Marlin 2B](multimodal-omni.md) | Strongest open video VLM in weight class. Timestamped events | yes | T1 | 2026-05-24 |

### Image generation

| Pick | Why | Open | Local tier | Source date |
|---|---|---|---|---|
| [GPT Image 2.5](image-gen.md) | #1 text-to-image + #1 image-editing arena. Transparent-layer/PSD. Multi-turn | — | cloud | 2026-09-10 |
| [Flux 3 Image](image-gen.md) | Bounding-box layout, up to 10 refs, text-heavy posters + NL edit suite | — | cloud | 2026-10-04 |
| [Nano Banana 2 Light](image-gen.md) | Fastest/cheapest Google image model. ~4 s, ~3¢ per 1K | — | cloud | 2026-07-05 |
| [Ming Image 0.1 Design](image-gen.md) | #1 open on AA UI/UX design leaderboard. Transparent backgrounds | yes | T3 | 2026-09-27 |
| [Qwen Image 2.1](image-gen.md) | Gen + NL edit, alpha output, 10 refs, character consistency | yes | T1 (8 GB) | 2026-09-22 |
| [Ideogram 4](image-gen.md) | Best open quality/prompt adherence. Bbox placement of objects/text | yes | T1 (6 GB) | 2026-06-07 |

### Image editing

| Pick | Why | Open | Local tier | Source date |
|---|---|---|---|---|
| [GPT Image 2.5](image-gen.md) | #1 image-editing arena | — | cloud | 2026-09-10 |
| [Ideogram 4.5](image-edit.md) | Most precise editor. Holds pixel-level consistency over many successive edits | — | cloud | 2026-10-04 |
| [Seedream 5.0 Pro](image-edit.md) | Annotate-over-image edit, dense infographics, transparent layers | — | cloud | 2026-07-12 |
| [Qwen Image 2.1](image-gen.md) | Open NL editor + generator. Alpha output, 10 refs | yes | T1 | 2026-09-22 |
| [Ming Image Design Layer](image-edit.md) | Flat design → individually editable transparent layers. MIT | yes | T3 | 2026-09-27 |
| [PID 1.5](image-edit.md) | Fastest open upscaler. 512² → 2K in seconds | yes | T2 | 2026-07-19 |

### Video generation

| Pick | Why | Open | Local tier | Source date |
|---|---|---|---|---|
| [Happy Horse](video-gen.md) | Artificial Analysis #1 text-to-video and image-to-video | — | cloud | 2026-05-03 |
| [Ray 3.2](video-gen.md) | Best motion/physics/3D coherence over cinematic sequences | — | cloud | 2026-09-27 |
| [H3Max](video-gen.md) | MiniMax H3 fine-tune. Best quality score + lowest latency | — | cloud | 2026-08-30 |
| [MiniMax H3](video-gen.md) | Best open video model. Turbo LoRAs cut 20 steps → 4-6 | yes | T1 (8 GB) | 2026-08-02 |
| [LTX 2.5](video-gen.md) | Fastest open generator. 4K/50 fps/20 s, two-pass. 2-3× faster than H3 | yes | T2 | 2026-08-16 |
| [Neva](video-gen.md) | 720p with natively aligned dual-channel speech audio | yes | T2 | 2026-06-07 |

MiniMax H3 license excludes EU/UK/Korea/US; commercial use only under $20M yearly revenue.

### Video editing

| Pick | Why | Open | Local tier | Source date |
|---|---|---|---|---|
| [Gemini Omni Flash](video-edit.md) | Takes any reference incl. existing video. NL edits | — | cloud | 2026-07-05 |
| [Motion for Motion](video-edit.md) | Motion transfer across different characters/proportions | — | cloud | 2026-07-19 |
| [Sole Refiner](video-edit.md) | Model-agnostic single-step upscale to 4K | yes | unspecified | 2026-10-04 |
| [Meridian](video-edit.md) | Re-shoots existing video from new camera path (orbit/dolly/bullet-time) | yes | T4 (est.) | 2026-09-20 |
| [Joy AI Video Edit](video-edit.md) | NL edit 720p >30 fps, ~1 s latency. Quality on par with Kling 3 Omni | yes | T3 | 2026-08-16 |

### Music generation

| Pick | Why | Open | Local tier | Source date |
|---|---|---|---|---|
| [Suno V6](music.md) | Frontier reference generator. Song-quality index below YuE 2 and Suno V5 | — | cloud | 2026-09-13 |
| [Happy Shrimp](music.md) | Clean dynamic vocal + instrumental from style + lyrics | — | cloud | 2026-08-23 |
| [Suno V6 Wild](music.md) | More varied/unpredictable ideation variant | — | cloud | 2026-09-13 |
| [YuE 2](music.md) | Best open. Editable ABC score first. Beats Suno V6/V5.5. Cover songs | yes | T1 (4 GB quant) | 2026-09-13 |
| [MiniMax Music 3](music.md) | Clean professional songs from style + tagged lyrics. INT8 low-end | yes | T1 | 2026-08-15 |
| [ACE-Step 1.5 XL](music.md) | Inpaint / style-transfer existing tracks. Full song under 1 min | yes | T2 | 2026-04-12 |

### TTS / voice cloning

| Pick | Why | Open | Local tier | Source date |
|---|---|---|---|---|
| [ElevenLabs V4](tts-voice.md) | Most emotive. #1 on leaderboard. Meta-tag control | — | cloud | 2026-10-04 |
| [Gemini 3.8 Flash TTS](tts-voice.md) | SOTA quality, beats ElevenLabs on average. #1 pronunciation. Cheap | — | cloud | 2026-09-27 |
| [Gemini 3.8 Flash Lite TTS](tts-voice.md) | Cheapest high-volume mass-dubbing variant | — | cloud | 2026-09-27 |
| [Higgs Audio v3](tts-voice.md) | Best open expressive TTS. Inline emotion/style/speed tags | yes | T2 | 2026-06-07 |
| [Dot TTS](tts-voice.md) | 2B. Best error-rate/speaker-similarity tradeoff. Cross-lingual clone | yes | T2 | 2026-06-14 |
| [Tencent "Out"](tts-voice.md) | Prompt-driven speech edit (add/delete words, emotion). Zero-shot clone | yes | T2 | 2026-09-13 |

### ASR / speech recognition

| Pick | Why | Open | Local tier | Source date |
|---|---|---|---|---|
| [Gemini 3.5 Transcribe](asr-speech.md) | Verbatim + cleaned modes, multi-speaker, word timestamps, sub-second live | — | cloud | 2026-08-30 |
| [GPT Realtime Whisper](asr-speech.md) | Real-time captions/subtitles/meeting notes | — | cloud | 2026-05-10 |
| [R2T2](asr-speech.md) | Lowest word error rate + lowest latency. Real-time. English + Chinese | yes | T2 | 2026-09-20 |
| [Phon 2](asr-speech.md) | Tiny. 1 h audio → text in ~20 s. Second-lowest average error rate | yes | T1 (est.) | 2026-10-04 |
| [Whistle](asr-speech.md) | 16.9 MB, CPU-only, word timestamps. ~6× faster than Whisper Base | yes | T0 | 2026-10-04 |

### 3D generation / reconstruction

| Pick | Why | Open | Local tier | Source date |
|---|---|---|---|---|
| [Geo Weaver](3d.md) | Consistent scene from long videos. Stops scale/camera drift | — | cloud | 2026-08-23 |
| [Lift-4D](3d.md) | Single 2D video → full 4D scene, incl. unseen regions | — | cloud | 2026-06-28 |
| [VidiHand](3d.md) | Precise 3D hand/finger reconstruction under occlusion. Humanoid robotics | — | cloud | 2026-07-05 |
| [Pixel3D](3d.md) | Best/most accurate single-image→3D. Links 2D pixels to 3D structure | yes | T3 | 2026-05-17 |
| [Marigold V2](3d.md) | SOTA depth/normal/albedo from one image, high resolution | yes | T3 | 2026-09-13 |
| [Fire 3D](3d.md) | Photos/video → simulation-ready scene <1 min. 16 objects in parallel | yes | T3 | 2026-09-13 |

### World models

| Pick | Why | Open | Local tier | Source date |
|---|---|---|---|---|
| [Atlas](world-model.md) | Pixel-perfect 1440p, up to 1 min, along drawn camera path. Emits 3D geometry | — | cloud | 2026-09-06 |
| [GLM Worlds 2](world-model.md) | Walkable interactive world, 720p 24 fps, no max duration | — | cloud | 2026-09-06 |
| [Sim Factory](world-model.md) | One photo/video → simulation-ready physically accurate 3D scene | — | cloud | 2026-07-05 |
| [InSpatial World 1.5](world-model.md) | Camera-path walkthrough from image/panorama/video | yes | T2 | 2026-10-04 |
| [GAE](world-model.md) | Video + depth + trajectory + running 3D reconstruction. Memory-consistent | yes | T2 | 2026-09-27 |
| [World Crafter](world-model.md) | Interactive 3D world, implicit 3D-aware memory, many art styles | yes | T5 (est.) | 2026-09-27 |

### Avatars / lip-sync

| Pick | Why | Open | Local tier | Source date |
|---|---|---|---|---|
| [Wan Streamer 0.3](avatar-lipsync.md) | Real-time interactive character. Body movement + surroundings | — | cloud | 2026-07-19 |
| [Luna](avatar-lipsync.md) | Realistic 3D human from few images + any driving signal | — | cloud | 2026-07-05 |
| [Stream Character](avatar-lipsync.md) | Near-real-time consistent avatar, precise motion control | — | cloud | 2026-06-07 |
| [LeapTalk](avatar-lipsync.md) | Fastest real-time talking head. Up to 200 FPS on H200 | yes | T5 | 2026-08-09 |
| [Wan Animate 2](avatar-lipsync.md) | Animates any character photo (human or not) from reference video | yes | T2 | 2026-08-09 |
| [LongCat Video Avatar 1.5](avatar-lipsync.md) | Natural expressive talking avatar. Art styles + multi-person | yes | T3 | 2026-05-24 |

### Agents

| Pick | Why | Open | Local tier | Source date |
|---|---|---|---|---|
| [Dots](agent.md) | Persistent agent with always-on cloud computer. Works 24/7 across projects | — | cloud | 2026-10-04 |
| [Muse](agent.md) | Consumer errand agent. Email, calendar, shopping | — | cloud | 2026-09-27 |
| [Sakana Fugu](agent.md) | Routes prompts across models. Raises average scores over any single model | — | cloud | 2026-06-28 |
| [AgentsA1 35B](agent.md) | 35B beats trillion-param Kimi K2.6 / DeepSeek V4 Pro. Runs offline, consumer HW | yes | T3 | 2026-07-05 |
| [Open Dots](agent.md) | Self-hostable clone. Point at own infra | yes | unspecified | 2026-10-04 |
| [DeepSeek Harness](agent.md) | Same-vendor harness. Best way to run DeepSeek models | yes | unspecified | 2026-08-16 |

## Best per hardware

Strongest local option per task per tier. Fits-or-below tier; `est.` = estimated tier. Full list: [local-hardware.md](local-hardware.md).

| Tier | LLM | Coding | Image | Image-edit | Video | Music | TTS | ASR | 3D |
|---|---|---|---|---|---|---|---|---|---|
| T0 phone/CPU | [Bonsai 27B](llm.md) ternary 5.9 GB | — | [Supra Image](image-gen.md) 417 MB | — | [Mobile WAN](video-gen.md) 480p | [Magenta Real-Time 2](music.md) 200 ms | — | [Whistle](asr-speech.md) 16.9 MB | [WildDet 3D](3d.md) |
| T1 ≤ 8 GB | [Edge Zero](llm.md) Qwen 35B-A3B @2.9 GB | [Ornith 1.5 9B](coding.md) GGUF <6 GB | [Ernie Image](image-gen.md) Q2 3.18 GB | [PID](image-edit.md) 1.5 GB (est.) | [MiniMax H3](video-gen.md) W4A8 (EU/UK/KR/US excl.) | [YuE 2](music.md) quant 4 GB | — | [Phon 2](asr-speech.md) (est.) | [ARTI](3d.md) / [Deja View](3d.md) (est.) |
| T2 ≤ 16 GB | [Qwen 3.8 27B](llm.md) | [Laguna S 2.1](coding.md) | [Ideogram 4](image-gen.md) 6 GB offload | [Lucida](image-edit.md) / [PID 1.5](image-edit.md) | [LTX 2.5](video-gen.md) / [Neva](video-gen.md) | [ACE-Step 1.5 XL](music.md) | [Higgs Audio v3](tts-voice.md) | [Mega ASR](asr-speech.md) / [R2T2](asr-speech.md) | [Triplat](3d.md) / [Mirror Scene](3d.md) |
| T3 ≤ 32 GB 4090/5090 | [GLM 5.3 Flash](llm.md) | [Ornith 1.5](coding.md) | [Ming Image 0.1 Design](image-gen.md) | [Qwen Image 2.1](image-gen.md) / [Ming Image Design Layer](image-edit.md) | [MiniMax H3](video-gen.md) / [Scale 2](video-gen.md) | [YuE 2](music.md) | [Higgs Audio v3](tts-voice.md) | [Crisper Whisper 2](asr-speech.md) | [Pixel3D](3d.md) / [Marigold V2](3d.md) / [4D Anyone](3d.md) |
| T4 ≤ 128 GB | [GLM 5.2](coding.md) MIT | [GLM 5.2](coding.md) | [HiDream 01 Image](image-gen.md) | [Lucida](image-edit.md) / [PID 1.5](image-edit.md) | [MiniMax H3](video-gen.md) / [LTX 2.5](video-gen.md) | [ACE-Step 1.5 XL](music.md) | [Higgs Audio v3](tts-voice.md) | [Mega ASR](asr-speech.md) | [4D Anyone](3d.md) / [Marigold V2](3d.md) |
| T5 multi-GPU | [Mimo 2.6 Pro](llm.md) (est.) / [GLM 5.3](coding.md) | [GLM 5.3](coding.md) | [Ming Image 0.1 Design](image-gen.md) | [Qwen Image 2.1](image-gen.md) | [FastVideo for MiniMax H3](video-gen.md) 14× faster | [YuE 2](music.md) | [Higgs Audio v3](tts-voice.md) | [Mega ASR](asr-speech.md) | [4D Anyone](3d.md) |

TTS needs T2+ (all open TTS picks land at T2). Image-edit has no T0 option. Coding has no T0 option.
