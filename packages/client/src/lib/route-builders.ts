/**
 * URL builders for shell-owned overlay routes.
 *
 * Centralises URL construction so callsites can call `navigate(buildXxxUrl(...))`
 * instead of inlining the path string. Single point of failure for typos and
 * encoding mistakes; covered by `__tests__/route-builders.test.ts`.
 *
 * Encoding rules:
 *   - `cwd` segments are base64url-encoded via `encodeFolderPath` so they survive
 *     any filesystem characters (spaces, slashes, Unicode).
 *   - All other dynamic segments are `encodeURIComponent`-encoded so kebab-case
 *     slugs and arbitrary user-supplied identifiers (titles, paths) round-trip
 *     through the URL safely.
 *   - `/pi-resource` uses a query string because the resource path is an
 *     absolute filesystem path that may live outside any pinned folder (e.g.
 *     `~/.pi/agent/.../skill.md`). Encoding it as a path segment would be
 *     awkward.
 *
 * See change: overlay-url-routing.
 */
import { encodeFolderPath } from "./folder-encoding.js";

/** `/folder/:encodedCwd/openspec/:changeName/:artifactId` */
export function buildOpenSpecPreviewUrl(
  cwd: string,
  changeName: string,
  artifactId: string,
): string {
  return `/folder/${encodeFolderPath(cwd)}/openspec/${encodeURIComponent(changeName)}/${encodeURIComponent(artifactId)}`;
}

/** `/folder/:encodedCwd/openspec` — full-page OpenSpec board.
 *  See change: redesign-openspec-board. */
export function buildOpenSpecBoardUrl(cwd: string): string {
  return `/folder/${encodeFolderPath(cwd)}/openspec`;
}

/** `/folder/:encodedCwd/openspec/archive` */
export function buildOpenSpecArchiveUrl(cwd: string): string {
  return `/folder/${encodeFolderPath(cwd)}/openspec/archive`;
}

/** `/folder/:encodedCwd/openspec/specs` */
export function buildOpenSpecSpecsUrl(cwd: string): string {
  return `/folder/${encodeFolderPath(cwd)}/openspec/specs`;
}

/** `/folder/:encodedCwd/pi-resources` */
export function buildPiResourcesUrl(cwd: string): string {
  return `/folder/${encodeFolderPath(cwd)}/pi-resources`;
}

/** `/pi-resource?path=...&title=...` */
export function buildPiResourceFileUrl(path: string, title: string): string {
  const params = new URLSearchParams();
  params.set("path", path);
  params.set("title", title);
  return `/pi-resource?${params.toString()}`;
}

/** `/session/:id/diff` */
export function buildSessionDiffUrl(sessionId: string): string {
  return `/session/${encodeURIComponent(sessionId)}/diff`;
}
