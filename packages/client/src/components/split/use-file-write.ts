/**
 * `POST /api/file/write` for the in-pane writers, routed through the split
 * context's `trackedFileWrite` so an own save never raises the changed-on-disk
 * banner: candidates wait for the save and the baseline becomes the response's
 * `sha1`. Outside a provider (or with change detection off) it is a plain POST.
 *
 * `ok` = HTTP 200 + `success`; a non-ok result is a server refusal (409 etc.),
 * which keeps the baseline. A network failure rejects → baseline nulled.
 *
 * See change: gate-changed-on-disk-by-content (D3, tasks 6.5–6.6).
 */

import { useCallback } from "react";
import { getApiBase } from "../../lib/api/api-context.js";
import { useOptionalSplitWorkspace } from "./SplitWorkspaceContext.js";
import { passthroughWrite, type TrackedWriteResult } from "./use-changed-on-disk.js";

export interface FileWriteRequest {
  cwd: string;
  path: string;
  content: string;
  mtime: number;
}

export interface FileWriteResult extends TrackedWriteResult {
  ok: boolean;
  status: number;
  // biome-ignore lint/suspicious/noExplicitAny: server envelope, shape varies by status
  body: any;
  sha1?: string;
}

async function postFileWrite(req: FileWriteRequest, signal?: AbortSignal): Promise<FileWriteResult> {
  const res = await fetch(`${getApiBase()}/api/file/write`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
  let body: FileWriteResult["body"] = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON refusal body
  }
  const ok = res.status === 200 && body?.success === true;
  const sha1 = ok && typeof body?.data?.sha1 === "string" ? body.data.sha1 : undefined;
  return { ok, status: res.status, body, sha1 };
}

/** A `(req) => Promise<FileWriteResult>` that tracks the save in the surrounding split workspace. */
export function useFileWrite(): (req: FileWriteRequest) => Promise<FileWriteResult> {
  const tracked = useOptionalSplitWorkspace()?.trackedFileWrite;
  return useCallback(
    (req) => {
      const run = (signal?: AbortSignal) => postFileWrite(req, signal);
      return tracked ? tracked(req.path, run) : passthroughWrite(run);
    },
    [tracked],
  );
}
