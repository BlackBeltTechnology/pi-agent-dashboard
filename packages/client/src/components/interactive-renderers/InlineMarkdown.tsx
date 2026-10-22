import React from "react";
import ReactMarkdown from "react-markdown";
import { SafeLink } from "../../lib/nav/safe-navigation.js";

interface Props {
  content: string;
}

/**
 * Renders markdown restricted to inline elements only (strong, em, code, a).
 * Block elements like <p>, <ul>, <h1> are unwrapped to their text content,
 * keeping the output suitable for single-line compact layouts.
 */
export function InlineMarkdown({ content }: Props) {
  return (
    <ReactMarkdown
      allowedElements={["strong", "em", "code", "a"]}
      unwrapDisallowed={true}
      components={{
        code({ children, ...props }) {
          return (
            <code
              className="bg-[var(--bg-surface)] px-1 py-0.5 rounded text-[length:inherit] font-mono"
              {...props}
            >
              {children}
            </code>
          );
        },
        a({ children, href, ...props }) {
          return (
            <SafeLink
              href={href}
              className="text-blue-400 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
              {...props}
            >
              {children}
            </SafeLink>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
