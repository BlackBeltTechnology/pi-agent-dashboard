/**
 * The one paired-state label set shared by the header selector, Settings ▸ Servers and the
 * Electron list: "This dashboard", "Needs pairing", plus the seven device-check states. The
 * device-check state (when there is one) wins over the coarse keyring/tab state; a keyring
 * entry before any answer reads "Paired", a tab with no answer for another origin reads
 * "Status unknown" — never "Not paired".
 *
 * See change: device-key-mutual-check (D11, task 5.10, test-plan F5).
 */
import type { DeviceRowStateId, DeviceTier } from "@blackbelt-technology/pi-dashboard-shared/device-key-proof.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import type { ListEntry } from "../../lib/server-list-model.js";

function tierText(tier: DeviceTier): string {
  switch (tier) {
    case "observe":
      return i18nT("connection.paired.tier.observe", undefined, "Observe");
    case "control":
      return i18nT("connection.paired.tier.control", undefined, "Control");
    case "operate":
      return i18nT("connection.paired.tier.operate", undefined, "Operate");
  }
}

/** Label of one device-check row state. */
function deviceStateText(state: DeviceRowStateId, tier?: DeviceTier): string {
  switch (state) {
    case "paired":
      return tier
        ? i18nT("connection.paired.pairedTier", { tier: tierText(tier) }, "Paired · {tier}")
        : i18nT("connection.paired.paired", undefined, "Paired");
    case "paired-status-only":
      return i18nT("connection.paired.statusOnly", undefined, "Paired · status only");
    case "access-removed":
      return i18nT("connection.paired.accessRemoved", undefined, "Access removed");
    case "access-expired":
      return i18nT("connection.paired.accessExpired", undefined, "Access expired");
    case "not-paired":
      return i18nT("connection.paired.notPaired", undefined, "Not paired");
    case "key-pending":
      return i18nT("connection.paired.keyPending", undefined, "Paired · key pending");
    case "status-unknown":
      return i18nT("connection.paired.statusUnknown", undefined, "Status unknown");
  }
}

export function pairedStateText(entry: Pick<ListEntry, "pairedState" | "deviceState" | "tier">): string {
  if (entry.pairedState === "this-dashboard") return i18nT("connection.paired.thisDashboard", undefined, "This dashboard");
  if (entry.deviceState) return deviceStateText(entry.deviceState, entry.tier);
  switch (entry.pairedState) {
    case "paired":
      return deviceStateText("paired");
    case "needs-pairing":
      return i18nT("connection.paired.needsPairing", undefined, "Needs pairing");
    case "not-paired":
      return deviceStateText("not-paired");
    case "unknown-in-this-tab":
      return deviceStateText("status-unknown");
  }
}
