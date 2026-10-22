/**
 * Browser route for a session: `/session/<id>[/diff|/editor]`. Pure and
 * base-free; callers prepend their own origin (server `uiUrl` / `diffUrl`).
 * See change: add-session-ui-deep-links-for-agents (D2).
 */
export type SessionUiView = "diff" | "editor";

export function sessionUiPath(id: string, view?: SessionUiView): string {
  const base = `/session/${encodeURIComponent(id)}`;
  return view ? `${base}/${view}` : base;
}
