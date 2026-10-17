/**
 * Client fetch helper for `POST /api/mermaid/repair` (on-demand AI mermaid repair).
 * The returned source is UNTRUSTED — callers must render it through the normal
 * mermaid render + sanitize path before showing it.
 * See change: add-mermaid-ai-repair.
 */
import type { MermaidRepairData, MermaidRepairErrorCode } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { getApiBase } from "./api-context.js";

/** Failure carrying the server's machine `code` and a human-readable `message`. */
export class MermaidRepairError extends Error {
  readonly code: MermaidRepairErrorCode | "network";
  constructor(code: MermaidRepairErrorCode | "network", message: string) {
    super(message);
    this.name = "MermaidRepairError";
    this.code = code;
  }
}

export async function repairMermaidWithAi(
  code: string,
  error: string,
  signal?: AbortSignal,
): Promise<MermaidRepairData> {
  let res: Response;
  try {
    res = await fetch(`${getApiBase()}/api/mermaid/repair`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, error }),
      ...(signal ? { signal } : {}),
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new MermaidRepairError("network", err instanceof Error ? err.message : "Network error");
  }
  let body: { success?: boolean; data?: MermaidRepairData; error?: string; code?: MermaidRepairErrorCode } | null = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (res.ok && body?.success && body.data && typeof body.data.code === "string") return body.data;
  throw new MermaidRepairError(body?.code ?? "provider_error", body?.error ?? `Request failed (${res.status})`);
}
