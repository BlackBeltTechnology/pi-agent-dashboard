/**
 * Media registry: package parts → content-hash named files
 * (`m-<first 12 hex of sha256>.<ext>`), identical bytes stored once, each with
 * a stable deck asset id derived from the first part name that produced it
 * (`pptx-` + slugified part path) so a re-import updates the asset in place.
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
  private byHash = new Map<string, MediaFile>();

  /** Register bytes under the asset id `id` (first registration of the content wins). */
  add(bytes: Uint8Array, ext: string, id: string): MediaFile {
    const sha = sha256Hex(bytes);
    const existing = this.byHash.get(sha);
    if (existing) return existing;
    const e = ext.toLowerCase() === "jpeg" ? "jpg" : ext.toLowerCase();
    const file: MediaFile = {
      name: `m-${sha.slice(0, 12)}.${e}`,
      asset: id,
      mime: MIME_BY_EXT[e] ?? "application/octet-stream",
      bytes,
      sha256: sha,
    };
    this.byHash.set(sha, file);
    return file;
  }

  addPart(part: string, bytes: Uint8Array): MediaFile {
    return this.add(bytes, extOf(part), assetIdForPart(part));
  }

  /** Every file, sorted by name (deterministic write order). */
  files(): MediaFile[] {
    return [...this.byHash.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}
