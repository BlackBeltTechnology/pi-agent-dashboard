/**
 * The policy half of a framed preview (change: improve-canvas-html-and-url-ux,
 * D3-D5): provenance → egress, Scripts ⇄ Static toggle + exposure + the operator's
 * "Run scripts" → the policy to request, and the capability minted under it.
 */
import { useState } from "react";
import { usePreviewExposure } from "../../../hooks/usePreviewExposure.js";
import { needsRunScripts, type Opener, wantedPolicy } from "../../../lib/live-preview/preview-policy.js";
import { useLiveCapability } from "./useLiveCapability.js";

export function useFramePolicy(targetId: string, opener: Opener, viewerId: string) {
  const [scriptsOn, setScriptsOn] = useState(true);
  const [runApprovedEpoch, setRunApprovedEpoch] = useState<number | null>(null);
  const exposure = usePreviewExposure();

  const runApproved = runApprovedEpoch !== null && runApprovedEpoch === exposure.epoch;
  const input = { opener, scriptsOn, exposed: exposure.exposed, runScriptsApproved: runApproved };
  const wanted = wantedPolicy(input);
  // Open egress is not gated by exposure, so it neither waits for nor re-mints on the epoch.
  const restricted = wanted.egress === "restricted";
  const { capability, error } = useLiveCapability({
    targetId,
    policy: wanted,
    runScripts: runApproved,
    epoch: restricted ? exposure.epoch : 0,
    viewerId,
    enabled: !restricted || exposure.ready,
    onTouchFailed: exposure.refresh,
  });

  // Scripts withheld although wanted (the server saw a different exposure than we did): offer Run scripts too.
  const withheld = restricted && wanted.scripts && capability != null && !capability.policy.scripts;
  return {
    scriptsOn,
    setScriptsOn,
    exposure,
    runApproved,
    restricted,
    capability,
    error,
    granted: capability?.policy ?? wanted,
    showRun: needsRunScripts(input) || withheld,
    approveRun: () => setRunApprovedEpoch(exposure.epoch),
  };
}
