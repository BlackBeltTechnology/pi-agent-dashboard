// Failure variant: built with the preset's TEST-ONLY `unsafeBundleSpecifiers`, so it carries its OWN React copy.
// Its hooks run against a different React than the host's renderer → "Invalid hook call" inside the claim boundary.
import { useState } from "react";

export function VariantPanel() {
  const [n] = useState(1);
  return <div data-testid="variant-bundled-react">{n}</div>;
}
