/**
 * Read one referenced medium through the authenticated workspace read (`GET /api/file/raw`), the same
 * containment gate as the tab's own file. A 403/404/network error or an over-cap response is `null`
 * ("missing"); the body is not read when `Content-Length` already exceeds `maxBytes`.
 * See change: add-craft-web-media-projects (D2, D5).
 */
export type ReadMedia = (cwd: string, path: string, maxBytes: number) => Promise<ArrayBuffer | null>;

export const readMedia: ReadMedia = async (cwd, path, maxBytes) => {
  try {
    const res = await fetch(`/api/file/raw?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`, { cache: "no-store" });
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length"));
    if (Number.isFinite(len) && len > maxBytes) {
      void res.body?.cancel();
      return null;
    }
    const buf = await res.arrayBuffer();
    return buf.byteLength > maxBytes ? null : buf;
  } catch {
    return null;
  }
};
