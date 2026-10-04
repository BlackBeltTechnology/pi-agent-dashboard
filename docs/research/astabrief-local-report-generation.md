# AstaBrief (Ai2) → pi-dashboard Local Cited-Report Generator — Research Dossier

> Status: research / explore-mode (no change, no impl).
> Goal: what AstaBrief is; where it fits in pi-dashboard; how to run locally on user Mac.
> Date: 2026-10-04 (research). Confidence tags: [V] verified from source/model card, [E] estimate, [U] unverified/open.
> Sources: allenai.org/blog/astabrief, huggingface.co/allenai/AstaBrief_8B, HF dataset allenai/AstaBrief_prompts (sft_prompt.txt), github.com/allenai/ai2-scholarqa-lib (api/scholarqa/lite, run_configs/default.json, scholarqa/app.py), github.com/allenai/asta-plugins, HF model search `AstaBrief`.
> Prior repo state: no Asta/AstaBrief mention in docs/ or openspec/.

---

## 1. Question

- What is AstaBrief; what input/output contract.
- Can it run locally on user Mac (M5 Pro, 48 GB)?
- Where in pi-dashboard does it add value; where does it NOT fit.

---

## 2. Verdict

- AstaBrief-8B = narrow generator, not agent. Input: research question + retrieved excerpts. Output: cited multi-section report. One pass. [V]
- No tool calling, no retrieval of its own. Must sit behind a retrieval step. [V]
- Runs locally: GGUF community quants → llama-server / Ollama on Apple Silicon; Q8_0 fits easily in 48 GB. [V availability, E perf]
- Do NOT register as pi session model / role for chat or agent work. Prompt format is load-bearing; model card warns other formats degrade output. [V]
- Best fit: new skill (`literature-brief`) that does retrieval (kb / document-converter / web_search+fetch_content / Semantic Scholar), formats the exact SFT prompt, calls a local OpenAI-compatible endpoint, parses `SECTION;`/`TLDR;`, renders cited markdown → canvas. [E design]
- Secondary fit: first-draft generator for `docs/research/*` dossiers from fetched sources; private-PDF reports (sensitive/unpublished work stays on machine). [E]
- Domain caveat: trained on scientific-literature queries (CS-heavy eval). Engineering docs / meeting notes = out of domain → measure before relying. [U]

---

## 3. What AstaBrief Is

- Ai2 open-weights model. HF `allenai/AstaBrief_8B`. Apache-2.0. Base Qwen3-8B. [V]
- Chain: Qwen3-8B → `allenai/AstaBrief_8B_SFT` (SFT, dataset `AstaBrief_SFT_Mix`, ~47K examples from ~90K filtered real Asta queries) → `AstaBrief_8B` (offline DPO, `AstaBrief_DPO_Mix`, ~6K pairs, kept only where GPT-4.1 + DeepSeek-R1 judges agree; judges 95% agreement with humans). [V]
- Key data lesson: filtering SFT targets by citation density gave strongest gains. [V]
- Production: Asta "Generate a report" Fast mode (vs Claude-powered Thinking mode). End-to-end 51.1 s vs 178.5 s (~3.5×). [V, Ai2-reported]
- Training max seq length 16000, BF16, open-instruct on 8×H100, DPO beta 10, LR 5e-6, 7 epochs. [V]
- Eval (ScholarQA-CS2 test, model card): Qwen3-8B avg 77.3; SFT 83.7; AstaBrief-8B 87.0 (ingredient recall 90.2, answer precision 89.0, citation precision 90.5, citation recall 78.2). [V]
- vs Asta ScholarQA (Claude pipeline): SQA-CS2 dev 86.3 vs 87.6; test 87.0 vs 86.2; DeepScholarBench 53.50 vs 60.25; win rate vs Asta SQA 55% dev / 72% test. DR-Tulu-8B comparable. [V]
- Ai2 caveat: eval done 2025 vs 2025 frontier; not rerun vs current frontier. [V]
- Known gap (Ai2 blog): metrics cover relevance/coverage/citation grounding, NOT claim-scope preservation (sample→population overgeneralization, descriptive→prescriptive drift). [V]

---

## 4. Wire Contract

- Single user message; chat template applied. Recommended prompt = `sft_prompt.txt` in HF dataset `allenai/AstaBrief_prompts`. [V]
- Prompt slots: `[QUERY]`, `[SECTION_REFERENCES]` = JSON-ish map `"[ID]": "quoted excerpt text"`. [V]
- Citation rules: inline `[ID]` after text; may cite own knowledge as `(LLM Memory)`. [V]
- Output format: sections start `SECTION; <name>` newline `TLDR; <2 sentences, no citations>` then body; body = LIST or SYNTHESIS paragraphs, markdown. [V]
- Prompt hardcodes "Note that the current year is 2025." [V]
- Sampling (model card): temperature 0.7, top_p 0.95, max_tokens 4096. [V]
- Discrepancy: ScholarQA-lib `UNIFIED_GENERATION_PROMPT` (scholarqa/llms/prompts.py) uses richer key `[corpus_id | Author et al. | year | Citations: N]`; HF sft_prompt uses bare `[ID]`. Lite parser `CITATION_PATTERN` expects the rich form. Which form the released checkpoint prefers → measure. [U]
- Qwen3 reasoning: lite parser `_strip_think_block` strips `<think>…</think>` → model may emit think blocks; client must strip. [V parser, U frequency]

```mermaid
flowchart LR
  Q[Research question] --> R[Retrieval: kb / PDFs / web / S2 snippets]
  R --> F[Format sft_prompt: QUERY + SECTION_REFERENCES]
  F --> M[AstaBrief-8B via local OpenAI-compatible endpoint]
  M --> P[Parse: strip think, split SECTION; / TLDR;, map [ID]]
  P --> O[Cited markdown report → canvas / docs]
```

---

## 5. Reference Pipeline: ai2-scholarqa-lib "lite"

- Ai2 points to `api/scholarqa/lite` as starting point for local reports incl. own PDFs. [V blog]
- `ScholarQALite(ScholarQA)`: overrides `generate_report` → one-shot generation instead of quote extraction + clustering. [V]
- `prepare_references_data(reranked_df)`: per paper, sort snippet sentences by `char_offset`, join → reference text; fallback abstract. [V]
- `build_prompt` → `UNIFIED_GENERATION_PROMPT`; `parse_sections` splits on `SECTION;`; `_generate_title` second LLM call for report title. [V]
- Mode switch: env `SQA_MODE=lite` in `scholarqa/app.py`; config `CONFIG_PATH` (default `run_configs/default.json`) key `lite_pipeline_args`. [V]
- Default `lite_pipeline_args.model` = `hosted_vllm/allenai/sqa_basicsftdpo` at an Ai2 Modal `api_base` → Ai2-hosted, not a documented public endpoint; replace with local endpoint. [V config, U public access]
- LLM calls via litellm; `register_model` auto-registers unknown model ids with zero cost → any OpenAI-compatible `api_base` works (`hosted_vllm/<id>` or `openai/<id>`). [V]
- Retrieval default: Semantic Scholar public API (`S2_API_KEY`) snippet search + keyword search; reranker default Modal (`MODAL_TOKEN`, `MODAL_TOKEN_SECRET`) → set `reranker_args` empty to use plain `PaperFinder`. [V]
- Moderation/validation uses `OPENAI_API_KEY` if present (`validate` default true when key set). [V]
- Full ScholarQA = Python stack (FastAPI, litellm, pandas, langsmith). Heavy vs dashboard TS stack → borrow prompt + parser logic, not the service. [E]

---

## 6. Local Run on User Mac (M5 Pro, 48 GB)

Machine state (checked 2026-10-04): `uv` present; no `ollama`, `llama-server`, `mlx_lm`, `vllm` on PATH. [V]

Available weights (HF search 2026-10-04):

| Repo | Format | Note |
|---|---|---|
| `allenai/AstaBrief_8B` | pytorch (.bin, pickle) | official; pin revision SHA; prefer safetensors conversion [V tag, U files] |
| `allenai/AstaBrief_8B_SFT` | pytorch | pre-DPO checkpoint [V] |
| `mradermacher/AstaBrief_8B-i1-GGUF` | GGUF imatrix quants | most downloaded port (~3.0K) [V] |
| `mradermacher/AstaBrief_8B-GGUF` | GGUF static quants | [V] |
| `carlosmstavares/astabrief-8b-gguf` | GGUF F16 / Q4_K_M, Ollama tag | [V] |
| `liodon-ai/AstaBrief_8B-FP8` | FP8 compressed-tensors | vLLM/NVIDIA only; license tag "other" [V] |
| `liodon-ai/AstaBrief_8B-ONNX` | ONNX quantized | license tag "other" [V] |

- No MLX port found. `mlx_lm.convert --hf-path allenai/AstaBrief_8B -q` likely works (Qwen3 arch supported) [U].
- Sizes (Qwen3-8B typical): Q4_K_M ~5 GB, Q8_0 ~8.7 GB, F16 ~16.4 GB [E]. Recommend Q8_0 (quality, fits trivially in 48 GB); Q4_K_M only if RAM-constrained. Citation-precision loss under 4-bit → measure [U].
- Context: prompt carries up to ~50 papers' snippets (lite default `n_rerank` 50); training max 16000 tokens → serve with ≥16k ctx. [V config, E sizing]

Lane A — llama.cpp (preferred; plain OpenAI-compatible server):

```bash
brew install llama.cpp
llama-server -hf mradermacher/AstaBrief_8B-i1-GGUF:Q8_0 \
  -c 16384 --host 127.0.0.1 --port 8093 --jinja
# OpenAI-compatible: POST http://127.0.0.1:8093/v1/chat/completions
```

Lane B — Ollama:

```bash
brew install ollama && ollama serve &
ollama pull hf.co/mradermacher/AstaBrief_8B-i1-GGUF:Q8_0
# set num_ctx 16384 (Modelfile PARAMETER or request options); default ctx too small
# OpenAI-compatible: http://127.0.0.1:11434/v1
```

Lane C — transformers/vLLM (model card snippet): Linux + NVIDIA; vLLM not for Mac. [V]

- Bind loopback only (`--host 127.0.0.1`); privacy is the point. [E]
- Perf on M5 Pro: prefill of ~10–16k token prompt dominates; tok/s unmeasured → spike needed. Ai2 51 s figure is datacenter GPU, full pipeline. [U]
- Exact quant tag names (`:Q8_0`) per repo → verify on HF before scripting. [U]

---

## 7. Where It Fits in pi-dashboard

Existing building blocks (verified in repo):

- Custom providers: `~/.pi/agent/providers.json` with `api: "openai-completions"` + `baseUrl` → models appear in registry; Test button probes `GET {baseUrl}/models` (docs/architecture.md, `packages/server/src/package/provider-probe.ts`).
- Model proxy: `POST /v1/chat/completions` on dashboard (`packages/server/src/routes/model-proxy-routes.ts`) fronts registry.
- Retrieval sources: `kb_search` (FTS5 over repo markdown, `packages/kb`), `packages/document-converter` (PDF/DOCX/PPTX → provenance-stamped markdown), pi-web-access `web_search` / `fetch_content`, Semantic Scholar API.
- Output surface: `canvas` tool; dossier convention `docs/research/*.md`.

Candidates:

| # | Integration | Value | Fit |
|---|---|---|---|
| U1 | `literature-brief` skill: retrieve → sft_prompt → local endpoint → parse → markdown + `references` list → canvas | private, fast cited first drafts | HIGH |
| U2 | Draft generator for `docs/research/*` dossiers from fetched sources (web_search + fetch_content excerpts as `SECTION_REFERENCES`) | speeds this very workflow | MEDIUM — out-of-domain risk |
| U3 | Private-PDF report: document-converter ingest → chunk → kb/hybrid search → AstaBrief | sensitive/unpublished docs never leave machine | HIGH |
| U4 | Register endpoint as custom provider (`providers.json`) so dashboard proxy / roles can address it (`@brief`) | single endpoint config, health via Test button | OK as transport only |
| U5 | Use as pi session model / subagent / flow agent model | — | NO — no tool calling, format-locked |
| U6 | Install `allenai/asta-plugins` skills (`npx skills add allenai/asta-plugins -g`) | Asta literature search, PDF index, theories | Separate track: `asta` CLI calls Ai2-hosted APIs (auth); does NOT run AstaBrief locally [V]; skills target Claude Code layout → pi compatibility unverified [U] |

```mermaid
flowchart TB
  subgraph Retrieval
    KB[kb_search / packages/kb]
    DC[document-converter PDF→md]
    WEB[web_search + fetch_content]
    S2[Semantic Scholar snippet API]
  end
  SK[literature-brief skill] --> KB & DC & WEB & S2
  SK -->|sft_prompt| EP[local endpoint 127.0.0.1:8093 llama-server]
  EP -.optional via providers.json.-> PX[dashboard model proxy /v1/chat/completions]
  SK --> OUT[markdown report + refs → canvas / docs/research]
```

Design notes for U1/U3:

- Map retrieved items to stable short IDs; keep `ID → {source path/url, excerpt}` table; post-process `[ID]` into links/footnotes. [E]
- Validate citations: drop/flag `[ID]` not in table; surface `(LLM Memory)` claims distinctly (they are unsourced). [E]
- Budget references to fit ≤16k tokens incl. 4096 output. [E]
- Patch "current year is 2025" line? Changes trained prompt → measure both. [U]
- Endpoint config via env (e.g. `ASTABRIEF_BASE_URL`) or providers.json lookup; no new dashboard server code needed for U1. [E]

---

## 8. Risks / Constraints

- Prompt format lock-in; any template drift degrades output. [V model card]
- Claim-scope overgeneralization not measured by Ai2 → human review required for anything published. [V]
- Official weights are pickle (.bin) → load only pinned revision; prefer GGUF/safetensors. Community quants = unaudited third parties → pin SHA. [E]
- License: base + official = Apache-2.0; liodon ports tagged "other". [V]
- Intended use: research/educational per Ai2 Responsible Use Guidelines. [V]
- Out-of-domain (non-scientific) quality unknown. [U]

---

## 9. Options

- A (cheap spike): install llama.cpp, run Q8_0 GGUF, hand-format sft_prompt with 10–20 excerpts from an existing dossier's sources; measure latency, citation validity, think-block frequency, `[ID]` vs rich-key format. No repo code.
- B (skill): `literature-brief` skill (U1/U3) under a package `.pi/skills/`, TS helper for prompt build + parse; endpoint via env/providers.json. Needs OpenSpec change.
- C (defer): use hosted Asta (asta.allen.ai Fast mode) / asta-plugins for literature tasks; no local model.
- Recommend A → B if spike citation precision acceptable.

---

## 10. Open Questions

- Bare `[ID]` vs rich `[corpus_id | Author | year | Citations]` key — which yields better citations from released checkpoint?
- Q8_0 vs Q4_K_M citation precision delta.
- M5 Pro prefill/decode tok/s at 12–16k prompt.
- Quality on non-scientific corpora (repo docs, meeting transcripts).
- Does asta-plugins skill format load in pi unchanged?
- Is the Ai2 Modal lite endpoint publicly usable? (assume no)

---

## Sources

- https://allenai.org/blog/astabrief
- https://huggingface.co/allenai/AstaBrief_8B
- https://huggingface.co/datasets/allenai/AstaBrief_prompts/blob/main/sft_prompt.txt
- https://huggingface.co/collections/allenai/astabrief
- https://github.com/allenai/ai2-scholarqa-lib/tree/main/api/scholarqa/lite
- https://github.com/allenai/ai2-scholarqa-lib/blob/main/api/run_configs/default.json
- https://github.com/allenai/asta-plugins
- https://huggingface.co/mradermacher/AstaBrief_8B-i1-GGUF
- https://huggingface.co/mradermacher/AstaBrief_8B-GGUF
- https://huggingface.co/carlosmstavares/astabrief-8b-gguf
- https://asta.allen.ai/
