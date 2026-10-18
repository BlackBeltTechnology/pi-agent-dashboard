# llm.md — LLM index

Pull-only condensed map. Source: docs/models/llm.md. 94 general chat/reasoning LLMs from AI Search transcripts (2026-04-05 → 2026-10-04). Facts as stated in video; unstated = `—`.

Flags: open = open weights · local = runnable locally per video.

## Open + local
- Aikido Ultra — 328 GB compressed (1.5 TB full); GLM 5.3 cyber fine-tune.
- ARX 2 — 27B Qwen-based; 55 GB; propose → measure → retry.
- Bespoke Nimble — LoRA 193 MB on Qwen 3.5 9B (~20 GB base); confidence per option.
- Big Bang — Qwen 3.6 35B base; generator/critic/metacritic loop.
- Bonsai 27B (ternary, 1-bit) — 3.9–5.9 GB; iPhone 17 Pro or laptop.
- Bonsai 2 27B — ternary Qwen 3.8 27B; 5.95 GB (Q1) / 7.21 GB (Q2) vs 55.6 GB; MLX.
- Cactus Needle 2 — 45M params, 14 MB; 500 tok/s Pi 5.
- CLM — 8B on Qwen 3 8B; system-one action scoring.
- DeepSeek V4 Flash (preview) — 284B, 160 GB; 1M ctx.
- DeepSeek V4 Pro (preview) — 1.6T / 49B active; base + non-base.
- DeepSeek V4 Pro — 1.6T; CSA/HCA attention, Muon.
- DeepSeek V4 — DeepSpark implemented.
- DeepSeek V4 Flash — 167 GB; 82.5 GB 1-bit GGUF.
- DeepSeek V4 Flash Vision Experimental — 305B, ~168 GB; vision.
- DeepSeek V4.1 Flash — ~510 GB; 890 B/token KV cache; engram 168B in RAM.
- Edge Zero — Qwen 3.5 35B-A3B in 2.9 GB; 8B variant 1 GB; Mac.
- Gemma 4 + MTP drafters — drafter speedup, no quality loss.
- Diffusion Gemma — 26B, ~52 GB; up to 4x faster.
- GLM 5.1 — ~1.5 TB.
- GLM 5.3 Flash (Ox Alpha) — 320B/18B, 328 GB; 1-bit GGUF 93 GB; vision.
- Hunyuan HiP Preview — 295B/21B, ~600 GB; 256K ctx.
- Hunyuan 3 — 295B/21B; FP8 300 GB.
- HY4 Preview — 770B/49B, 1.56 TB; GGML 1-bit 229 GB.
- HYMT2 30B-A3B — translation, 33 languages; 60 GB; 1.8B at 4 GB.
- Instella MoE — 16B/2.8B; trained on AMD Instinct ROCm.
- Kimi K2.6 — 1.1T, ~600 GB; up to 300 sub-agents.
- Kimi K3 — 2.8T, 1.56 TB; 594 GB 1-bit GGUF.
- Leia — 2.37 GB system-one decision model; predates Jev.
- LLaMA 1B Violetto — 1B, ~2 GB; math only.
- LongCat 2.0 — 1.6T/48B; FP8 >2 TB; trained on AI ASICs, no Nvidia.
- Mimo 2.6 Flash — 311B, 178 GB.
- Mimo 2.6 Pro — 1T, ~573 GB.
- MiniCPM 5 1B — 1B dense, 2 GB.
- MiniCPM 5 2B — 2B dense, 5 GB.
- MiniMax M3 — 427B/23B; 850 GB full; FP8 444 GB; 1M ctx.
- Muse Glimmer — Meta; 30B dense, ~60 GB; Apache-2.0.
- Nanobeg 4.2 — 3B, 8 GB; looped transformer.
- Needle 3 — 29M–121M, 8–29 MB; attention net, not transformer.
- Nemotron 3 Ultra — 550B/55B, ~350 GB; 1M ctx.
- Nemotron 3.5 Lightning — 30B MoE; ~22 GB FP4; 1M ctx.
- Okami 1.0 — 35B/3B; smallest GGUF ~12 GB.
- Qwen 3.6 35B-A3B — 35B/3B; 72 GB.
- Qwen 3.6 27B — 27B; 56 GB; 18 GB at 4-bit.
- Qwen 3.6 35B — ~72 GB; 128 GB unified memory.
- Qwen 3.8 Max (open release) — 2.4T/95B active; 4.8 TB.
- Qwen 3.8 27B — dense vision; 56 GB; Q2 GGUF 9 GB; 1M ctx.
- Qwen 3.8 Flash Next — 125B/6B active; 1-bit GGUF 72.5 GB.
- Step 3.7 Flash — ~400 GB.
- Ternary Bonsai (8B/4B/1.7B) — 1.58-bit; ~9–10x smaller than 16-bit.
- Zaya 1 8B — 8B MoE, 17.7 GB; AMD Instinct trained; commercial use OK.
- ZGCM-1 — 7B math reasoning; full pipeline released.

## Open weights, local not stated
- DeepSeek V4 Pro (Aug 13) — 1.7T MoE; 893 GB raw; API + open.
- Ling 2.6 Flash — 104B/7.4B active.
- Mistral Medium 3.5 — 128B dense; weak on independent leaderboards.
- Qwen 3.8 Max (preview) — 2.4T; open weights promised; no specs published.


## Closed / API / subscription
- ChatGPT dreaming (memory) — background memory synthesis.
- Claude Sonnet 4.5 — 171 emotion vectors; blackmail 22%, 72% under desperation amplification.
- Claude Mythos 5 — ~100 trusted partners; banned per video, restricted.
- Claude Fable 5 (re-release) — nerfed; 50% weekly cap; falls back to Opus 4.8.
- Claude Sonnet 5 — smaller 5-gen; costlier than GPT 5.5.
- Claude Opus 5 — silent fallback for restricted prompts.
- Claude Fable 5.1 — top index at release; most expensive; 5-h limit fast.
- Claude Opus 4.8 — previous flagship; Fable 5 fallback.
- Claude Opus 5.5 — ~$6/task; hallucinates more than GPT-6/Grok.
- Claude Sonnet 5.5 — free-plan default; most expensive per task.
- DeepSeek Expert Mode (possible V4 Lite) — free web; unconfirmed.
- Gemini 3.5 Flash — free web; ~4x tokens/s.
- Gemini 3.5 Flash Lite — ~4x faster than Flash; high-volume.
- Gemini 3.6 Flash — ~60% fewer tokens than 3.5 Flash.
- Gemini 3.8 Flash Cyber — defensive security variant.
- Gemini 4 Argon — trusted-tester first; up to 1M output tokens.
- GLM 5.3 Flash (Z.ai) — 100k+ Chinese accelerators; humans set goals.
- GPT-5.5 — Codex daily driver.
- GPT-5.6 (Sol/Terra/Luna) — up to 750 tok/s on Cerebras; Sol extra-high 11–31 min/task.
- GPT-5.6 Sol Ultra-Fast — 750 tok/s; private preview.
- GPT-6 / Astra (internal) — 10 open math problems.
- GPT-6 Astra — Enigma decrypt ~10 h; human-guided.
- GPT-6 Luna — ~7 cents/task; lowest GPT-6 tier.
- GPT-6 Soul — mid tier; not in chat yet.
- GPT-6.1 Soul — near-Astra at ~1/5 price.
- Grok 4.3 Beta — sandbox code exec; mediocre.
- Grok 4.5 — ~80 tok/s; 500K ctx.
- Grok 4.6 — strong on vague-idea-to-prototype.
- Grok 4.7 — xAI best self-reported; costlier per task than GPT-6.
- Jev — waitlist; calibrated confidence 70–500 ms; not open.
- MAI Thinking One — Microsoft; 1T/35B active; Foundry waitlist.
- MiMo 2.5 Pro — Xiaomi; text-only; weights not released.
- MiMo V2.6 — in training; public RL dashboard.
- Muse Spark — Meta; proprietary.
- Muse Spark 1.3 — Meta; paid API.
- Qwen 3.6 Plus — 1M ctx; free web; cherry-picked table.
- Qwen 3.7 Max — Alibaba Model Studio; vision.
- Qwen 3.8 Max 0902 — 2.4T, 1M ctx; not open.
- Talkie (Toki) — 13B; trained on books/newspapers ≤1930; web chat only.
