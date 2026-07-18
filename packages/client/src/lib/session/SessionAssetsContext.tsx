/**
 * SessionAssetsContext — scopes a per-session image-asset registry to any
 * descendant `MarkdownContent` so `pi-asset:<hash>` srcs can be resolved
 * to `data:` URLs without prop-drilling through every renderer.
 *
 * Default value is an empty Record so non-chat callers (e.g.
 * `PackageReadmeDialog`, `MarkdownPreviewView`) work without a Provider —
 * any `pi-asset:` reference they encounter renders as the unresolved
 * placeholder, which is the same visible state as today's broken-image
 * behavior for any unresolvable URL.
 *
 * See change: chat-markdown-local-images-and-math.
 */
import React, { createContext, useContext } from "react";

export type SessionAssets = Record<string, { data: string; mimeType: string }>;

const EMPTY_ASSETS: SessionAssets = Object.freeze({}) as SessionAssets;

const SessionAssetsContext = createContext<SessionAssets>(EMPTY_ASSETS);

export function SessionAssetsProvider({
  assets,
  children,
}: {
  assets: SessionAssets | undefined;
  children: React.ReactNode;
}) {
  return (
    <SessionAssetsContext.Provider value={assets ?? EMPTY_ASSETS}>
      {children}
    </SessionAssetsContext.Provider>
  );
}

/** Hook returning the active session's asset map (or empty when no provider). */
export function useSessionAssets(): SessionAssets {
  return useContext(SessionAssetsContext);
}
