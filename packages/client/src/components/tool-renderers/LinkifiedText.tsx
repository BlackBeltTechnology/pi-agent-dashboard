import React, { useMemo } from "react";
import { tokenize } from "../../lib/linkify-tool-output.js";
import { ErrorBoundary } from "../ErrorBoundary.js";
import { UrlLink } from "./UrlLink.js";
import { FileLink } from "./FileLink.js";
import type { ToolContext } from "./types.js";

interface Props {
  text: string;
  context: ToolContext;
}

/**
 * Renders a tool-output string with URL and file references turned into
 * clickable elements. Tokenisation is memoised per `text` so a re-render
 * with the same string does not re-scan.
 *
 * Fault isolation: an ErrorBoundary falls back to a plain <pre> rendering
 * if anything in the link tree throws, so a tokenizer bug or downstream
 * component error never propagates into ChatView.
 *
 * Selection / copy preservation (D8): all rendered link elements are inline
 * with no padding / margin / user-select overrides so a selection spanning
 * link + plain text copies the original verbatim.
 *
 * See change: linkify-tool-output (spec: tool-output-linkification).
 */
function LinkifiedTextInner({ text, context }: Props) {
  const tokens = useMemo(() => tokenize(text), [text]);
  if (!text) return null;
  return (
    <>
      {tokens.map((tok, i) => {
        if (tok.kind === "text") return <React.Fragment key={i}>{tok.text}</React.Fragment>;
        if (tok.kind === "url") {
          return (
            <UrlLink key={i} href={tok.text}>
              {tok.text}
            </UrlLink>
          );
        }
        // file
        return (
          <FileLink
            key={i}
            path={tok.path}
            line={tok.line}
            col={tok.col}
            context={context}
          >
            {tok.text}
          </FileLink>
        );
      })}
    </>
  );
}

export function LinkifiedText(props: Props) {
  return (
    <ErrorBoundary fallback={<>{props.text}</>}>
      <LinkifiedTextInner {...props} />
    </ErrorBoundary>
  );
}
