---
name: "veo-showreel-production-kit"
description: "Turn a video timeline + voiceover into a reproducible, sliceable Veo 3.1 prompt package with a consistency anchor and AI storyboard sketches."
version: 1
created: "2026-06-08"
updated: "2026-06-08"
---
## When to Use
Use when a user has a script/timeline + voiceover and wants to generate a consistent, professional AI video (Veo) where each fragment can be rendered separately/in parallel yet stays visually coherent and is easy to revise. Especially for trade-show/booth showreels.

## Procedure
1. Research the target context (e.g., trade-show showreel best practices) and Veo prompting + consistency features (reference images, first/last-frame, seed, enhance_prompt=false). Write a research/strategy doc.
2. Write a STYLE BIBLE = global consistency anchor: single location/world, color palette, verbatim STYLE LOCK and AUDIO LOCK sentences, recurring object/character descriptions, a global NEGATIVE prompt, brand/compliance rules, and fixed reproduction settings (model, 16:9, 4K/24fps, constant seed, enhance_prompt=false).
3. Split the timeline into <=8s render units (Veo max clip ~8s); long scenes become A/B sub-shots. Mark each boundary as hard-cut (parallel) or SEAMLESS (chain last-frame of A as first-frame of B).
4. Generate per-shot markdown via a data-driven Python script: each file has the 7-layer prompt (camera, subject, action, environment, lighting, STYLE LOCK, AUDIO LOCK), an assembled Full Veo prompt (~110-170 words), the negative prompt, continuity notes, and repro settings. Also emit one combined VIDEO_MASTER.md.
5. Generate AI storyboard sketches with nano-banana (Gemini image model): a master world-anchor frame + one sketch per cut. Use these as Veo reference/first-frame images. Run with limited concurrency (ThreadPoolExecutor max_workers=3) over a sketch_prompts.json.
6. Audio policy: instruct Veo 'no spoken dialogue, no voiceover, no song vocals' so it only makes ambient SFX; the official VO + music are added in post.
7. Write an index README explaining read order, per-slice render steps, assembly, and how to revise one beat (re-render only that slice with same seed+anchor).

## Pitfalls
- Veo clips are ~8s max — never author a single >8s render unit; split into A/B and chain frames.
- Paraphrasing the style block per shot causes drift; the STYLE LOCK and AUDIO LOCK must be byte-identical across every prompt.
- Without a shared reference image attached to every generation, parallel slices diverge — always attach the world-anchor.
- Let Veo invent narration if you don't explicitly forbid speech in the audio line.
- For neutral/defense content add 'no flags, no national insignia, no real weapons, no brand logos' to the negative prompt and reserve a clean empty center for the logo in the final shot.
- nano-banana CLI: npx -y @the-focus-ai/nano-banana "<prompt>" --output file.png ; needs GEMINI_API_KEY; describe 16:9 in the prompt (square by default).

## Verification
1. All shot files exist (one per cut) + VIDEO_MASTER.md + style bible + research + voiceover + README.
2. Every Full Veo prompt ends with the identical STYLE LOCK + AUDIO LOCK and references the same seed.
3. Storyboard sketches generated for the world anchor and every cut; spot-check key frames (opener, any on-screen-text shot, recurring character, final logo-space shot) for look + compliance.
4. Build a contact sheet (ImageMagick montage) to eyeball cross-shot consistency.