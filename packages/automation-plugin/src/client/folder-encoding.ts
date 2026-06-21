/**
 * Base64url encode/decode for folder paths in shell-overlay-route URLs.
 * Mirrors the shell's `packages/client/src/lib/folder-encoding.ts` so the
 * automation board route shape (`/folder/:encodedCwd/automations`) matches the
 * OpenSpec board route. See change: fix-automation-slot-parity-and-routing.
 */

export function encodeFolderPath(cwd: string): string {
  return btoa(cwd)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function decodeFolderPath(encoded: string): string | null {
  try {
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const pad = (4 - (padded.length % 4)) % 4;
    return atob(padded + "=".repeat(pad));
  } catch {
    return null;
  }
}
