# Research: Processing pi Session Logs into a Knowledge-Graph / Neural Training Pipeline

> **Status:** Research capture (explore mode). Not a design or proposal. To be processed later.
> **Date:** 2026-06-23
> **Goal:** Process all pi session logs into training data for a CPU/GPU neuron-based model that improves LLM context by learning the data, captures knowledge/entities/relations, and builds a knowledge graph (KG) from documents/code.
> **Hard constraints:** Must run on consumer laptops and Apple Silicon (M1+). Must support Linux and macOS.

---

## 0. Executive Summary / TL;DR

The original brief tangles **two different "neural" ambitions** that should be separated:

- **Ambition A — "a model that improves LLM context by learning the data."** The 2025–26 research consensus is that this is a **memory / retrieval system**, *not* a neural net you train on your logs. Knowledge is stored **externally** in a (temporal) knowledge graph and **retrieved** at query time. Fine-tuning a model to absorb log *content* is the weakest option: lossy, non-incremental, hallucination-prone.
- **Ambition B — "a model that builds a KG from docs/code."** This is an **extraction model**, and it is the place where a small trained net earns its keep (cheap, private, on-device entity/relation extraction).

**Recommended priority:** Train/fine-tune a **small extractor (sub-1B SLM, or REBEL-style seq2seq)** first (highest ROI). Add **graph embeddings (KGE/GNN)** and a **re-ranker** only later if retrieval quality demands it.

**Cross-platform decision that drives the stack:**
- **Inference** → standardize on **llama.cpp / GGUF** (runs identically on Linux CPU/CUDA/Vulkan and Apple Metal).
- **Training** → MLX / MLX-LM-LoRA on Apple; PyTorch/transformers on Linux. A **REBEL-style HF seq2seq** model fine-tunes with the *same code on both* platforms — favorable if cross-platform *training* (not just inference) is required.
- Key fork: **"run on both" vs "train on both."** Run-only → train anywhere, ship GGUF. Train-on-both → lean HF/PyTorch + small model, accept slower Apple training.

---

## 1. Problem Reframing

```
AMBITION A: "model that improves LLM context"
   → a MEMORY / RETRIEVAL system. Mostly NOT a trained net.
   → 2025-26 consensus: extract → store in KG → retrieve at query time.

AMBITION B: "model that builds a KG from docs/code"
   → an EXTRACTION model. This is where a small trained net earns its keep.
```

Every serious agent-memory paper surveyed (Zep/Graphiti, REAL, MAGMA, EvoMemKG) stores knowledge **externally** in a graph and retrieves it, rather than baking it into model weights. Fine-tuning on log *content* (to memorize it) is explicitly *not* what the field does for "improving context."

---

## 2. Reference Pipeline (field-converged architecture)

```
  pi session logs (.jsonl)              docs / code
         │                                   │
         ▼                                   ▼
  ┌──────────────────────────────────────────────────┐
  │  1. INGEST + CHUNK + PII scrub                     │
  │     (multi-turn → atomic units; strip secrets)     │
  └──────────────────────────────────────────────────┘
         │
         ▼
  ┌──────────────────────────────────────────────────┐
  │  2. EXTRACT  entities + relations + temporal facts │ ◀── trained model #1
  │     (entity, relation, valid-time, confidence)     │     (the extractor)
  └──────────────────────────────────────────────────┘
         │
         ▼
  ┌──────────────────────────────────────────────────┐
  │  3. NORMALIZE / RESOLVE  (entity dedup, relation   │
  │     canonicalization) ← step OpenIE/GraphRAG skip  │
  │     (KGGen critique: triple soup otherwise)        │
  └──────────────────────────────────────────────────┘
         │
         ▼
  ┌──────────────────────────────────────────────────┐
  │  4. STORE  temporal property graph                 │
  │     (non-destructive updates, fact versions)       │
  └──────────────────────────────────────────────────┘
         │
         ├──────────────► graph embeddings (KGE/GNN)   ◀── trained model #2
         │                                                 (reasoning/ranking)
         ▼
  ┌──────────────────────────────────────────────────┐
  │  5. RETRIEVE  hybrid (vector + graph traversal)    │
  │     inject into LLM context                        │ ◀── trained model #3
  └──────────────────────────────────────────────────┘     (re-ranker, optional)
         │
         ▼
       LLM agent
```

---

## 3. The Three Places a Trained Net Fits

| # | Role | What it does | Train it? | Evidence |
|---|------|-------------|-----------|----------|
| **1** | **Extractor (SLM)** | text → (entity, relation, entity) triples | **Yes — highest ROI.** Fine-tune sub-1B to replace expensive API calls | tiny-entity-extractor, Kastor, LightKGG, REBEL, UniRel |
| **2** | **Graph embedder (KGE/GNN)** | encode KG structure for multi-hop reasoning / ranking | Optional, advanced | "Injecting KGs into LLMs" (KGE-as-tokens), Dual-Reasoning GNN-LLM, Graph Agent |
| **3** | **Re-ranker / filter** | score retrieved subgraph relevance | Optional | "Empowering GraphRAG with Knowledge Filtering" |

**Bet:** #1 first. REBEL emits triples directly (seq2seq); sub-1B fine-tunes already replace GPT-4-class extraction calls. #2/#3 only after a graph exists and retrieval quality is found lacking.

---

## 4. Cross-Platform / Hardware Reality (Linux + M1+)

```
                 TRAINING                    INFERENCE
   Apple M1+   MLX / MLX-LM-LoRA          MLX-LM  OR  llama.cpp (Metal)
   Linux       PyTorch+transformers       llama.cpp (CPU/CUDA/Vulkan)
               (or unsloth on NVIDIA)

   PORTABLE ARTIFACT that runs everywhere:  GGUF  ← llama.cpp eats it on both
```

Decisions that fall out:
- **Inference**: standardize on **llama.cpp / GGUF** — the one runtime identical across Linux laptop, NVIDIA box, and M1. MLX is faster on Apple but Apple-only.
- **Training**: MLX-LM-LoRA trains on Apple → MLX adapters; tooling now **exports Apple-Silicon fine-tunes directly to GGUF** (llama.cpp discussion #19876). On Linux, train with HF/PyTorch. A **REBEL-style HF seq2seq fine-tunes on both** with identical code.
- **llama.cpp practical notes**: Q4_K_M / Q5_K_M recommended on Apple; CPU+GPU hybrid via `-ngl` (n_gpu_layers) splits transformer layers between CPU memory and GPU-accessible unified memory. MLX requires model conversion; community ships GGUF day-zero.

**Feasibility anchors (training on consumer Macs):**
- 1.5M-param GPT trains on M1 Pro in <10 min (LocalMacLLM).
- 53M-param GPT trained on M2 Pro 16GB on TinyStories (nanoGPT-on-MLX).
- nanochat fully ported to MLX (data → tokenizer → pretrain → finetune → chat) on Apple Silicon.
- 16GB M3 can hold a 7B model in unified memory for LoRA (Markaicode).

---

## 5. Best-Practice Distillates (from the papers)

1. **Don't skip normalization (step 3).** KGGen: OpenIE and even Microsoft GraphRAG produce "nearly as many unique relation types as edges" → sparse, disconnected graphs. Entity resolution + relation canonicalization separates a real KG from triple soup.
2. **Make the graph temporal + non-destructive.** Zep/Graphiti and REAL store valid-time intervals and per-fact confidence, and *version* facts rather than overwriting. Matters when understanding of a session evolves.
3. **Logs → dataset.** Split multi-turn conversations into atomic examples; strip PII/secrets early; production traces > synthetic data. For code: coreference + sentence decomposition before extraction (CoDe-KG) measurably helps.
4. **RAG vs GraphRAG is complementary.** RAG wins single-hop factual lookups; GraphRAG wins multi-hop reasoning. Hybrid retrieval (vector + graph traversal) is the practical answer.
5. **Fine-tuning > prompting for KG construction** when a dataset exists (Frontiers study on Llama2/Mistral/Starling) — validates training the extractor over prompting a big model. Dataset size matters.
6. **Code KGs are partly deterministic.** Call graphs, symbol refs, imports extractable via tree-sitter / LSP *without* a neural net. Smart split: learned extraction for prose + deterministic for code.

---

## 6. Annotated Sources / Links

### 6.1 Knowledge Graph Construction (entity/relation extraction, small models)

- **KGGen: Extracting Knowledge Graphs from Plain Text with Language Models** — https://arxiv.org/pdf/2502.09956
  Adds clustering/normalization to fix OpenIE/GraphRAG "triple soup"; the anti-sparsity argument. *Read this.*
- **Wimmics/Kastor** — https://github.com/Wimmics/Kastor
  Modular framework extracting RDF triples from text using shape-aware **SLMs** (SHACL shapes + distilled KG + active fine-tuning). Lightweight, task-specific extractors.
- **LightKGG: Simple and Efficient KG Generation from Textual Data** — https://arxiv.org/pdf/2510.23341
  Democratizes KG extraction via SLMs: context-integrated graph extraction + lightweight topology-enhanced inference.
- **rst0070/tiny-entity-extractor (tiny-graph-extractor)** — https://github.com/rst0070/tiny-entity-extractor
  Sub-1B LLM fine-tuned to extract KG entities/relations, replacing expensive LLM API calls; feeds Neo4j. *Proof of concept for model #1.*
- **CoDe-KG: Automated KG Construction using LLMs and Sentence Complexity Modelling** — https://aclanthology.org/2025.emnlp-main.783.pdf
  Coreference resolution + syntactic sentence decomposition. Releases 150k+ triples dataset + training corpora.
- **Frontiers: Fine-tuning or prompting on LLMs — evaluating KG construction** — https://www.frontiersin.org/journals/big-data/articles/10.3389/fdata.2025.1505877/full
  Zero-shot vs few-shot vs fine-tuning on Llama2/Mistral/Starling; fine-tuning wins, dataset size matters.

### 6.2 Relation Extraction Models (fine-tune targets)

- **Babelscape/REBEL** — https://github.com/Babelscape/rebel
  Seq2seq Relation Extraction (EMNLP 2021); emits triples directly. **Primary fine-tune candidate, cross-platform via HF.**
- **REBEL paper (Findings EMNLP 2021)** — https://aclanthology.org/2021.findings-emnlp.204.pdf
- **UniRel: Unified Representation and Interaction for Joint Relational Triple Extraction (EMNLP 2022)** — https://aclanthology.org/2022.emnlp-main.477/ · PDF: https://aclanthology.org/2022.emnlp-main.477.pdf
- **Receiling/UniRE** (Unified Label Space for Entity Relation Extraction, ACL 2021) — https://github.com/receiling/unire
- **China-ChallengeHub/OneRel** (Joint Entity+Relation Extraction, One Module One Step, AAAI 2022) — https://github.com/China-ChallengeHub/OneRel

### 6.3 GraphRAG (KG-augmented retrieval, best practices)

- **Graph RAG in the Wild: Insights and Best Practices** — https://www.semantic-web-journal.net/system/files/swj4027.pdf
- **Towards Practical GraphRAG: Efficient KG Construction and Hybrid Retrieval at Scale** — https://arxiv.gg/abs/2507.03226 (arXiv 2507.03226)
  Scalable, cost-efficient enterprise GraphRAG; hybrid retrieval for multi-hop.
- **RAG vs. GraphRAG: A Systematic Evaluation and Key Insights** — https://arxiv.org/abs/2502.11371v3
  Complementary behaviors: RAG=single-hop/detail, GraphRAG=multi-hop/reasoning.
- **Empowering GraphRAG with Knowledge Filtering and Integration (EMNLP 2025)** — https://aclanthology.org/2025.emnlp-main.1293.pdf
  Filters noisy retrieved subgraphs; the re-ranker/filter case (model #3).
- **What is GraphRAG: Complete guide [2025] (Meilisearch)** — https://www.meilisearch.com/blog/graph-rag
- **Using a knowledge graph to implement a RAG application (Neo4j)** — https://neo4j.com/blog/developer/rag-tutorial/

### 6.4 GNN ⊗ LLM Integration / Graph Embeddings (model #2)

- **Dual Reasoning: A GNN-LLM Collaborative Framework for KGQA (PMLR)** — https://proceedings.mlr.press/v280/liu25b.html
- **Graph–Language Synergy in Intelligent Information Systems (GNN–LLM, GraphRAG review, ScienceDirect)** — https://www.sciencedirect.com/science/article/abs/pii/S092054892600053X
- **Integrating Graphs, LLMs, and Agents: Reasoning and Retrieval** — https://arxiv.org/pdf/2604.15951
- **Graph Agent (GA): LLM + inductive-deductive reasoning + long-term memory for KG reasoning** — https://arxiv.org/pdf/2310.16421
- **LLM⊗KG tight-coupling paradigm** — https://arxiv.org/pdf/2307.07697
- **Injecting Knowledge Graphs into Large Language Models (KGE-as-tokens)** — https://arxiv.org/html/2505.07554v1
  Embeds KGE vectors as input tokens — structure-preserving without heavy fine-tuning.

### 6.5 Agent Memory / Temporal Knowledge Graphs (Ambition A core)

- **Zep: A Temporal Knowledge Graph Architecture for Agent Memory** — https://arxiv.org/html/2501.13956
  Graphiti engine: dynamic temporally-aware KG; ingests unstructured + structured data; non-lossy updates. **Blueprint for log→memory.**
- **REAL: Reasoning-Enhanced Graph Framework for Long-Term Memory of LLMs** — https://arxiv.org/html/2606.10694v1
  Temporal + confidence-aware directed property graph; atomic facts with entities, relations, valid-time, confidence, intent labels; non-destructive temporal updates preserving fact versions.
- **MemVerse: Multimodal Memory for Lifelong Learning Agents** — https://arxiv.org/abs/2512.03627v1
  Hierarchical retrieval long-term memory + lightweight parametric memory model (fast/slow thinking).
- **MAGMA: Multi-Graph based Agentic Memory Architecture (ACL 2026)** — https://aclanthology.org/2026.acl-long.1709.pdf
  Explicit relational dimensions vs narrative/undifferentiated memory.
- **Graph-based Agent Memory: Taxonomy, Techniques (arXiv)** — https://arxiv.org/html/2602.05665v1
  Survey; graph-based agent memory as the 2025–2026 frontier vs linear/key-value/vector.
- **EvoMemKG: Evolvable Memory Agent for Multi-hop KG Reasoning (Findings ACL 2026)** — https://aclanthology.org/2026.findings-acl.1587.pdf
  Dual-layer evolvable memory; self-evolution vs static memory.

### 6.6 Logs → Training Dataset (ETL, conversation data prep)

- **How to Create Conversational Datasets for LLM Fine-Tuning (Macgence)** — https://macgence.com/blog/llm-fine-tuning-datasets/
  Sources, PII removal, privacy compliance.
- **ETL for AI Agent Training Data (CallSphere)** — https://callsphere.ai/blog/etl-ai-agent-training-data-extracting-transforming-conversation-logs
  Extract → anonymize PII → transform to training format → quality filter; real traces > synthetic.
- **Fine-tuning LLMs for Multi-turn Conversations: A Technical Deep Dive (Together AI)** — https://www.together.ai/blog/fine-tuning-llms-for-multi-turn-conversations-a-technical-deep-dive
  Dataset prep is the hardest/most important part.
- **Upload Traces (distil labs)** — https://www.distillabs.ai/docs/how-to/upload-traces/
  Bootstrap a small model from production traces; convert multi-turn logs to individual examples.
- **Cohere chat fine-tuning data format (jsonl messages/role/content)** — https://github.com/cohere-ai/cohere-developer-experience/blob/0f356c48/fern/pages/v2/fine-tuning/chat-fine-tuning/chat-preparing-the-data.mdx
- **Prepare Training Datasets for LoRA Fine-Tuning (LM-Kit.NET)** — https://docs.lm-kit.com/lm-kit-net/guides/how-to/prepare-training-datasets-for-lora-finetuning.html
  ChatHistory → ChatTrainingSample → ShareGPT JSON → LoRA.

### 6.7 On-Device Training / Inference (Apple Silicon + cross-platform)

- **Get started with MLX for Apple Silicon — WWDC25 (315)** — https://developer.apple.com/videos/play/wwdc2025/315/
- **Explore large language models on Apple silicon with MLX — WWDC25 (298)** — https://developer.apple.com/videos/play/wwdc2025/298/
  Full vs LoRA fine-tuning on-device; data never leaves the Mac; no-code path.
- **Goekdeniz-Guelmez/mlx-lm-lora** — https://github.com/Goekdeniz-Guelmez/mlx-lm-lora
  LoRA/DoRA/full/QLoRA (4/6/8-bit) + QAT training on Apple Silicon; all MLX-LM models.
- **saivishnu2299/LocalMacLLM** — https://github.com/saivishnu2299/LocalMacLLM
  1.5M-param GPT trained on M1 Pro in <10 min; full raw-text → interactive LLM pipeline.
- **scasella/nanochat-mlx** — https://github.com/scasella/nanochat-mlx
  MLX port of Karpathy nanochat; `--depth` dial; full pipeline on Apple Silicon, no PyTorch/cloud.
- **JackSuuu/nanoGPT-on-MLX** — https://github.com/JackSuuu/nanoGPT-on-MLX
  53M-param transformer on M2 Pro 16GB; TinyStories + FineWebEdu.
- **Train Small Language Models Locally with Apple MLX in 30 Minutes (Markaicode)** — https://markaicode.com/train-small-language-models-apple-mlx-locally/
  Unified memory; 16GB M3 holds 7B; no CUDA/cloud.
- **Llama.cpp vs MLX on Apple Silicon (Medium)** — https://medium.com/@michael.hannecke/llama-cpp-vs-mlx-on-apple-mx-775ee59df0ee
  llama.cpp = full inference stack (CPU AVX/NEON, CUDA, ROCm, Metal, Vulkan, SYCL, MUSA), GGUF, quantization.
- **Running Gemma 4 Locally: MLX vs llama.cpp (BirJob)** — https://www.birjob.com/blog/gemma-4-apple-silicon-mlx-vs-llama-cpp
  Q4_K_M / Q5_K_M; Q8_0 KV cache safe; MLX needs conversion, community ships GGUF day-zero.
- **MLX vs llama.cpp on Apple Silicon: Which Runtime (Groundy)** — https://groundy.com/articles/mlx-vs-llamacpp-on-apple-silicon-which-runtime-to-use-for-local-llm-inference/
  mlx-lm wraps MLX for generation + on-device fine-tuning; llama.cpp `-ngl` CPU+GPU hybrid.
- **Built a macOS UI for local fine-tuning (Apple Silicon) → exports to GGUF (llama.cpp #19876)** — https://github.com/ggml-org/llama.cpp/discussions/19876
  Direct Apple-Silicon-finetune → GGUF export path.

---

## 7. Open Questions / Decisions (to resolve before design)

1. **Run vs train cross-platform?** Run-only → train anywhere, ship GGUF. Train-on-both → HF/PyTorch + small model, slower Apple training. (Collapses half the stack choices.)
2. **End goal of the graph?** (a) Answer questions about *past pi sessions* (agent memory, temporal KG, Zep/REAL style) vs (b) produce a *standalone KG artifact* from a codebase/docs (knowledge product). Overlapping architectures, different storage + retrieval.
3. **Scope of trained models?** #1 only (extractor → KG → plain GraphRAG retrieval) vs the GNN/embedding route (#2, research-grade, heavier). Plain GraphRAG ≈ 80% with far less effort.
4. **Code vs prose priority?** Code KGs partly deterministic (tree-sitter / LSP for call graphs, symbol refs, imports) — no neural net needed. Mix learned (prose) + deterministic (code). Which is the priority — pi logs or the codebase?

---

## 8. Recommended Next Steps (sequenced)

1. **Decide Q1 + Q2** (run-vs-train, memory-vs-artifact). Everything downstream depends on these.
2. **Build steps 1 + 3 + 4 first** (ingest/PII-scrub, normalization, temporal store) — these are deterministic and don't need a trained model. Validate the graph shape on real pi logs.
3. **Prototype extraction (step 2) with a prompted big model** to generate a labeled dataset, then **fine-tune a small extractor** (REBEL or sub-1B) on it. (Frontiers: fine-tune > prompt once dataset exists.)
4. **Wire plain GraphRAG retrieval (step 5)** — hybrid vector + graph traversal. Measure.
5. **Only if retrieval is weak**, add #2 (KGE/GNN) and/or #3 (re-ranker).
6. **Standardize inference on GGUF/llama.cpp**; choose training stack per Q1.

### Suggested second research passes (when fork is chosen)
- Deep-dive temporal KG storage engines (Graphiti internals, REAL's versioning) if Ambition A wins.
- Deep-dive the Apple-Silicon-finetune → GGUF export path + MLX-LM-LoRA QLoRA if train-on-both.
- Deep-dive tree-sitter / LSP code-graph extraction if code is the priority.
