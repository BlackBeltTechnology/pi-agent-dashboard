import React from "react";

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
  if (!/^https?:\/\//i.test(href)) {
    return <span>{children}</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-400 hover:underline"
    >
      {children}
    </a>
  );
}
