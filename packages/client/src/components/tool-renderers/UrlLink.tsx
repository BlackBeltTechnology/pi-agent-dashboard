import { classifyUrl } from "@blackbelt-technology/pi-dashboard-shared/url-policy.js";
import type React from "react";
import { classifyLink } from "../../lib/chat/classify-link.js";
import { useWebLinkOpen } from "../../lib/use-web-link-open.js";
import { useInTranscript } from "../chat/LinkResolutionProvider.js";
import { LinkIconSlot } from "./LinkIconSlot.js";
import type { ToolContext } from "./types.js";

interface Props {
  href: string;
  children: React.ReactNode;
  /** The link's tool context: its `sessionId` decides whether a plain click opens in the editor pane (design D7). */
  context?: ToolContext;
}

/**
 * Thin <a> wrapper used by the tool-output linkifier.
 *
 * Safety: scheme MUST be http/https. The tokenizer already enforces this,
 * but UrlLink rechecks so a forged `javascript:` / `data:` href cannot
 * escape this gate even if the upstream tokenizer were bypassed.
 *
 * The verdict delegates to the shared `classifyUrl` (control characters,
 * backslashes, non-http schemes → blocked); the absolute-http(s) regex stays
 * as this component's stricter floor (no relative / mailto links).
 *
 * Transcript only (inside a `LinkResolutionProvider`): a provider icon, a short label for an autolink (text equal to
 * the URL; the full URL stays in `data-copy-text` for copy and in `title` / `aria-description`). Anywhere else the DOM
 * is exactly the pre-change one.
 *
 * See change: linkify-tool-output (spec: tool-output-linkification),
 * harden-client-sinks (D3), rich-chat-links (D7/D8/D9).
 */
export function UrlLink({ href, children, context }: Props) {
  const onWebClick = useWebLinkOpen(context);
  const inTranscript = useInTranscript();
  const cls = classifyUrl(href, typeof window === "undefined" ? null : window.location.origin);
  if (cls === "blocked" || cls === "mailto" || !/^https?:\/\//i.test(href)) {
    return <span>{children}</span>;
  }
  const rich = inTranscript ? classifyLink(href) : null;
  const shortened = rich !== null && children === href && rich.label !== href;
  return (
    <a
      // client-sinks: allow — href classified above via classifyUrl (http/https only)
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      // Loopback URLs route into the internal live-server split viewer on a plain click; other http(s) links open
      // in the editor pane only for the pane's own session. Modifier/middle-click keep the browser tab.
      onClick={(e) => onWebClick(e, href)}
      {...(rich ? { title: href, "aria-description": href } : {})}
      {...(shortened ? { "data-copy-text": href } : {})}
      // Not draggable so a click-drag that starts on or crosses the link
      // extends the text selection instead of starting a native link-drag.
      draggable={false}
      // `--link` is mode-aware (#60a5fa dark / #2563eb light); the raw
      // `blue-400` it replaces was tuned on a dark ground and measured
      // 1.80–2.52:1 on `--bg-code` in all 9 light themes.
      // See change: repair-tool-error-surfaces (test-plan #F8).
      className="text-[var(--link)] hover:underline"
    >
      {rich && <LinkIconSlot glyph={rich.icon} />}
      {shortened ? rich.label : children}
    </a>
  );
}
