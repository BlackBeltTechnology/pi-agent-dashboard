/**
 * Who opened a preview, and therefore whether its requests may raise the
 * access-grant dialog (change: surface-denial-remedy-in-previews, design D4).
 *
 * Fails CLOSED: `usePreviewFetch()` returns the opted-out fetch unless a
 * `PreviewProvenance` provider above it declares `autoOpened: false`. Operator
 * provenance is declared (editor pane per tab, `FilePreviewOverlay`,
 * `ImageLightbox`), never assumed, so an agent-opened surface — or a mount point
 * nobody listed — costs an extra click, never a dialog.
 */
import { createContext, type ReactNode, useContext } from "react";
import { fetchWithoutGrantPrompt } from "./grant-channel.js";

interface Provenance {
  /** True when an agent (canvas auto-open) mounted the viewer, not the operator. */
  autoOpened: boolean;
}

const ProvenanceContext = createContext<Provenance | null>(null);

/** Declare the provenance of every preview rendered beneath. */
export function PreviewProvenance({ autoOpened, children }: { autoOpened: boolean; children: ReactNode }) {
  return <ProvenanceContext.Provider value={{ autoOpened }}>{children}</ProvenanceContext.Provider>;
}

/** The fetch a preview's file-route requests go through. */
export type PreviewFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * The global (capability-carrying) fetch: operator-declared provenance, or an
 * explicit operator click on a notice's Ask for access.
 */
export const eligibleFetch: PreviewFetch = (input, init) => fetch(input, init);

/** Pure resolver, shared by the hook and its tests. */
export function previewFetchFor(provenance: Provenance | null): { fetch: PreviewFetch; optedOut: boolean } {
  return provenance?.autoOpened === false
    ? { fetch: eligibleFetch, optedOut: false }
    : { fetch: fetchWithoutGrantPrompt, optedOut: true };
}

/**
 * The fetch for this preview plus whether it is opted out. Opted out unless a
 * provider declares operator provenance.
 */
export function usePreviewFetch(): { fetch: PreviewFetch; optedOut: boolean } {
  return previewFetchFor(useContext(ProvenanceContext));
}
