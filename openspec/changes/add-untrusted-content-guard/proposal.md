## Why

Agents in pi read content written by strangers: email (the upcoming Gmail plugin), fetched web pages, search results. That content can carry *indirect prompt injection*: instructions aimed at the model, often **hidden** from the human. Examples: zero-width or Unicode-tag characters, BIDI overrides, ANSI escapes, `display:none` / white-on-white / `font-size:0` HTML, and HTML comments. Model-based classifiers are probabilistic and cost a model call per result. Hidden-payload channels, by contrast, can be detected **deterministically** and unit-tested with exact assertions. The strongest cheap defence is a policy: once untrusted content has entered a run, write-class tools need a human confirmation.

No pi extension does this today. It is useful beyond Gmail, so it ships as a standalone, reusable pi extension package that works with or without the dashboard.

## What Changes

- New pi-package `packages/untrusted-content-guard` (extension only, no dashboard dependency).
- A deterministic **scanner** (pure functions, zero runtime dependencies except an HTML tokenizer). Layers:
  - Invisible and format characters: zero-width, Unicode tags U+E0000–E007F, BIDI controls in non-RTL text, variation-selector runs. Legitimate joiners and RTL marks are preserved.
  - ANSI/terminal escapes.
  - Human-hidden HTML: `display:none`, `visibility:hidden`, `font-size:0`, `opacity:0`, text colour equal to background, off-screen positioning, `<!-- comments -->`, `hidden` attribute. Removal works by source ranges and never re-serialises the document.
  - Mixed-script confusables in link text and domains.
  - `data:` URLs (replaced), and markdown/HTML images with query strings to non-allowlisted hosts (reported only, low severity).
  - A small, versioned rule list of instruction-like phrases, reported as *low-confidence* findings only.
- A `tool_result` hook. For tools marked untrusted, it:
  - neutralises hidden payloads (per mode: warn, strip or block);
  - wraps the result in **spotlighting** delimiters carrying a per-run random marker;
  - appends a one-line findings summary.

  A tool is marked untrusted by a configured glob list or by the tool's own result `details.untrusted === true`.
- A `before_agent_start` guideline explaining the delimiters: content inside is data, never instructions.
- **Taint policy.**
  - Taint is set when an assistant message *contains* a call to an untrusted tool (so parallel sibling calls are gated), or when an untrusted result arrives.
  - While tainted, configured *sensitive* tools (default includes `bash` and `*_send` / `*_reply` / `*_delete` / `*_trash` / `*_modify`) require `ctx.ui.confirm`. With no UI, the call is blocked.
  - Taint resets on the next input (`taintScope: run`), or never (`session`), or via `/guard-clear`.
- **Extension declaration API** (`Symbol.for("pi.untrusted-content-guard")`). Tool-owning extensions declare their tools untrusted or self-confirming, so the guard stays generic and doesn't double-prompt.
- Settings: `mode: off | warn | strip | block`, `untrustedTools`, `sensitiveTools`, `allowHosts`, `taintScope`, `preset`.

## Capabilities

### New Capabilities
- `untrusted-content-guard`: deterministic hidden-payload detection and neutralisation, spotlighting of untrusted tool results, and taint-gated confirmation of sensitive tools, packaged as a reusable pi extension.

### Modified Capabilities
<!-- none -->

## Impact

- **New package** `packages/untrusted-content-guard/` (`pi.extensions` manifest, `pi-package` keyword).
  - Optionally listed in `packages/shared/src/recommended-extensions.ts`.
- **Dependency:** one permissive HTML tokenizer (`htmlparser2`, MIT) for the hidden-HTML layer. Everything else is zero-dependency.
- **No change to existing packages.** Consumers opt in by marking results untrusted or by configuring globs.
- **Token cost:** a small constant (delimiters + one guideline line + a summary line only when findings exist).
- **Rollback:** uninstall or `mode: off`.

## Discipline Skills

- `security-hardening`: this *is* the untrusted-input boundary. Threat model per layer, and bypass tests.
- `performance-optimization`: the scanner runs on every marked result. Linear-time layers, a 2 MB truncation cap, and a linear-complexity test.
- `review-code`: before commit.
