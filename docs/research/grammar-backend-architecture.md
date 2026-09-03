# Research: Grammar Backend Architecture

> Status: **OPEN — undecided**. Recommended first step: land GEC scorer harness, score LanguageTool vs haiku on one dataset, then decide on evidence.

Architecture decision record for the composer "writing" backend. Cross-links: [docs/grammar-checker.md](../grammar-checker.md) (feature doc), [docs/grammar-model-guidance.md](../grammar-model-guidance.md) (model benchmarks).

## Context

Offline backend already IS a Java server: **LanguageTool**.

- Self-hosted, offline. ~25 ms. Deterministic.
- i18n: en/hu already relevant.
- Extensible in Java: custom rules (XML/Java), n-gram confusion data, `disabledRules`, `motherTongue`.
- Gap: grammar/spelling only — no LLM-style rewrite.

## Options

**A. LanguageTool (Java) as primary**

- Self-hosted, offline, ~25 ms, deterministic.
- i18n en/hu. Extensible via XML/Java custom rules, n-gram data.
- Gap: grammar/spelling only. No LLM rewrite.

**B. LLM (current default, haiku)**

- Grammar + writing improvement. ~2–4 s. Per-token cost. Non-deterministic.
- Prompt hardening done.

**C. Hybrid**

- LanguageTool for live auto-check-while-typing (instant).
- LLM only behind manual "improve writing" action.
- Best UX/cost. Needs per-trigger backend + settings/UI work.

## Open Review Questions

1. "Writing" = strict correctness (→ LanguageTool) or also style/clarity rewrite (→ LLM)? Pivotal fork.
2. If Java: stock `erikvl87/languagetool` image, or custom Java service (own rules, premium n-gram data, endpoint shape)? Who owns/deploys it? Current container port mapping un-versioned.
3. Offline/air-gapped or privacy requirement? LLM sends draft to provider; LT on-box.
4. Bundle/auto-start LT (parent change listed this as a **non-goal**) vs keep "bring your own LT server"?
5. Coordinate with parallel `add-grammar-correction-eval` change — its GEC scorer is the right tool to objectively compare LanguageTool vs LLM vs hybrid.

## Recommended First Step

Land the `add-grammar-correction-eval` harness. Score LanguageTool and haiku on the same dataset. Then pick the architecture on evidence.
