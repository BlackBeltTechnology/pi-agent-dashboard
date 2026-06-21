/**
 * Base64url encode/decode for folder paths in shell-overlay-route URLs.
 * Mirrors the shell's `packages/client/src/lib/folder-encoding.ts` so the
 * automation board route shape (`/folder/:encodedCwd/automations`) matches the
 * OpenSpec board route. See change: fix-automation-slot-parity-and-routing.
 */

export function encodeFolderPath(cwd: string): string {
  // UTF-8 encode first so non-ASCII folder names don't throw in btoa.
  const bytes = new TextEncoder().encode(cwd);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function decodeFolderPath(encoded: string): string | null {
  try {
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const pad = (4 - (padded.length % 4)) % 4;
    const binary = atob(padded + "=".repeat(pad));
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
