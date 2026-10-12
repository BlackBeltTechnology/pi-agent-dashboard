/**
 * Client side of the first-run "Create project" action: POST the name to
 * `/api/browse/create-project` and, on success, pin the returned real path
 * through the same optimistic path `AddFoldersDialog.onPin` uses.
 *
 * Never throws: a failure (HTTP error, `success: false`, a non-ApiResponse body
 * such as an older server's Fastify 404, a network error) resolves to
 * `{ ok: false, reason }`, and nothing is pinned. Validation is the server's.
 *
 * See change: streamline-first-run (design D5).
 */
import { getApiBase } from "./api/api-context.js";

export type CreateProjectOutcome =
  | { ok: true; path: string; existed: boolean }
  | { ok: false; /** Server `reason` code, when the body carried one. */ reason?: string };

export interface CreateProjectDeps {
  send: (msg: { type: "pin_directory"; path: string }) => void;
  setPinned: (updater: (prev: string[]) => string[]) => void;
}

export async function createProjectAndPin(name: string, deps: CreateProjectDeps): Promise<CreateProjectOutcome> {
  let body: unknown;
  try {
    const res = await fetch(`${getApiBase()}/api/browse/create-project`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    body = await res.json().catch(() => null);
    const envelope = body as { success?: unknown; data?: { path?: unknown; existed?: unknown }; reason?: unknown } | null;
    if (res.ok && envelope?.success === true && typeof envelope.data?.path === "string") {
      const path = envelope.data.path;
      deps.setPinned((prev) => (prev.includes(path) ? prev : [...prev, path]));
      deps.send({ type: "pin_directory", path });
      return { ok: true, path, existed: envelope.data.existed === true };
    }
    return { ok: false, reason: typeof envelope?.reason === "string" ? envelope.reason : undefined };
  } catch {
    return { ok: false };
  }
}
