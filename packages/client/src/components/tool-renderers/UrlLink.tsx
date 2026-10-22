import { classifyUrl } from "@blackbelt-technology/pi-dashboard-shared/url-policy.js";
import type React from "react";
import { useLoopbackLinkOpen } from "../../lib/use-loopback-link-open.js";

interface Props {
  href: string;
  children: React.ReactNode;
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
 * See change: linkify-tool-output (spec: tool-output-linkification),
 * harden-client-sinks (D3).
 */
export function UrlLink({ href, children }: Props) {
  const onLoopbackClick = useLoopbackLinkOpen();
  const cls = classifyUrl(href, typeof window === "undefined" ? null : window.location.origin);
  if (cls === "blocked" || cls === "mailto" || !/^https?:\/\//i.test(href)) {
    return <span>{children}</span>;
  }
  return (
    <a
      // client-sinks: allow — href classified above via classifyUrl (http/https only)
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      // Loopback URLs route into the internal live-server split viewer on a
      // plain click; LAN/external links and modifier/middle-click keep the tab.
      onClick={(e) => onLoopbackClick(e, href)}
      // Not draggable so a click-drag that starts on or crosses the link
      // extends the text selection instead of starting a native link-drag.
      draggable={false}
      // `--link` is mode-aware (#60a5fa dark / #2563eb light); the raw
      // `blue-400` it replaces was tuned on a dark ground and measured
      // 1.80–2.52:1 on `--bg-code` in all 9 light themes.
      // See change: repair-tool-error-surfaces (test-plan #F8).
      className="text-[var(--link)] hover:underline"
    >
      {children}
    </a>
  );
}
