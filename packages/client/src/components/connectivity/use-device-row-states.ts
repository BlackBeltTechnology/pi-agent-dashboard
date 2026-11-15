/**
 * Browser-tab device check for the header selector rows (design D9/D11): for another origin's
 * entry whose best route already PROVED its fingerprint, and only when this page holds a
 * companion key for that fingerprint, ask `runDeviceCheck` (prove-first, then one signed
 * `device-status` POST) and reduce the answer to a row state. No key → nothing runs, the row
 * keeps "Status unknown" (a tab can't see another origin's credential, so never "Not paired").
 * A route that proved another identity never has a `best`, so it gets zero POSTs.
 *
 * One round per menu open; a late answer of an earlier open is dropped.
 *
 * See change: device-key-mutual-check (D9, D11, task 5.10, test-plan F6).
 */
import { type DeviceRowState, deviceRowState } from "@blackbelt-technology/pi-dashboard-shared/device-key-proof.js";
import { useEffect, useRef, useState } from "react";
import { runDeviceCheck } from "../../lib/pairing/device-check.js";
import { hasKey } from "../../lib/pairing/device-key.js";
import { logRejection } from "../../lib/report-error.js";
import type { ListEntry } from "../../lib/server-list-model.js";
import { routeBaseUrl } from "../../lib/server-route-check.js";

export type DeviceRows = ReadonlyMap<string, Pick<DeviceRowState, "state" | "tier">>;
const NONE: DeviceRows = new Map();

/** `fingerprint → row state` for the entries of `entries` that this tab can check; empty unless `enabled` and `open`. */
export function useBrowserDeviceStates(entries: readonly ListEntry[], enabled: boolean, open: boolean): DeviceRows {
  const [rows, setRows] = useState<DeviceRows>(NONE);
  const round = useRef<{ asked: Set<string> } | null>(null);

  useEffect(() => {
    if (!open || !enabled) return;
    const mine = { asked: new Set<string>() };
    round.current = mine;
    setRows(NONE);
    return () => {
      if (round.current === mine) round.current = null;
    };
  }, [open, enabled]);

  const signature = entries.map((e) => `${e.fingerprint ?? ""}|${e.isCurrent ? "" : (e.best?.key ?? "")}`).join("\n");
  useEffect(() => {
    const mine = round.current;
    if (!open || !enabled || !mine) return;
    for (const entry of entries) {
      const fingerprint = entry.fingerprint;
      const best = entry.best;
      if (entry.isCurrent || !fingerprint || !best || best.check?.kind !== "proven") continue;
      const asked = `${fingerprint}|${best.key}`;
      if (mine.asked.has(asked)) continue;
      mine.asked.add(asked);
      void (async () => {
        if (!(await hasKey(fingerprint))) return;
        const reply = await runDeviceCheck({ route: routeBaseUrl(best), fingerprint });
        const row = deviceRowState({ credential: "unknowable", keyHeld: true, reply });
        if (round.current === mine) setRows((prev) => new Map(prev).set(fingerprint, { state: row.state, tier: row.tier }));
      })().catch(logRejection("ServerSelector.deviceCheck"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, enabled, signature]);

  return rows;
}
