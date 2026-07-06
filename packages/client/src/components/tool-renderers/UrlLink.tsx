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
 * See change: linkify-tool-output (spec: tool-output-linkification).
 */
export function UrlLink({ href, children }: Props) {
  const onLoopbackClick = useLoopbackLinkOpen();
  if (!/^https?:\/\//i.test(href)) {
    return <span>{children}</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      // Loopback URLs route into the internal live-server split viewer on a
      // plain click; LAN/external links and modifier/middle-click keep the tab.
      onClick={(e) => onLoopbackClick(e, href)}
      // Not draggable so a click-drag that starts on or crosses the link
      // extends the text selection instead of starting a native link-drag.
      draggable={false}
      className="text-blue-400 hover:underline"
    >
      {children}
    </a>
  );
}
