import React from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { getSyntaxTheme } from "../../lib/theme/syntax-theme.js";
import { useThemeContext } from "../settings/ThemeProvider.js";
import { detectLanguage } from "./lang-detect.js";
import { OpenFileButton } from "./OpenFileButton.js";
import type { ToolRendererProps } from "./types.js";

export function WriteToolRenderer({ args, status, result, context }: ToolRendererProps) {
  const { resolved: theme, themeName } = useThemeContext();
  const syntaxStyle = getSyntaxTheme(theme, themeName);
  const filePath = args?.path as string | undefined;
  const content = args?.content as string | undefined;
  const language = detectLanguage(filePath);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--text-secondary)] font-mono">{filePath ?? "file"}</span>
        <OpenFileButton filePath={filePath} context={context} />
      </div>

      {status === "running" && !content && (
        <div className="text-xs text-[var(--text-muted)] italic">{i18nT("common.writing", undefined, "Writing…")}</div>
      )}

      {content && (
        <div className="max-h-80 overflow-auto rounded text-xs">
          {language ? (
            <SyntaxHighlighter
              style={syntaxStyle}
              language={language}
              PreTag="div"
              showLineNumbers={true}
              customStyle={{ margin: 0, padding: "0.5rem", fontSize: "12px", background: 'var(--bg-code)' }}
            >
              {content}
            </SyntaxHighlighter>
          ) : (
            <pre className="whitespace-pre-wrap text-[var(--text-secondary)] p-2 bg-[var(--bg-code)] rounded">{content}</pre>
          )}
        </div>
      )}

      {result && status !== "running" && (
        <div className="text-xs text-[var(--text-tertiary)] italic">{result}</div>
      )}
    </div>
  );
}
