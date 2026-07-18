import React from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { getSyntaxTheme } from "../../lib/theme/syntax-theme.js";
import { useThemeContext } from "../settings/ThemeProvider.js";
import { detectLanguage } from "./lang-detect.js";
import { OpenFileButton } from "./OpenFileButton.js";
import { ToolResultImages } from "./ToolResultImages.js";
import type { ToolRendererProps } from "./types.js";

export function ReadToolRenderer({ args, status, result, images, context }: ToolRendererProps) {
  const { resolved: theme, themeName } = useThemeContext();
  const syntaxStyle = getSyntaxTheme(theme, themeName);
  const filePath = args?.path as string | undefined;
  const offset = args?.offset as number | undefined;
  const limit = args?.limit as number | undefined;
  const language = detectLanguage(filePath);
  const hasImages = images && images.length > 0;

  const subtitle = [
    offset && `from line ${offset}`,
    limit && `${limit} lines`,
  ].filter(Boolean).join(", ");

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--text-secondary)] font-mono">{filePath ?? "file"}</span>
        {subtitle && <span className="text-[10px] text-[var(--text-muted)]">({subtitle})</span>}
        <OpenFileButton filePath={filePath} line={offset} context={context} />
      </div>

      {status === "running" && !result && !hasImages && (
        <div className="text-xs text-[var(--text-muted)] italic">{i18nT("common.reading", undefined, "Reading…")}</div>
      )}

      {hasImages && (
        <ToolResultImages images={images!} alt={filePath} />
      )}

      {!hasImages && result && (
        <div className="max-h-80 overflow-auto rounded text-xs">
          {language ? (
            <SyntaxHighlighter
              style={syntaxStyle}
              language={language}
              PreTag="div"
              showLineNumbers={true}
              startingLineNumber={offset ?? 1}
              customStyle={{ margin: 0, padding: "0.5rem", fontSize: "12px", background: 'var(--bg-code)' }}
            >
              {result}
            </SyntaxHighlighter>
          ) : (
            <pre className="whitespace-pre-wrap text-[var(--text-secondary)] p-2 bg-[var(--bg-code)] rounded">{result}</pre>
          )}
        </div>
      )}
    </div>
  );
}

