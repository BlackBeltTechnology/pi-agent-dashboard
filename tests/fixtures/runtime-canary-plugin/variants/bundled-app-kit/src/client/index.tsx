// Failure variant: built with `unsafeBundleSpecifiers: [app-kit/react]`, so it carries its OWN app-kit context.
// `useAppHost` finds no host provider (the shell's lives in the host copy) → throws inside the claim's boundary.
import { useAppHost } from "@blackbelt-technology/pi-dashboard-app-kit/react";

export function VariantPanel() {
  const host = useAppHost();
  return <div data-testid="variant-bundled-app-kit">{host.mode}</div>;
}
