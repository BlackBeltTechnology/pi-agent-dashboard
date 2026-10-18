/**
 * Test seam for the live trust-mode read: a throwaway `$HOME` whose
 * `~/.pi/dashboard/config.json` drives `admissionTrustedNetworks()`.
 * `setTrustConfig` rewrites the file AND drops the mtime+size-gated config
 * snapshot, so a same-millisecond rewrite is always re-read.
 * See change: retire-trusted-networks-bypass.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resetNetworkTrustTelemetryForTests } from "../auth/network-trust-telemetry.js";
import { resetTrustModeForTests } from "../auth/trust-mode.js";
import { resetConfigSnapshot } from "../config-snapshot.js";

interface TrustConfigInput {
  /** `network.trustMode`; omit for "nothing stored". */
  trustMode?: string;
  /** Top-level `trustedNetworks`. */
  trustedNetworks?: string[];
  /** Extra top-level config merged last (e.g. `pairing`). */
  extra?: Record<string, unknown>;
}

export interface TrustModeHome {
  home: string;
  /** Rewrite config.json and force the snapshot to reparse. */
  setTrustConfig(input: TrustConfigInput): void;
  /** Restore `$HOME` and delete the temp dir. */
  restore(): void;
}

/** Point `$HOME` at a fresh temp dir and reset every trust-mode cache. */
export function useTrustModeHome(): TrustModeHome {
  const origHome = process.env.HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "trust-mode-home-"));
  fs.mkdirSync(path.join(home, ".pi", "dashboard"), { recursive: true });
  process.env.HOME = home;
  resetConfigSnapshot();
  resetTrustModeForTests();
  resetNetworkTrustTelemetryForTests();
  return {
    home,
    setTrustConfig(input) {
      const cfg: Record<string, unknown> = { ...(input.extra ?? {}) };
      if (input.trustedNetworks) cfg.trustedNetworks = input.trustedNetworks;
      if (input.trustMode !== undefined) cfg.network = { trustMode: input.trustMode, trustModeOrigin: "operator" };
      fs.writeFileSync(path.join(home, ".pi", "dashboard", "config.json"), JSON.stringify(cfg));
      resetConfigSnapshot();
    },
    restore() {
      if (origHome === undefined) delete process.env.HOME;
      else process.env.HOME = origHome;
      resetConfigSnapshot();
      resetTrustModeForTests();
      resetNetworkTrustTelemetryForTests();
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}
