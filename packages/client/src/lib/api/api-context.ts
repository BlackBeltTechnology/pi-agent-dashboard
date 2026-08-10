import { createContext, useContext } from "react";

/**
 * React context providing the HTTP base URL for API calls.
 * - Same-origin: "" (empty string, relative URLs work)
 * - Cross-origin: "http://host:port" or "https://host:port"
 */
export const ApiContext = createContext<string>("");

/**
 * Hook to get the API base URL prefix for fetch calls.
 * Usage: `fetch(\`${apiBase}/api/sessions\`)`
 */
export function useApiBase(): string {
  return useContext(ApiContext);
}

/**
 * Derive HTTP base URL from a WebSocket URL.
 * - ws://host:8000/ws  → http://host:8000
 * - wss://host:8000/ws → https://host:8000
 * Returns "" if same-origin (wsUrl matches page origin).
 */
export function deriveApiBase(wsUrl: string): string {
  try {
    const httpUrl = wsUrl
      .replace(/^ws:/, "http:")
      .replace(/^wss:/, "https:");
    const parsed = new URL(httpUrl);
    const wsOrigin = parsed.origin;

    if (typeof window !== "undefined" && wsOrigin === window.location.origin) {
      return "";
    }
    return wsOrigin;
  } catch {
    return "";
  }
}

/**
 * Build-time default API URL from VITE_API_URL env var.
 */
export const VITE_API_URL: string = (import.meta as any).env?.VITE_API_URL ?? "";

// ── Module-level API base for non-React code ──────────────────────
// Set once by App.tsx when the WebSocket URL is known.
// Used by lib helpers (git-api, browse-api) that can't use hooks.

let _apiBase = "";

/** Set the global API base (called from App.tsx). */
export function setGlobalApiBase(base: string): void {
  _apiBase = base;
}

/** Get the current API base for non-React fetch calls. */
export function getApiBase(): string {
  return _apiBase;
}
