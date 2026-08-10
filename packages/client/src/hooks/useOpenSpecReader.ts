import type { OpenSpecArtifact } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PreviewTab } from "../components/preview/MarkdownPreviewView.js";
import { getApiBase } from "../lib/api/api-context.js";
import { t } from "../lib/i18n/i18n.js";

const LETTER_MAP: Record<string, string> = {
  proposal: "P",
  design: "D",
  specs: "S",
  tasks: "T",
};

const FULL_NAME_MAP: Record<string, string> = {
  proposal: "Proposal",
  design: "Design",
  specs: "Specs",
  tasks: "Tasks",
};

function statusColor(status: string): string {
  if (status === "done") return "text-green-500";
  if (status === "ready") return "text-yellow-500";
  return "text-[var(--text-muted)]";
}

interface OpenSpecReaderState {
  content: string | undefined;
  isLoading: boolean;
  error: string | undefined;
  tabs: PreviewTab[];
  activeTab: string;
  title: string;
}

async function fetchFile(cwd: string, filePath: string): Promise<string> {
  const res = await fetch(`${getApiBase()}/api/file?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(filePath)}`);
  const body = await res.json();
  if (!body.success) throw new Error(body.error ?? t("file.fetchFileFailed", undefined, "Failed to fetch file"));
  if (body.data.type !== "file") throw new Error(t("file.expectedFile", undefined, "Expected a file"));
  return body.data.content;
}

async function fetchDir(cwd: string, dirPath: string): Promise<string[]> {
  const res = await fetch(`${getApiBase()}/api/file?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(dirPath)}`);
  const body = await res.json();
  if (!body.success) throw new Error(body.error ?? t("file.fetchDirFailed", undefined, "Failed to fetch directory"));
  if (body.data.type !== "directory") throw new Error(t("file.expectedDir", undefined, "Expected a directory"));
  return body.data.entries;
}

async function fetchArtifactContent(cwd: string, changeName: string, artifactId: string, archive?: boolean): Promise<string> {
  const basePath = archive ? `openspec/changes/archive/${changeName}` : `openspec/changes/${changeName}`;

  if (artifactId === "specs") {
    // Fetch directory listing, then fetch all spec.md files in parallel
    const entries = await fetchDir(cwd, `${basePath}/specs`);
    const results = await Promise.allSettled(
      entries.map(async (entry) => {
        const content = await fetchFile(cwd, `${basePath}/specs/${entry}/spec.md`);
        return `# ${entry}\n\n${content}`;
      }),
    );
    const specContents = results
      .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
      .map((r) => r.value);
    if (specContents.length === 0) return "*No specs found.*";
    return specContents.join("\n\n---\n\n");
  }

  return fetchFile(cwd, `${basePath}/${artifactId}.md`);
}

export function useOpenSpecReader(
  cwd: string,
  changeName: string,
  initialArtifact: string,
  artifacts: OpenSpecArtifact[],
  archive?: boolean,
): OpenSpecReaderState {
  // The URL's `:artifactId` segment (passed as `initialArtifact`) is the single
  // source of truth for the active tab. Deriving it here — rather than holding
  // separate state — keeps the visible tab in sync when the route changes while
  // the preview stays mounted. See change: fix-openspec-artifact-tab-url-sync.
  const activeTab = initialArtifact;
  const [content, setContent] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);

  const tabs: PreviewTab[] = artifacts.map((a) => ({
    id: a.id,
    label: FULL_NAME_MAP[a.id] ?? a.id,
    colorClass: statusColor(a.status),
  }));

  const loadContent = useCallback(async (artifactId: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(undefined);
    setContent(undefined);

    try {
      const result = await fetchArtifactContent(cwd, changeName, artifactId, archive);
      if (!controller.signal.aborted) {
        setContent(result);
        setIsLoading(false);
      }
    } catch (err: any) {
      if (!controller.signal.aborted) {
        setError(err.message ?? t("openspec.loadFailed", undefined, "Failed to load"));
        setIsLoading(false);
      }
    }
  }, [cwd, changeName, archive]);

  useEffect(() => {
    loadContent(activeTab);
    return () => { abortRef.current?.abort(); };
  }, [activeTab, loadContent]);

  return {
    content,
    isLoading,
    error,
    tabs,
    activeTab,
    title: changeName,
  };
}
