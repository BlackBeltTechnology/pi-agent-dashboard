# Grammar Model Guidance

Composer grammar check = LLM-only backend. Provider: `openrouter`. No fallback. Config: Settings → Plugins → "Grammar & Spelling" → Model selector. Stored: `plugins.grammar.llm.{provider,model}` in `~/.pi/dashboard/config.json`.

## Configuration

Enable: `plugins.grammar.enabled=true` (default: `false`).

Returns `backend_unconfigured` until model selected. Opt-in; no seeded default.

## Recommended Models

Benchmark: 11 hard composer-draft cases × 2 repeats, live server. Metrics: recall (% passes) · latency median · p90 · style churn (unsolicited edits on clean text) · errors · price ($/M tokens in·out).

| Model | Recall | Latency (med) | p90 | Style Churn | Errors | Price $/M |
|-------|--------|---------------|-----|-------------|--------|-----------|
| **openai/gpt-4.1-nano** | 100% | 2.5 s | 3.8 s | 0 | 0 | 0.10 / 0.40 |
| amazon/nova-lite-v1 | 100% | 1.0 s | 1.3 s | 3 | Hard-fails code fences (4/4) | 0.06 / 0.24 |
| mistral-small-3.2-24b | 100% | 7.4 s | 11.8 s | 3 | 1 timeout | 0.075 / 0.20 |
| qwen/qwen3-30b-a3b-2507 | 100% | 4.7 s | 5.2 s | 2 | 2 clobber | 0.09 / 0.30 |
| qwen/qwen3-235b-a22b-2507 | 91% | 9.0 s | 15.4 s | 0 | 0 | 0.071 / 0.10 |
| deepseek/deepseek-v4-flash (OLD) | 100% | 11.5 s | 13.4 s | 0 | 2 aborts | 0.10 / 0.20 |

**RECOMMENDED DEFAULT: `openai/gpt-4.1-nano`**

100% recall. ~2.5s median latency. Zero style churn (silent on clean text). Zero errors. ~4.6× faster than old deepseek incumbent.

## Tradeoffs

**Style churn** (unsolicited edits on already-correct text) = primary decider. autoCheck fires ~1200 ms; chatty model = constant false corrections. nano edits zero clean sentences.

**nova-lite:** Fastest (~1s) + cheapest. Adds markdown backticks to correct prose. Hard-fails code-fence drafts (4/4 failures). Speed gain offset by reliability loss.

**qwen3-30b-a3b-2507:** Good balance. 100% recall, 4.7s, 2 churn, 2 errors.

**gpt-4o-mini:** Solid alternative. ~3.5s latency.

## Known Issues

**Code-fence bug:** Drafts containing ``` code fence fail `no JSON object in LLM response` on most models (plugin prompt/parser defect, not model-specific). gpt-4.1-nano only exception.

**Reasoning models cost trap:** 166/266 OpenRouter registry = reasoning models. Example: deepseek-v4-flash (~11.5s; "Flash" = DeepSeek size tier, not speed). Thinking tokens bill as output: real per-check cost likely HIGHER than nano's listed rate.

## Latency Floor

No LLM instant. Network round-trip + inference floor ≈ 2 seconds minimum.

## Avoid

- **Reasoning models** — slow + masked cost (e.g., deepseek-v4-flash, ministral-8b).
- **ministral-8b** — 78% recall.
- **Retired/404 at OpenRouter:** gemini-2.0-flash-001, gemini-2.0-flash-lite-001, llama-3.3-70b:free (502).

---

See change: grammar-openrouter-competition.
