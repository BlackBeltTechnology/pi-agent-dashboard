# Grammar Model Guidance

Composer grammar check = LLM-only backend. No backend selection—grammar calls `/api/grammar/check` with the configured model. Recommendation driven by latency/quality/cost tradeoffs.

## Configuration

Enable in Settings → Plugins → "Grammar & Spelling". Disabled by default: `plugins.grammar.enabled=false`. Pick model via selector (fed by `GET /api/models`). Config stored as `plugins.grammar.llm.{provider, model}` in `~/.pi/dashboard/config.json`.

Returns empty result `backend_unconfigured` until model selected. Opt-in only; no seeded default.

## Recommended Models

All latencies measured on one grammar+spelling+style prompt, single-turn, draft ~150 chars. Tradeoff axes: correctness (quality), latency (speed), per-token cost.

| Model | Latency | Quality | Notes |
|-------|---------|---------|-------|
| **claude-haiku-4-5** | 2.4–4 s | ✓ Grammar + spelling + style | **RECOMMENDED DEFAULT.** Fastest working model. Catches errors reliably. Style suggestions present. Cheap per-token. Ideal for composer. |
| claude-sonnet-4-5 | 8 s | ✓✓ High-confidence | Good for slower/more-thorough workflows. More suggestions than haiku. Higher cost. |
| claude-opus-4-5 | 7.3 s | ✓✓✓ Most thorough | Overkill for composer. 8+ suggestions per prompt. Most expensive. Best for critical writing. |
| opus-4-6 | 9.6 s | ✓✓✓ Very thorough | Slower variant of opus. Same quality tier. Avoid unless specific reason. |
| opus-4-1 | 10.4 s | ✓✓✓ Thorough | Even slower. No advantage over opus-4-5. |
| sonnet-4-6 | 15 s | ✓✓ High confidence | Slowest Sonnet. Avoid for interactive composer. |
| gemini-flash-latest | 3–5 s | ✓ Acceptable | Alternative LLM provider. Similar latency to haiku. Quality comparable. Use if Anthropic quota exhausted. |
| gemini-flash-lite-latest | 2–3 s | ✗ TOO WEAK | Fast but unreliable. Returns typos unchanged, empty suggestions. **Do not use.** Documented failure. |

## Latency Floor

No LLM is instant. Network round-trip + model inference floor ≈ 2 seconds minimum. If composer feels slow, the backend latency is the constraint, not the dashboard UI.

## Model Availability

Some model IDs listed by `GET /api/models` may fail instantly with HTTP 502 `backend_unreachable` for a given credential. Provider (Anthropic/Google) rejects the account.

**Workaround:** If a model errors on first call, pick a different one. To diagnose: `POST /api/grammar/check { "text": "test" }` with target model in config, check response `error.code` + message.

## Cost vs Quality Tradeoff

- **Budget-conscious:** `claude-haiku-4-5`. Fast + cheap + acceptable quality.
- **High-quality throughput:** `claude-sonnet-4-5`. 8 s latency, higher cost, more suggestions.
- **Critical writing:** `claude-opus-4-5`. Slowest + most expensive + most thorough. Overkill for most composer use.

## Avoid

- `gemini-flash-lite-latest` — failures documented. Returns unchanged typos, empty suggestions list.
- Older opus/sonnet dated aliases (`opus-4-0`, `sonnet-4-0`, etc.) — many error instantly per provider.

---

See change: grammar-llm-only-with-explore.
