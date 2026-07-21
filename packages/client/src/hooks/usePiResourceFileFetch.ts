/**
 * Fetches `/api/pi-resource-file?path=...` on mount; re-fetches when
 * `filePath` changes. Wraps source-language detection so the content is
 * fenced as a markdown code block when the extension is recognised.
 *
 * Mirrors the fetch logic that lived in
 * `useContentViews.handleViewPiResourceFile` before overlay-url-routing
 * migrated the pi-resource file overlay to a URL-driven view.
 *
 * See change: overlay-url-routing.
 */
import { useEffect, useState } from "react";
import { getApiBase } from "../lib/api/api-context.js";

const SOURCE_LANG_MAP: Record<string, string> = {
  ".ts": "typescript", ".tsx": "typescript", ".js": "javascript", ".jsx": "javascript",
  ".json": "json", ".sh": "bash", ".bash": "bash", ".zsh": "bash",
  ".py": "python", ".rb": "ruby", ".rs": "rust", ".go": "go",
  ".java": "java", ".kt": "kotlin", ".swift": "swift",
  ".css": "css", ".scss": "scss", ".html": "html", ".xml": "xml",
  ".yaml": "yaml", ".yml": "yaml", ".toml": "toml",
  ".c": "c", ".cpp": "cpp", ".h": "c", ".hpp": "cpp",
  ".sql": "sql", ".graphql": "graphql",
};

function getSourceLanguage(filePath: string): string | null {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return SOURCE_LANG_MAP[ext] ?? null;
}

export interface PiResourceFileFetchResult {
  content?: string;
  isLoading: boolean;
  error?: string;
}

export function usePiResourceFileFetch(filePath: string): PiResourceFileFetchResult {
  const [result, setResult] = useState<PiResourceFileFetchResult>({ isLoading: true });
  useEffect(() => {
    let cancelled = false;
    setResult({ isLoading: true });
    (async () => {
      try {
        const res = await fetch(`${getApiBase()}/api/pi-resource-file?path=${encodeURIComponent(filePath)}`);
        const body = await res.json();
        if (cancelled) return;
        if (body.success) {
          const lang = getSourceLanguage(filePath);
          const content = lang
            ? "```" + lang + "\n" + body.data.content + "\n```"
            : body.data.content;
          setResult({ content, isLoading: false });
        } else {
          setResult({ isLoading: false, error: body.error });
        }
      } catch (err: any) {
        if (cancelled) return;
        setResult({ isLoading: false, error: err?.message ?? String(err) });
      }
    })();
    return () => { cancelled = true; };
  }, [filePath]);
  return result;
}
