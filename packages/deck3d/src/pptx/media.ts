/**
 * Media registry: package parts → content-hash named files
 * (`m-<first 12 hex of sha256>.<ext>`), identical bytes stored once, while
 * EACH part keeps its own stable deck asset id (`pptx-` + slugified part
 * path) so a re-import updates the asset in place whatever else changed.
 */
import { createHash } from "node:crypto";
import type { MediaFile } from "./types.js";

export const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  json: "application/json",
  txt: "text/plain",
  ttf: "font/ttf",
  otf: "font/otf",
};

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** `ppt/media/image7.png` → `pptx-ppt-media-image7-png`. */
export function assetIdForPart(part: string): string {
  const slug = part
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `pptx-${slug}`.slice(0, 128);
}

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

export class MediaRegistry {
  /** Stored files, one per distinct content. */
  private byHash = new Map<string, MediaFile>();
  /** One entry per asset id: identical bytes share a FILE but never an id. */
  private byId = new Map<string, MediaFile>();

  /**
   * Register bytes under the asset id `id`. Identical content is stored once
   * (same `m-<sha>.<ext>` file), but every part keeps its own stable id, so a
   * re-import that drops the first of two identical parts leaves the second's
   * id — and every reference to it — intact.
   */
  add(bytes: Uint8Array, ext: string, id: string): MediaFile {
    const existing = this.byId.get(id);
    if (existing) return existing;
    const sha = sha256Hex(bytes);
    let stored = this.byHash.get(sha);
    if (!stored) {
      const e = ext.toLowerCase() === "jpeg" ? "jpg" : ext.toLowerCase();
      stored = { name: `m-${sha.slice(0, 12)}.${e}`, asset: id, mime: MIME_BY_EXT[e] ?? "application/octet-stream", bytes, sha256: sha };
      this.byHash.set(sha, stored);
    }
    const entry: MediaFile = { ...stored, asset: id };
    this.byId.set(id, entry);
    return entry;
  }

  addPart(part: string, bytes: Uint8Array): MediaFile {
    return this.add(bytes, extOf(part), assetIdForPart(part));
  }

  /** Distinct stored files, sorted by name (deterministic write order). */
  files(): MediaFile[] {
    return [...this.byHash.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Every asset id with the file it points at, sorted by id. */
  assetEntries(): MediaFile[] {
    return [...this.byId.values()].sort((a, b) => a.asset.localeCompare(b.asset));
  }
}
