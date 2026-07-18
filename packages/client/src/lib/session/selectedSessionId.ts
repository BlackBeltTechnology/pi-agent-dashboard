// Pure derivation of the currently selected session id from wouter route matches.
//
// `selectedId` drives `sessionDetail` rendering in App.tsx. Without including the
// `/session/:id/diff` sub-route, `sessionDetail` (and therefore the in-tree
// `<FileDiffView>` branch) collapses to null on desktop and the global
// `<LandingPage>` is shown instead. See change: fix-changed-files-desktop-route.
export function deriveSelectedSessionId(
  match: boolean,
  params: { id?: string } | null | undefined,
  diffMatch: boolean,
  diffParams: { id?: string } | null | undefined,
): string | undefined {
  if (match) return params?.id;
  if (diffMatch) return diffParams?.id;
  return undefined;
}
