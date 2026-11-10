/**
 * Settings → Security → Paired devices: the held (revoked) devices, and the "<name> revoked · Undo" notice.
 *
 * A revoked device is refused everywhere at once but kept for 90 days, so Undo restores it without re-pairing.
 * Everything here is operator-only: the parent renders this panel only when the viewer holds an operator
 * credential, so no action is ever offered to a viewer who would be refused. A device label is operator-chosen
 * or requester-chosen text and is only ever rendered as a text child.
 *
 * See change: device-key-mutual-check (D6, tasks 4.6; bearer-device-auth "Paired devices settings show keys,
 * companions and revoked devices").
 */
import { Confirm } from "@blackbelt-technology/pi-dashboard-client-utils/Confirm";
import { useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { daysUntilPurge, type RevokedDeviceView } from "../../lib/pairing/paired-devices-api.js";

/** How long the "<name> revoked · Undo" notice stays. */
export const REVOKE_NOTICE_MS = 10_000;

export interface RevokeNoticeState {
  id: string;
  name: string;
  /** Undo was answered 404/409: the record is gone or already active. */
  unavailable?: boolean;
}

const LINK = "text-xs text-[var(--accent)] hover:underline disabled:opacity-50";

function lostOrStolenText(): string {
  return i18nT(
    "pairedDevices.lostOrStolen",
    undefined,
    "Undo only if you revoked by mistake. If the device was lost or stolen, leave it revoked: undo makes its saved access work again.",
  );
}

function daysText(days: number): string {
  return days === 1
    ? i18nT("pairedDevices.deletedInDay", undefined, "Deleted for good in 1 day")
    : i18nT("pairedDevices.deletedInDays", { count: days }, "Deleted for good in {count} days");
}

function formatWhen(ms: number): string {
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}

/** The 10-second notice after a revoke. */
export function RevokeNotice({ notice, onUndo }: { notice: RevokeNoticeState; onUndo: (id: string) => void }) {
  return (
    <div
      role="status"
      data-testid={`revoke-notice-${notice.id}`}
      className="flex items-center gap-2 rounded border border-[var(--border-primary)] bg-[var(--bg-surface)] px-3 py-2 text-sm"
    >
      {notice.unavailable ? (
        <span>{i18nT("pairedDevices.noLongerAvailable", undefined, "No longer available")}</span>
      ) : (
        <>
          <span>{i18nT("pairedDevices.revokedNotice", { name: notice.name }, "{name} revoked")}</span>
          <button type="button" className={LINK} onClick={() => onUndo(notice.id)}>
            {i18nT("common.undo", undefined, "Undo")}
          </button>
        </>
      )}
    </div>
  );
}

export function RevokedDevicesPanel({
  devices,
  unreadable,
  unavailable,
  busyId,
  now,
  onUndo,
  onDeleteNow,
}: {
  devices: RevokedDeviceView[];
  unreadable: boolean;
  /** Last Undo / Delete now was answered 404/409. */
  unavailable: boolean;
  busyId: string | null;
  now: number;
  onUndo: (id: string) => void;
  /** Resolves once the operator confirmed and the call finished. */
  onDeleteNow: (id: string) => Promise<void>;
}) {
  const [target, setTarget] = useState<RevokedDeviceView | null>(null);
  if (devices.length === 0 && !unreadable && !unavailable) return null;
  return (
    <section data-testid="revoked-devices" className="space-y-1 pt-2">
      <h3 className="m-0 text-xs font-semibold uppercase text-[var(--text-muted)]">
        {i18nT("pairedDevices.revokedHeading", undefined, "Revoked devices")}
      </h3>
      {unreadable && (
        <p role="alert" data-testid="revoked-unreadable" className="m-0 text-xs text-[var(--status-error)]">
          {i18nT(
            "pairedDevices.revokedUnreadable",
            undefined,
            "Revoked-device list unreadable — revoked devices may be purged early",
          )}
        </p>
      )}
      {devices.length > 0 && (
        <p data-testid="revoked-lost-warning" className="m-0 text-xs text-[var(--text-secondary)]">
          {lostOrStolenText()}
        </p>
      )}
      {unavailable && (
        <p role="status" data-testid="revoked-unavailable" className="m-0 text-xs text-[var(--text-secondary)]">
          {i18nT("pairedDevices.noLongerAvailable", undefined, "No longer available")}
        </p>
      )}
      <ul className="space-y-1">
        {devices.map((d) => (
          <li
            key={d.id}
            data-testid={`revoked-${d.id}`}
            className="flex items-center gap-2 rounded border border-[var(--border-primary)] px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{d.label}</div>
              <div className="text-xs text-[var(--text-muted)]">
                {i18nT("pairedDevices.revokedBy", { when: formatWhen(d.revokedAt), by: d.revokedBy }, "Revoked {when} by {by}")}
              </div>
              <div className="text-xs text-[var(--text-muted)]">{daysText(daysUntilPurge(d.revokedAt, now))}</div>
            </div>
            <button type="button" className={LINK} disabled={busyId === d.id} onClick={() => onUndo(d.id)}>
              {i18nT("pairedDevices.undoRevoke", undefined, "Undo revoke")}
            </button>
            <button
              type="button"
              className="text-xs text-[var(--danger,#ef4444)] hover:underline disabled:opacity-50"
              disabled={busyId === d.id}
              onClick={() => setTarget(d)}
            >
              {i18nT("pairedDevices.deleteNow", undefined, "Delete now")}
            </button>
          </li>
        ))}
      </ul>
      <Confirm
        open={target !== null}
        onClose={() => setTarget(null)}
        title={i18nT("pairedDevices.deleteNowTitle", { name: target?.label ?? "" }, 'Delete "{name}" now?')}
        message={i18nT(
          "pairedDevices.deleteNowMessage",
          { name: target?.label ?? "" },
          'This deletes the revoked device "{name}" for good. It can\'t be undone, and the device would have to pair again.',
        )}
        intent="danger"
        confirmLabel={i18nT("pairedDevices.deleteNow", undefined, "Delete now")}
        cancelLabel={i18nT("common.cancel", undefined, "Cancel")}
        onConfirm={() => {
          const id = target?.id;
          setTarget(null);
          if (id) void onDeleteNow(id);
        }}
        testId="delete-revoked-confirm"
      />
    </section>
  );
}
