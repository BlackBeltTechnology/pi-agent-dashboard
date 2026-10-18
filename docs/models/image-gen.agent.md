# image-gen.md — image generation index

Pull-only condensed map. Source: docs/models/image-gen.md. 50 image models from AI Search transcripts (2026-04-05 → 2026-10-04). Facts as stated in video; unstated = `—`.

Flags: open = open weights · local = runnable locally per video.

## Open weights + local (per video)
- Fibo 1.5 — Bria AI; open weights, local not stated; structured JSON prompts; per-field control; edits.
- Anima v3 Preview — 2B; anime; ComfyUI; Civitai, ModelScope.
- Asymmetric Flow Models — pixel space, no VAE; ~40% faster after tweaks.
- Bonsai Image — Flux 2 Klein compressed to ~1 GB; iPhone 17 Pro Max demo; 1-bit and ternary.
- Boogoo Image (base/edit/turbo) — base 20 GB (FP8 ~10 GB); edit 20 GB; ComfyUI.
- CDM — Alibaba; 4 denoise steps vs 20–50; SD3, LongCat only.
- CFI Image (1B/5B) — layout and texture streams; 5B under 10 GB.
- Diffusion OPSTD — ByteDance; per-step reward targets; model agnostic.
- DreamLight — ByteDance; 0.39B; phone 1024x1024 ~3 s; model release planned.
- Ernie Image (base, Turbo) — ~16 GB/model; GGUF Q2_K 3.18 GB to 16 GB; ComfyUI; best open per video.
- GenSearcher — web search for references before generation.
- HiDream 01 Image — Vivigao; 32 GB; 2048x2048; no ComfyUI yet.
- I1 — Princeton; 3B ~12 GB; full training code and dataset.
- Ideogram 4 — 9.28 GB FP8 + unconditional model; 6 GB VRAM with CPU offload; non-commercial; ~1 min/image.
- CreaDiffuser — Krea; 4 GB VRAM reported; uncensored base.
- L2P — Z Image without VAE, pixel space; ~20 GB 1K model; 1K only.
- Lada Image — 6B; turbo 4 steps; FP8 6.7 GB.
- MageFlow — Microsoft; 4B; 17.5 GB; ControlNet built in; turbo <1 s.
- Ming Image 0.1 Design — 6B, 12 GB; transparent background; visual design.
- Mr. Flow — training-free; ComfyUI plugin.
- Qwen Image 2.1 — Alibaba; 14.2 GB BF16, 7.2 GB INT8, GGUF 3.19 GB; generation + edit; commercial use forbidden by model license.
- RDM — single-step distribution matching; lacks detail.
- Sega — 4K–6144 px; Flux 1 and Qwen Image bases.
- SenseNova U 1.5 8B — 8B ~50 GB; native 4K pixel space.
- Supra Image — 100M, 417 MB; phone; low quality.
- Unseen Zero — coupled oscillators; proof of concept.
- UniGenDet — detection and generation unified.
- Z Image — previous best open; ComfyUI.
- Z Anime — Tongyi Lab; 6B; FP8 6 GB; 4-step distilled.
- Z Image Turbo — 12 GB BF16; 1K in <10 s; 7–9 steps.

## Closed / paid / local not stated
- Tuna 2 — Meta; closed; reduced-layer foundation checkpoint only.
- Dance OPD — ByteDance; paper; code not released.
- Flux 3 Image — Black Forest Labs; closed; open weights promised, not delivered for Flux 3 Video.
- GPT Image 2 (ChatGPT Images 2.0) — OpenAI; free 3–5/day; best text rendering per video.
- GPT Image 2 — OpenAI; beat 2.5 on anime grid.
- GPT Image 2.5 — OpenAI; #1 arenas; fails signage, chess, biology labels.
- GPT Image 2.5 Flare — 50% lower latency than quality variant.
- GPT Image 2.5 Sunburst — premium; up to 4K.
- Krea TII — Krea; web; closed.
- MAI Image 2.5 — Microsoft Foundry; paid.
- Muse Image — Meta; agent-like planning; public Instagram opt-out needed.
- Nano Banana Pro — Google; floor-plan perspective right; misspellings at high element counts.
- Nano Banana 2 — Google; web search during generation; lost most head-to-head tests.
- Nano Banana 2 Light — Google; ~4 s, ~3 cents per 1K; below full Nano Banana 2.
- PS Designer — layered Photoshop output; code announced.
- Qwen Image 3 — Alibaba; closed; dense text.
- Reve 2 — paid; closed; structured bounding-box layout; separately editable regions.
- Reve 2.1 — Reve; closed, paid; up to 16 MP 4K output; bounding-box micro-edits.
- Wan 2.7 Image (and Pro) — Alibaba; API/web; hex color control.
- Unified Vector Floor Plan Generation — paper only; FML layout language.
