/** Lazy `module` claim: imported only when the claim first renders. */
export function CanaryLazyPanel() {
  return <div data-testid="canary-lazy-panel" className="grid gap-1 p-2">lazy chunk loaded</div>;
}
