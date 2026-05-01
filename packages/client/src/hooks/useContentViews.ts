/**
 * Content view state and fetch logic for pi resources, file preview, and README preview.
 * Extracted from App.tsx.
 */
import { useState, useCallback } from "react";
import { getApiBase } from "../lib/api-context.js";

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

export interface PiResourceFilePreview {
  filePath: string;
  title: string;
  content?: string;
  isLoading: boolean;
  error?: string;
}

export interface ReadmePreview {
  cwd: string;
  content?: string;
  isLoading: boolean;
  error?: string;
}

export interface UseContentViewsOptions {
  /** Called before opening a new top-level content view, so the caller can clear other views. */
  onBeforeOpen?: () => void;
  /**
   * When set, `handleOpenPiResources` / `handleViewPiResourceFile` /
   * `handleViewReadme` will call `navigate("/")` if `settingsMatch` or
   * `tunnelSetupMatch` is currently true. Closes the URL-route view
   * (Settings / Tunnel) BEFORE the overlay state is set so the overlay
   * isn't masked by the JSX gate.
   * See change: fix-desktop-back-navigation.
   */
  navigate?: (to: string) => void;
  settingsMatch?: boolean;
  tunnelSetupMatch?: boolean;
}

export function useContentViews(options?: UseContentViewsOptions) {
  const [piResourcesState, setPiResourcesState] = useState<{ cwd: string } | null>(null);
  const [piResourceFilePreview, setPiResourceFilePreview] = useState<PiResourceFilePreview | null>(null);
  const [readmePreview, setReadmePreview] = useState<ReadmePreview | null>(null);

  const clearAll = useCallback(() => {
    setPiResourcesState(null);
    setPiResourceFilePreview(null);
    setReadmePreview(null);
  }, []);

  const handleOpenPiResources = useCallback((cwd: string) => {
    options?.onBeforeOpen?.();
    if ((options?.settingsMatch || options?.tunnelSetupMatch) && options?.navigate) {
      options.navigate("/");
    }
    setPiResourcesState({ cwd });
    setPiResourceFilePreview(null);
    setReadmePreview(null);
  }, [options?.onBeforeOpen, options?.settingsMatch, options?.tunnelSetupMatch, options?.navigate]);

  const handleViewPiResourceFile = useCallback(async (filePath: string, title: string) => {
    if ((options?.settingsMatch || options?.tunnelSetupMatch) && options?.navigate) {
      options.navigate("/");
    }
    setPiResourceFilePreview({ filePath, title, isLoading: true });
    try {
      const res = await fetch(`${getApiBase()}/api/pi-resource-file?path=${encodeURIComponent(filePath)}`);
      const body = await res.json();
      if (body.success) {
        const lang = getSourceLanguage(filePath);
        const content = lang
          ? "```" + lang + "\n" + body.data.content + "\n```"
          : body.data.content;
        setPiResourceFilePreview({ filePath, title, content, isLoading: false });
      } else {
        setPiResourceFilePreview({ filePath, title, isLoading: false, error: body.error });
      }
    } catch (err: any) {
      setPiResourceFilePreview({ filePath, title, isLoading: false, error: err.message });
    }
  }, [options?.settingsMatch, options?.tunnelSetupMatch, options?.navigate]);

  const handleViewReadme = useCallback(async (cwd: string) => {
    options?.onBeforeOpen?.();
    if ((options?.settingsMatch || options?.tunnelSetupMatch) && options?.navigate) {
      options.navigate("/");
    }
    setPiResourcesState(null);
    setPiResourceFilePreview(null);
    setReadmePreview({ cwd, isLoading: true });
    try {
      const res = await fetch(`${getApiBase()}/api/readme?cwd=${encodeURIComponent(cwd)}`);
      const body = await res.json();
      if (body.success) {
        setReadmePreview({ cwd, content: body.data.content, isLoading: false });
      } else {
        setReadmePreview({ cwd, isLoading: false, error: body.error });
      }
    } catch (err: any) {
      setReadmePreview({ cwd, isLoading: false, error: err.message });
    }
  }, [options?.onBeforeOpen, options?.settingsMatch, options?.tunnelSetupMatch, options?.navigate]);

  return {
    piResourcesState, setPiResourcesState,
    piResourceFilePreview, setPiResourceFilePreview,
    readmePreview, setReadmePreview,
    clearAll,
    handleOpenPiResources,
    handleViewPiResourceFile,
    handleViewReadme,
  };
}
