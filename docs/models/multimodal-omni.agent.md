# multimodal-omni.md — multimodal / omni index

Pull-only condensed map. Source: docs/models/multimodal-omni.md. 30 multimodal/omni models from AI Search transcripts (2026-04-05 → 2026-10-04). Facts as stated in video; unstated = `—`.

## Open weights (local per video where stated)
- Dots 3 Note — RedNote; 208B/16B active MoE; 577 GB full, 300 GB FP8; 512K ctx.
- Gemma 4 (E2B/E4B/24B-A3.8B/31B) — Google; phones to 31B dense; 140+ languages.
- Gemma 4 12B — 16 GB VRAM offline; LM Studio, Ollama.
- GLM 5.2 with vision (unofficial) — Base10; GLM 5.2 + Kimi vision encoder; 466 GB NVFP4.
- Intern Luminina U2 — Shanghai AI Lab; diffusion LLM; weights pending upload.
- Lance 3B — ByteDance; 3B; 40 GB VRAM; image + video edit.
- Locate Anything — NVIDIA; 3B, 7.8 GB; bounding boxes from text.
- Marlin 2B — 2B, <6 GB; video structured events; Qwen 3.5 2B base.
- MiniCPM-V 4.6 — OpenBMB; 2.6 GB; phone; iOS, Android, Harmony.
- Nemotron 3 Nano Omni — NVIDIA; 30B/3B active; 66.1 GB; video+audio+image+text.
- Pixelum — research preview; pixel-space understanding and generation.
- Perception DILM — ByteDance; diffusion LM captions regions in parallel.
- SenseNova U1 — SenseTime; ~32 GB; plastic skin on portraits.

## Not local per video / closed / API only
- Inkling — Thinking Machines; open; ~1T/41B active; 1.9 TB full; 1M ctx; not local.
- Inkling Small (preview) — Thinking Machines; open; 276B/12B active; smaller, faster preview; not local.
- Inkling Small — Thinking Machines; open; 276B/12B active; 532 GB; not local.
- Qwen 3.5 Omni (Plus, Realtime) — Alibaba; open; HF Spaces, QwenChat.
- Step 5 Preview — StepFun; open weights promised Oct 15; 600B/27B active; 1M ctx.
- Flux 3 — Black Forest Labs; waitlist; image + 20 s 720p video + robotics.
- Gemini 3.7 Flash — Google; 340 tok/s; $0.40/task.
- Gemini 3.8 Flash — Google; 348 tok/s; highest output-token use.
- GenSeption — Google DeepMind; paper only; depth/normals/pose from video model.
- GLM-5V Turbo — ZAI; sketch/screen recording → front-end code; API.
- MiMo 2.5 — Xiaomi; text+image+audio; weights not released.
- Muse Spark 1.1 — Meta; proprietary; not top 10 on independent leaderboards.
- Qwen 3.7 Plus — Alibaba; paid API; no open weights.
- Qwen 3.8 Omni Flash — Alibaba; 1M ctx; API/token plan.
- Seed 2.1 (Pro/Turbo) — ByteDance; closed; paid.
- Vision Banana — Google; technical report only.
- Google Sign Language to Text — Google DeepMind; ASL first; Pixel 11 camera.
