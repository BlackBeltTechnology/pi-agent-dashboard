/**
 * Per-provider setup-step model for the Gateway setup guide (D3 taxonomy).
 *
 * Step kinds gate what the UI may do:
 *   - `install`      — copy-paste + live ✓ detection (needs elevation; never auto-run).
 *   - `auth-token`   — token field + Authenticate → whitelisted server recipe.
 *   - `activate`     — Connect/Enable → whitelisted server recipe (no sudo).
 *   - `browser-auth` — open an auth URL the daemon prints.
 *   - `external`     — link only (admin-console gates we cannot automate).
 *
 * The server enforces the real security boundary (validated param, fixed
 * recipe); this model is presentational + which button to show.
 *
 * See change: add-tunnel-providers.
 */
import type { GatewayProviderId } from "./gateway-providers.js";

export type SetupStepKind = "install" | "auth-token" | "activate" | "browser-auth" | "external";

export interface SetupStep {
  kind: SetupStepKind;
  title: string;
  /** install: the copy-paste command (macOS/brew shown; others in docs). */
  command?: string;
  /** auth-token/activate: the enroll `step` id passed to the server recipe. */
  enrollStep?: string;
  /** auth-token/activate: placeholder + client hint for the validated param. */
  paramPlaceholder?: string;
  /** browser-auth/external: the link target. */
  href?: string;
}

export const GATEWAY_SETUP_STEPS: Record<GatewayProviderId, SetupStep[]> = {
  zrok: [
    { kind: "install", title: "Install the zrok client", command: "brew install openziti/tap/zrok" },
    {
      kind: "auth-token",
      title: "Enable this environment",
      enrollStep: "auth-token",
      paramPlaceholder: "zrok enable token",
    },
  ],
  ngrok: [
    { kind: "install", title: "Install the ngrok client", command: "brew install ngrok" },
    {
      kind: "auth-token",
      title: "Add your authtoken",
      enrollStep: "auth-token",
      paramPlaceholder: "ngrok authtoken",
    },
  ],
  tailscale: [
    { kind: "install", title: "Install the Tailscale client", command: "brew install tailscale" },
    {
      kind: "auth-token",
      title: "Authenticate this device",
      enrollStep: "auth-token",
      paramPlaceholder: "tskey-auth-…",
    },
    { kind: "browser-auth", title: "…or sign in via browser", href: "#browser-auth" },
    { kind: "external", title: "Enable MagicDNS", href: "https://login.tailscale.com/admin/dns" },
    // NB: tailscale has NO server-side `activate` enroll recipe (only
    // `auth-token`; see tunnel-enroll.ts ENROLL_STEPS). Connect/advertise runs
    // through the Gateway connect path, not a whitelisted enroll step — so no
    // `activate` step here (it would 400 unknown-step).
  ],
  zerotier: [
    { kind: "install", title: "Install the ZeroTier client", command: "brew install --cask zerotier-one" },
    {
      kind: "activate",
      title: "Join your network",
      enrollStep: "activate",
      paramPlaceholder: "16-hex network id",
    },
    {
      kind: "external",
      title: "Authorize this node in the controller",
      href: "https://my.zerotier.com/network",
    },
  ],
};
