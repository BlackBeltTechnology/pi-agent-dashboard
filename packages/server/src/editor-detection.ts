/**
 * Auto-detection of code-server / openvscode-server binary.
 * Checks config override first, then PATH.
 */
import type { EditorDetectionResult } from "@blackbelt-technology/pi-dashboard-shared/editor-types.js";
import type { EditorConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { ToolResolver } from "@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js";

export const BINARIES_TO_CHECK = ["code-server", "openvscode-server"] as const;

/**
 * Look up a binary using the unified ToolResolver, which handles the
 * where/which split (Windows vs Unix), managed-bin paths, and login-shell
 * fallback for GUI apps. Previously used raw `which` which silently failed
 * on Windows. See change: fix-windows-server-parity.
 */
export function whichBinary(name: string): string | null {
  const resolver = new ToolResolver({
    processExecPath: process.execPath,
    useLoginShell: true,
  });
  return resolver.which(name);
}

let cachedResult: EditorDetectionResult | null = null;

/**
 * Detect a code-server compatible binary.
 * Order: config override → code-server on PATH → openvscode-server on PATH.
 * Result is cached after first call; use `resetDetectionCache()` to re-detect.
 *
 * @param config - Editor config with optional binary override
 * @param whichFn - Optional override for the `which` lookup (used in tests)
 */
export function detectCodeServerBinary(
  config: EditorConfig,
  whichFn: (name: string) => string | null = whichBinary,
): EditorDetectionResult {
  if (cachedResult) return cachedResult;

  // 1. Config override
  if (config.binary) {
    cachedResult = { available: true, binary: config.binary };
    return cachedResult;
  }

  // 2. Check PATH in order
  for (const name of BINARIES_TO_CHECK) {
    const resolved = whichFn(name);
    if (resolved) {
      cachedResult = { available: true, binary: resolved };
      return cachedResult;
    }
  }

  cachedResult = { available: false };
  return cachedResult;
}

/** Clear the cached detection result (for re-detection or testing). */
export function resetDetectionCache(): void {
  cachedResult = null;
}
