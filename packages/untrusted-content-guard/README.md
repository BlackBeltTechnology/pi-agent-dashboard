# pi-untrusted-content-guard

A pi extension that defends against **indirect prompt injection** in content written by strangers: web pages, search results, email. It works with or without the pi dashboard.

It does three things:

1. **Detects and neutralises hidden payloads**, deterministically, in the results of untrusted tools.
2. **Spotlights** those results: wraps them in delimiters with a per-run random marker, and tells the model that delimited text is data, not instructions.
3. **Gates sensitive tools** (default: `bash`, `*_send`, `*_reply`, `*_delete`, `*_trash`, `*_modify`). Once untrusted content has entered a run, each of these needs a human confirmation.

```
<<untrusted source="fetch_content" id="k7Q2xY9a">>
…cleaned content…
<</untrusted id="k7Q2xY9a">>
[guard] 2 hidden spans removed (unicode-tags, html-display-none)
```

## Install

```bash
pi install npm:@blackbelt-technology/pi-untrusted-content-guard
```

It is active on install, in `strip` mode. To roll back, set `mode: "off"` or uninstall.

## Settings

Add settings under the key `untrusted-content-guard` in `~/.pi/agent/settings.json` or in the project's `.pi/settings.json`. Project settings apply **only when the project is trusted**, so an untrusted repository cannot switch the guard off.

| Key | Default | Meaning |
|---|---|---|
| `mode` | `"strip"` | `off` does nothing. `warn` keeps content and appends a summary. `strip` removes hidden payloads and appends a summary. `block` replaces a result that has any high finding with a notice. Every mode except `off` spotlights and taints. A blocked result still taints. |
| `untrustedTools` | `["fetch_content", "web_search", "get_search_content"]` | Tool-name globs whose results are untrusted. |
| `sensitiveTools` | `["bash", "*_send", "*_reply", "*_delete", "*_trash", "*_modify"]` | Tool-name globs that need confirmation while the run is tainted. |
| `allowHosts` | `[]` | Hosts (subdomains included) whose query-string images are not reported. |
| `taintScope` | `"run"` | `run` resets the taint on the next input of any source. `session` never resets it automatically. |
| `preset` | — | `"strict"` adds `write` and `edit` to `sensitiveTools` and sets `taintScope: "session"`, unless `taintScope` is set explicitly. |

`/guard-clear` resets the taint by hand, in either scope.

## Threat model, per layer

The scanner is a pipeline of pure layers that always run in the same order: size cap → HTML → Unicode → ANSI → URL → phrases. The same input always gives the same output and findings. Each finding has a layer id, a severity (`high` / `low`), a count, and a sample of at most 80 characters in which invisible code points are shown as `U+XXXX`.

| Layer | Attack | High (removed in strip/block) | Preserved / low |
|---|---|---|---|
| Size cap | Hiding a payload past a scan limit | Content over 2 MiB is truncated before scanning: `oversize_truncated`. Nothing reaches the model unscanned. | — |
| Unicode | Invisible text: ASCII smuggled in tag characters, zero-width splits (`pay` + U+200B + `pal`), BIDI reordering (Trojan Source) | Zero-width chars; tags U+E0000–E007F; two or more variation selectors in a row, or one on a non-emoji base; BIDI embed, override and isolate controls in text with no RTL script | ZWJ/ZWNJ in emoji sequences and Brahmic/Arabic clusters; ZWSP next to Thai, Lao, Khmer, Myanmar or CJK; LRM/RLM. BIDI controls in RTL text are reported low and kept. |
| ANSI | Terminal escapes that hide or rewrite text | CSI/OSC/ESC sequences | — |
| HTML | Text a human never sees | `display:none`, `visibility:hidden`, `font-size:0`, `opacity:0`, text colour equal to background colour on the same element, off-screen absolute positioning, the `hidden` attribute, `<script>` contents, comments. Styles come from inline `style` and from `<style>` rules with a single type, `.class` or `#id` selector. | Rules with more complex selectors that hide text are reported low (`unresolved_css`) and not applied. |
| URL | Exfiltration and lookalikes | `data:` URLs (strip/block replace them with `[data-url removed: <mime>, <n> bytes]`) | Images with a query string pointing to a host not in `allowHosts` (`tracking-image`). Mixed-script link text or domains (`confusable`). Both are reported low and never removed. |
| Phrases | Visible "ignore previous instructions" text | — | A small, versioned list, reported low only |

**HTML handling.** Content is treated as HTML only if `details.contentType` is `text/html`, or if it starts with `<!doctype html` or `<html`. Code that merely mentions tags is never parsed. Hidden elements are removed **by source range**, so the document is never re-serialised. Visible text nodes are decoded, so `&#8203;` is caught. If cleaning changes a text node, only that node's range is rewritten. Every other byte stays identical. Plain text is never entity-decoded: a literal `&#8203;` in plain text is visible and harmless. If the parser throws, the guard falls back to the plain-text layers and reports a high `html_parse_failed` finding.

## Limits (read these)

- **Visible persuasive text cannot be detected deterministically.** The phrase rules are advisory only. Spotlighting lowers the risk, and the **taint gate is the control that actually enforces**.
- **Taint does not follow files.** If untrusted content is saved to disk and later read with `read` or `bash`, that read does not taint the run, unless you add those tools to `untrustedTools`.
- After a reset, untrusted text is still in the context. Also, an extension that injects input (for example automation continuations) resets the taint in `run` scope. Use `session` scope where that matters.
- The guard does not compute colour inheritance, the CSS cascade beyond simple selectors, or images.
- It does not defend against a malicious extension running in the same process.

## For tool authors: declare your tools

**Per result:** return `details.untrusted: true`. The guard then processes that result whatever the tool's name. Set `details.contentType: "text/html"` for HTML.

**By name (recommended in addition):** a tool that only self-declares taints the run when its result *arrives*. If the guard knows the name, it taints as soon as the model *calls* the tool, so a sensitive call made in parallel is gated too. Declare names in the shared registry. This needs no dependency on this package and works whichever extension loads first:

```ts
const sym = Symbol.for("pi.untrusted-content-guard");
const reg = ((globalThis as any)[sym] ??= { declarations: [] });
reg.declarations.push({ kind: "untrusted", names: ["gmail_get", "gmail_search"] });
reg.declarations.push({ kind: "selfConfirming", names: ["gmail_send"] }); // you prompt yourself; the guard won't double-prompt
```

Only extension code can write declarations. Nothing in a tool input or result is ever copied into the registry.

## Attribution

The layer list and test ideas draw on the following prior art. No code was copied:

- [`agent-input-sanitizer`](https://www.npmjs.com/package/agent-input-sanitizer) (Apache-2.0): its per-layer deterministic transforms.
- [`@promptshield/core`](https://www.npmjs.com/package/@promptshield/core) (MIT): Unicode, BIDI and homoglyph checks.
- [`llm-moat`](https://www.npmjs.com/package/llm-moat) (MIT): rule-based injection phrases.
- Microsoft, *Defending Against Indirect Prompt Injection Attacks With Spotlighting* (Hines et al., 2024): the delimiting approach.

The HTML layer uses [`htmlparser2`](https://github.com/fb55/htmlparser2) (MIT).
