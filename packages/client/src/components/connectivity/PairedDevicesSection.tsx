/**
 * Settings → Security → Paired Devices.
 * Lists devices paired via QR/copy-string (bearer device auth) and revokes them.
 * Revoke deletes the server-side registry row so the device's token stops working.
 */

import { mdiCellphoneKey, mdiDelete } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useCallback, useEffect, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { listPairedDevices, type PairedDeviceView, revokePairedDevice } from "../../lib/pairing/paired-devices-api.js";

function formatLastSeen(iso: string | null): string {
  if (!iso) return i18nT("common.neverSeen", undefined, "never");
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function PairedDevicesSection() {
  const [devices, setDevices] = useState<PairedDeviceView[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setDevices(await listPairedDevices());
    } catch (e: any) {
      setError(e?.message ?? "failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const handleRevoke = async (id: string) => {
    if (revoking) return; // guard against double-submit
    setRevoking(id);
    try {
      await revokePairedDevice(id);
      setConfirmId(null);
      setError(null);
      await reload();
    } catch (e: any) {
      setError(e?.message ?? "failed to revoke");
    } finally {
      setRevoking(null);
    }
  };

  if (loading) {
    return <div className="text-sm text-[var(--text-muted)]">{i18nT("status.loading2", undefined, "Loading...")}</div>;
  }

  return (
    <div className="space-y-2">
      {error && <div className="text-sm text-[var(--danger,#ef4444)]">{error}</div>}
      {devices.length === 0 ? (
        <div className="text-sm text-[var(--text-muted)] py-1">
          {i18nT("common.noPairedDevices", undefined, "No paired devices. Pair a phone from the pairing view (QR / copy-string).")}
        </div>
      ) : (
        <ul className="space-y-1">
          {devices.map((d) => (
            <li
              key={d.id}
              className="flex items-center gap-2 rounded border border-[var(--border)] px-3 py-2"
            >
              <Icon path={mdiCellphoneKey} size={0.8} className="text-[var(--text-muted)] shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{d.label}</div>
                <div className="text-xs text-[var(--text-muted)]">
                  {i18nT("common.lastSeen", undefined, "last seen")}: {formatLastSeen(d.lastSeen)}
                </div>
              </div>
              {confirmId === d.id ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="text-xs text-[var(--danger,#ef4444)] hover:underline disabled:opacity-50"
                    disabled={revoking === d.id}
                    onClick={() => handleRevoke(d.id)}
                  >
                    {i18nT("common.confirmRevoke", undefined, "Confirm revoke")}
                  </button>
                  <button
                    type="button"
                    className="text-xs text-[var(--text-muted)] hover:underline"
                    onClick={() => setConfirmId(null)}
                  >
                    {i18nT("common.cancel", undefined, "Cancel")}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  title={i18nT("common.revokeDevice", undefined, "Revoke device")}
                  className="shrink-0 text-[var(--text-muted)] hover:text-[var(--danger,#ef4444)]"
                  onClick={() => setConfirmId(d.id)}
                >
                  <Icon path={mdiDelete} size={0.8} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
