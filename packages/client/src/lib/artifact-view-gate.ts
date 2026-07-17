/**
 * Viewport gate for opening an OpenSpec artifact from a badge.
 *
 * Non-mobile → open the in-place dialog (local state, URL unchanged).
 * Mobile     → navigate to the full-page preview route (existing behavior).
 *
 * App owns both `isMobile` and `setArtifactDialog`; this pure function is the
 * decision so App and its unit tests exercise the SAME branch (no duplicated
 * logic in the test). See change: openspec-artifact-dialog-desktop.
 */
export interface ArtifactRef {
  cwd: string;
  changeName: string;
  artifactId: string;
}

export interface ArtifactViewGateHandlers {
  /** Mobile: full-page preview route (via handleReadArtifact → navigate). */
  navigateToPreview: (ref: ArtifactRef) => void;
  /** Non-mobile: open the local-state dialog over the current view. */
  openDialog: (ref: ArtifactRef) => void;
}

export function openArtifactForViewport(
  isMobile: boolean,
  ref: ArtifactRef,
  handlers: ArtifactViewGateHandlers,
): void {
  if (isMobile) handlers.navigateToPreview(ref);
  else handlers.openDialog(ref);
}
