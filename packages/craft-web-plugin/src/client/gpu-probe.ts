/**
 * Capability probe run by the host BEFORE the iframe exists (a reload to switch
 * renderer would read as a lost instance — design D4): `navigator.gpu` → default
 * build path; else WebGL2 (offscreen canvas) → `?webgl`; neither → no iframe.
 * See change: edit-office-in-pane-with-craft-web.
 */

export interface RendererProbe {
  gpu: boolean;
  webgl2: boolean;
}

export type RendererMode = "default" | "webgl" | "none";

export function probeRenderer(): RendererProbe {
  const gpu = typeof navigator !== "undefined" && "gpu" in navigator && Boolean((navigator as { gpu?: unknown }).gpu);
  let webgl2 = false;
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("webgl2") as WebGL2RenderingContext | null;
    webgl2 = Boolean(ctx);
    ctx?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webgl2 = false;
  }
  return { gpu, webgl2 };
}

export function rendererMode(p: RendererProbe): RendererMode {
  if (p.gpu) return "default";
  return p.webgl2 ? "webgl" : "none";
}
