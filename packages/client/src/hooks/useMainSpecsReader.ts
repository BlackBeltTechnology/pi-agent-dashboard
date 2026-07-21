import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBase } from "../lib/api/api-context.js";
import { t } from "../lib/i18n/i18n.js";

async function fetchDir(cwd: string, dirPath: string): Promise<string[]> {
  const res = await fetch(`${getApiBase()}/api/file?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(dirPath)}`);
  const body = await res.json();
  if (!body.success) throw new Error(body.error ?? t("file.fetchDirFailed", undefined, "Failed to fetch directory"));
  if (body.data.type !== "directory") throw new Error(t("file.expectedDir", undefined, "Expected a directory"));
  return body.data.entries;
}

async function fetchFile(cwd: string, filePath: string): Promise<string> {
  const res = await fetch(`${getApiBase()}/api/file?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(filePath)}`);
  const body = await res.json();
  if (!body.success) throw new Error(body.error ?? t("file.fetchFileFailed", undefined, "Failed to fetch file"));
  if (body.data.type !== "file") throw new Error(t("file.expectedFile", undefined, "Expected a file"));
  return body.data.content;
}

interface MainSpecsReaderState {
  specNames: string[];
  content: string | undefined;
  isLoading: boolean;
  error: string | undefined;
}

export function useMainSpecsReader(cwd: string): MainSpecsReaderState {
  const [specNames, setSpecNames] = useState<string[]>([]);
  const [content, setContent] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(undefined);
    setContent(undefined);
    setSpecNames([]);

    try {
      const entries = await fetchDir(cwd, "openspec/specs");
      if (controller.signal.aborted) return;

      const sorted = [...entries].sort();
      setSpecNames(sorted);

      const results = await Promise.allSettled(
        sorted.map(async (name) => {
          const specContent = await fetchFile(cwd, `openspec/specs/${name}/spec.md`);
          return { name, content: specContent };
        }),
      );

      if (controller.signal.aborted) return;

      const sections = results
        .filter((r): r is PromiseFulfilledResult<{ name: string; content: string }> => r.status === "fulfilled")
        .map((r) => `<div id="spec-${r.value.name}"></div>\n\n# ${r.value.name}\n\n${r.value.content}`);

      if (sections.length === 0) {
        setContent("*No specs found.*");
      } else {
        setContent(sections.join("\n\n---\n\n"));
      }
      setIsLoading(false);
    } catch (err: any) {
      if (!controller.signal.aborted) {
        setError(err.message ?? t("openspec.loadSpecsFailed", undefined, "Failed to load specs"));
        setIsLoading(false);
      }
    }
  }, [cwd]);

  useEffect(() => {
    load();
    return () => { abortRef.current?.abort(); };
  }, [load]);

  return { specNames, content, isLoading, error };
}
