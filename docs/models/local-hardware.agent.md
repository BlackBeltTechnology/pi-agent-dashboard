# local-hardware.md — local models by hardware tier index

Pull-only condensed map. Source: docs/models/local-hardware.md. 297 local-runnable models tiered by smallest hardware class. GB = VRAM or Apple unified RAM. Tier from explicit GB, presenter wording, or *est.* from checkpoint size. Facts as stated in video.

Per-row detail (params, run-with, license): see source table; this file lists names per tier.

## T0 · phone / CPU / laptop (16)
Rule: phone, CPU, laptop, Raspberry Pi.
- WildDet 3D; MuseScriber; Whistle; Bonsai Image; DreamLight; Supra Image; Bonsai 27B (ternary, 1-bit); Cactus Needle 2; MiniCPM 5 1B; MiniCPM 5 2B; Needle 3; Gemma 4 (E2B/E4B/24B-A3.8B/31B); MiniCPM-V 4.6; Magenta Real-Time 2; Mirelo Audio to MIDI; Mobile WAN.

## T1 · low-end GPU (≤ 8 GB) (27)
Rule: ≤ 8 GB.
- ARTI; Deja View; Arbor; Phon 2; Just Dub It; Ornith 1.5 (9B); Gemma 2 2B text encoder; Qwen 3 VL 8B text encoder; PID (BF16 upscaler 2.7 GB); Redesign; SeeThrough (4-bit, 8 GB); CreaDiffuser (4 GB reported); Ernie Image (GGUF Q6 6.7 GB); Ideogram 4 (6 GB CPU offload); Qwen Image 2.1 (INT8 8 GB, Q3 GGUF 4 GB); Edge Zero; LLaMA 1B Violetto; Marlin 2B; MiniMax Music 3 (INT8); YuE 2 (quantized 4 GB); OmniShotCut; Vigle Animate (LoRA 2.5 GB); DMAD; LTX HDR LoRA; MiniMax H3 (W4A8 ~8 GB; GGUF ~4 GB); PDMD; Waypoint 1.5 (min RTX 3070).

## T2 · mainstream GPU (≤ 16 GB) (65)
Rule: ≤ 16 GB.
- AnyRecon; Cube Part; Lyra 2; Mirror Scene; Pager; Proxy Pose; Triplat; World Tracing; Crisper Whisper 2; Mega ASR; R2T2; Wan Animate 2 (Light); Laguna S 2.1 (XS); Ovis VLM Embedding; TimesFM 3; ControlLight; Lucida; PID 1.5; CFI Image (1B/5B); I1; Lada Image; Z Anime; Z Image Turbo; Bonsai 2 27B; Gemma 4 MTP drafters; HYMT2 30B-A3B (1.8B); Leia; LongCat 2.0; Nanobeg 4.2; Okami 1.0; Qwen 3.8 27B (Q2 GGUF); Ternary Bonsai (8B/4B/1.7B); ZGCM-1; Gemma 4 12B; Locate Anything; Nemotron 3 Nano Omni; ACE-Step 1.5 XL (12 GB min w/ offload); ACE-Step 1.5 XL (Base/SFT/Turbo); MuseViT; Stable Audio 3; SymphonyGen; VocalRender (Pro); Flux 3 Action; Unitree UniVLA; Logos (1B/8B); Audio8TS; Dot TTS; Dramabox; Higgs Audio v3; IndexTTS 2.5; LongCat Audio DiT; MoDa ShangLM Gen; Omni Voice; SeenMa Audio; Tencent speech model ("Out"); Wave TTS; Fix Anything; UniVid X; LTX 2.5; Neva (FP8 ~7 GB); Scale 2 (GGUF needed); Video DeltaNet (VDN H3); DreamXWorld 5B; GAE; InSpatial World 1.5.

## T3 · high-end GPU (≤ 32 GB, e.g. 4090/5090) (54)
Rule: ≤ 32 GB (4090/5090).
- 4D Anyone; Animate; Fire 3D; Marigold V2; Pixel3D; AgentsA1 35B (Q4 21 GB); LongCat Video Avatar 1.5; Ornith 1.0 (35B Q4); Nemotron 3 Embed; EditCrafter (4K); Ming Image Design Layer; Spatial Edit; Boogoo Image; CDM; L2P; MageFlow; Ming Image 0.1 Design; SenseNova U 1.5 8B; Bespoke Nimble; DeepSeek V4 Flash (1 DGX Spark); Diffusion Gemma; GLM 5.3 Flash (Ox Alpha); Instella MoE; Muse Glimmer; Nemotron 3.5 Lightning; Qwen 3.6 27B; Zaya 1 8B; SenseNova U1; Astro Brief; Carbon; ClinFusion (8B/32B); Joy AI Video Edit; Live Edit; Permavid; Qwen VideoEdit; Relit Live; Vista 4D; VOID; Domain Shuttle; Homie; Motif Video 2B; Shot Plan; Sora Video 2; Swift I2V (RTX 4090); Abot World (RTX 5090); Cosmos 3 (Nano); Evoke; Generative World Renderer; Inspace World; Open Dreamer; Oscar; Reactive GWM; Sana WM 2.8B; Scope.

## T4 · workstation (≤ 128 GB, e.g. RTX 6000 / DGX Spark / big Mac) (20)
Rule: RTX 6000, DGX Spark, big Mac, 128 GB unified.
- One Video One World; GLM 5.2 (1-bit GGUF); Next N2 (Mini 70 GB); AI Cube; Telestyle V2; HiDream 01 Image (32 GB); ARX 2; GLM 5.1; MiniMax M3; Qwen 3.6 35B; Qwen 3.6 35B-A3B; Qwen 3.8 Flash Next (1-bit GGUF); GLM 5.2 with vision (unofficial); Lance 3B (40 GB VRAM); Bernini; IDV2V; Meridian; Wan Dancer; Code World Model; Jing & Dao.

## T5 · multi-GPU / datacenter (25)
Rule: multi-GPU / datacenter.
- LeapTalk (H200); GLM 5.3; Kimi K2.7 Code; DeepSpark; TLP sparse kernels (H100); Aikido Ultra; DeepSeek V4.1 Flash; DeepSeek V4 Flash (preview); DeepSeek V4 Flash Vision Experimental; DeepSeek V4 Pro (preview); Hunyuan 3; Hunyuan HiP Preview; HY4 Preview; Kimi K2.6; Kimi K3; Mimo 2.6 Flash; Mimo 2.6 Pro; Nemotron 3 Ultra; Qwen 3.8 Max; Step 3.7 Flash; Dots 3 Note; WeatherNext 2 (Mini on Colab); FastVideo for MiniMax H3; LingBot World 2; World Crafter.

## unspecified (90)
Rule: local per video, no hardware figure. Tier unknown.
- Articraft; Block 3D; Commodo 1.1; GNM; Lito; MAC; Mama; Mesh Flow; MoCap Anything v2; PhysX Omni; RecGen; Unimate; Video MDM; WorldSculpt.
- Agent-Native Research Artifacts (ARA) + Live Research Manager; AutoScientist; ChatGPT desktop app (Codex); Claude Code; Comfy MCP; DeepSeek Harness; Game World; Long Horizon Harness; ML Intern; Muse Code; Open Co-design; Open Dots; OpenGame; Open Muse; Recursive Multi-Agent Systems; VoiceMem; Zcode.
- iQuest Q1; MiniMax Code CLI.
- BEES; Flash GRPO; NeMo SwitchYard; Qwen 3 4B text encoder; RotorQuant; Track Crafter.
- PID; Pixel Relights; SeedVR2; Anima v3 Preview; Asymmetric Flow Models; Diffusion OPSTD; GenSearcher; Mr. Flow; RDM; Sega; UniGenDet; Unseen Zero; Z Image.
- Big Bang; CLM; DeepSeek V4; DeepSeek V4 Pro.
- Intern Luminina U2; Perception DILM; Pixelum.
- Foundation 1; WaveFlow.
- Act-2 (preview); Booster T2; Gemini Robotics On-Device 2; GPT Policy; HandX; HIW 500; Isaac 0.5; LeRobot Humanoid; MolmoAct 2; Omni Contact; Prism; Show Harness; UMR.
- Brain2Qwerty v2; Sole Refiner; Hyperframes; LTX 2.3; LTX-2 Trainer; Lumina; Phi Motion; Prompt Relay.
- Actionable World Representation; H3 World; Hydra / Hybrid Memory; MultiWorld; Omni Dreams; PhysiFormer; Solar WM; Warp as History.
