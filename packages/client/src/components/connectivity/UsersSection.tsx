/**
 * Settings → Security → Users (passkey user directory).
 *
 * People, not devices: list users with tier + status, re-tier, revoke, and
 * mint an invite rendered as a QR code + copyable link (the phone enrolls a
 * passkey from it). Credentials bound to another RP ID are marked orphaned.
 * When the primary origin is unstable, invite minting is shown DISABLED with
 * the reason — never hidden (D2). An empty directory offers the first-operator
 * bootstrap, which the server only accepts from this machine.
 *
 * See change: add-passkey-user-auth.
 */
import {
  mdiAccountKey,
  mdiAlertCircleOutline,
  mdiAlertOutline,
  mdiCheckCircleOutline,
  mdiCloseCircleOutline,
  mdiInformationOutline,
  mdiLoading,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import { useCallback, useEffect, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import type { Tier } from "../../lib/pairing/paired-devices-api.js";
import { logRejection } from "../../lib/report-error.js";
import {
  createUser,
  type DirectoryUserView,
  listUsers,
  type MintedInvite,
  mintInvite,
  revokeUser,
  setUserTier,
  type UsersState,
} from "../../lib/users/users-api.js";
import { unstableReasonText } from "../../lib/users/users-text.js";
import { copyText } from "../../lib/util/clipboard.js";
import {
  BTN_PRIMARY,
  BTN_SMALL,
  BTN_SMALL_DANGER,
  BTN_SMALL_GHOST,
  callout,
  HELP,
  INPUT,
  INSET,
  LABEL,
  META,
  ROW,
  type Severity,
  severityPill,
} from "./connectivity-ui.js";
import { TIER_OPTIONS } from "./PairedDevicesSection.js";

/** Status pill per directory status: severity colour + icon + TEXT (never colour alone). */
function statusView(status: DirectoryUserView["status"]): { label: string; severity: Severity; icon: string } {
  switch (status) {
    case "active":
      return { label: i18nT("users.statusActive", undefined, "Active"), severity: "success", icon: mdiCheckCircleOutline };
    case "invited":
      return { label: i18nT("users.statusInvited", undefined, "Invite pending"), severity: "info", icon: mdiInformationOutline };
    default:
      return { label: i18nT("users.statusRevoked", undefined, "Revoked"), severity: "neutral", icon: mdiCloseCircleOutline };
  }
}

export function UsersSection() {
  const [state, setState] = useState<UsersState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [tier, setTier] = useState<Tier>("observe");
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ userId: string; data: MintedInvite } | null>(null);
  const [copied, setCopied] = useState<"idle" | "ok" | "failed">("idle");

  const reload = useCallback(async () => {
    try {
      setState(await listUsers());
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "failed to load users");
    }
  }, []);

  useEffect(() => {
    void reload().catch(logRejection("UsersSection.reload"));
  }, [reload]);

  /** Run one mutation, surface its error, then refresh the list. */
  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      setError(null);
      await reload();
    } catch (e: any) {
      setError(e?.message ?? "request failed");
    } finally {
      setBusy(false);
    }
  };

  if (!state) {
    return error ? (
      <div className={callout("error")} role="alert">
        <Icon path={mdiAlertCircleOutline} size={0.6} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          {i18nT("users.loadFailed", { error }, "Could not load users: {error}")}
          <div className="mt-1">
            <button type="button" className={BTN_SMALL} onClick={() => void reload().catch(logRejection("UsersSection.retry"))}>
              {i18nT("common.retry", undefined, "Retry")}
            </button>
          </div>
        </div>
      </div>
    ) : (
      <div className={`${HELP} flex items-center gap-1.5`} role="status">
        <Icon path={mdiLoading} size={0.6} className="animate-spin" aria-hidden="true" />
        {i18nT("status.loading2", undefined, "Loading...")}
      </div>
    );
  }

  if (!state.enabled) {
    return (
      <div className={callout("info")} data-testid="users-disabled">
        <Icon path={mdiInformationOutline} size={0.6} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          {i18nT(
            "users.disabled",
            undefined,
            "Passkey users are off. Set auth.passkeys.enabled to true in the dashboard config to manage users.",
          )}
        </div>
      </div>
    );
  }

  const stable = state.rp.stable;
  const reasonId = "users-unstable-reason";

  return (
    <div className="space-y-3">
      {error && (
        <div className={callout("error")} role="alert">
          <Icon path={mdiAlertCircleOutline} size={0.6} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">{error}</div>
        </div>
      )}
      <div className={HELP}>
        {i18nT("users.rpId", { rpId: state.rp.rpId }, "Passkeys are bound to {rpId}.")}
      </div>
      {!stable && (
        <div id={reasonId} className={callout("warning")} data-testid="users-unstable">
          <Icon path={mdiAlertOutline} size={0.6} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <strong>{i18nT("users.invitesUnavailable", undefined, "Invites are unavailable.")}</strong>{" "}
            {unstableReasonText(state.rp.reason)}
          </div>
        </div>
      )}

      <form
        data-testid="users-add-form"
        onSubmit={(e) => {
          e.preventDefault();
          const n = name.trim();
          if (!n) return;
          void run(async () => {
            await createUser(n, tier);
            setName("");
          });
        }}
      >
        <div
          className={`grid items-end gap-2 ${
            state.bootstrapRequired ? "grid-cols-1 sm:grid-cols-[1fr_auto]" : "grid-cols-1 sm:grid-cols-[1fr_9rem_auto]"
          }`}
        >
          <div className="min-w-0">
            <label htmlFor="users-name" className={LABEL}>
              {i18nT("users.name", undefined, "Name")}
            </label>
            <input
              id="users-name"
              className={INPUT}
              value={name}
              maxLength={64}
              placeholder={
                state.bootstrapRequired
                  ? i18nT("users.firstOperator", undefined, "Your name (first operator)")
                  : i18nT("users.namePlaceholder", undefined, "Person's name")
              }
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {!state.bootstrapRequired && (
            <div>
              <label htmlFor="users-tier" className={LABEL}>
                {i18nT("settings.tokenTier", undefined, "Capability")}
              </label>
              <select id="users-tier" className={INPUT} value={tier} onChange={(e) => setTier(e.target.value as Tier)}>
                {TIER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button type="submit" disabled={busy || !name.trim()} className={BTN_PRIMARY}>
            {i18nT("users.add", undefined, "Add user")}
          </button>
        </div>
        {state.bootstrapRequired && (
          <div className={`${HELP} mt-1.5`}>
            {i18nT(
              "users.bootstrapHint",
              undefined,
              "The first user is an operator and can only be created from this machine (localhost).",
            )}
          </div>
        )}
      </form>

      {invite && (
        <div className={`space-y-2 ${INSET}`} data-testid="users-invite">
          <div className={HELP}>
            {i18nT(
              "users.inviteHint",
              { expires: new Date(invite.data.expiresAt).toLocaleString() },
              "Scan on the person's phone to create their passkey. Valid until {expires}, single use.",
            )}
          </div>
          {/* bg-white is a documented exception to the palette ban: a QR code needs a light quiet zone
              (ISO/IEC 18004 §6.3.8) in every theme. See ui-contract.md § Exceptions. */}
          <img
            src={invite.data.qrDataUrl}
            alt={i18nT("users.inviteQrAlt", undefined, "Invite QR code")}
            className="h-48 w-48 rounded bg-white p-2"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <code className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-secondary)]">{invite.data.url}</code>
            <button
              type="button"
              className={BTN_SMALL}
              onClick={() => void copyText(invite.data.url).then((ok) => setCopied(ok ? "ok" : "failed"))}
            >
              {i18nT("users.copyLink", undefined, "Copy link")}
            </button>
            <button
              type="button"
              className={BTN_SMALL_GHOST}
              onClick={() => {
                setInvite(null);
                setCopied("idle");
              }}
            >
              {i18nT("common.dismiss", undefined, "Dismiss")}
            </button>
          </div>
          {copied === "ok" && (
            <div className={META} role="status">
              {i18nT("common.copied", undefined, "Copied")}
            </div>
          )}
          {copied === "failed" && (
            <div className="text-[11px] text-[var(--severity-error-fg)]" role="status">
              {i18nT("common.copyFailed", undefined, "Copy failed — select and copy manually.")}
            </div>
          )}
        </div>
      )}

      {state.users.length === 0 ? (
        <div className={HELP}>{i18nT("users.none", undefined, "No users yet.")}</div>
      ) : (
        <ul className="space-y-1.5">
          {state.users.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              busy={busy}
              stable={stable}
              reasonId={stable ? undefined : reasonId}
              confirming={confirmRevoke === u.id}
              onTier={(next) => void run(() => setUserTier(u.id, next))}
              onInvite={() =>
                void run(async () => {
                  setCopied("idle");
                  setInvite({ userId: u.id, data: await mintInvite(u.id) });
                })
              }
              onAskRevoke={() => setConfirmRevoke(u.id)}
              onCancelRevoke={() => setConfirmRevoke(null)}
              onRevoke={() =>
                void run(async () => {
                  await revokeUser(u.id);
                  setConfirmRevoke(null);
                  if (invite?.userId === u.id) setInvite(null);
                })
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function UserRow(props: {
  user: DirectoryUserView;
  busy: boolean;
  stable: boolean;
  reasonId?: string;
  confirming: boolean;
  onTier: (t: Tier) => void;
  onInvite: () => void;
  onAskRevoke: () => void;
  onCancelRevoke: () => void;
  onRevoke: () => void;
}) {
  const { user: u } = props;
  const revoked = u.status === "revoked";
  const orphaned = u.credentials.filter((c) => c.orphaned).length;
  const status = statusView(u.status);
  return (
    <li className={ROW} data-testid={`user-${u.id}`}>
      <Icon path={mdiAccountKey} size={0.8} className="shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
          <span className="truncate">{u.name}</span>
          <span className={severityPill(status.severity)} data-testid={`user-status-${u.id}`}>
            <Icon path={status.icon} size={0.5} aria-hidden="true" />
            {status.label}
          </span>
          {orphaned > 0 && (
            <span className={severityPill("warning")} data-testid={`user-orphaned-${u.id}`}>
              <Icon path={mdiAlertOutline} size={0.5} aria-hidden="true" />
              {i18nT("users.orphaned", { n: orphaned }, "{n} orphaned")}
            </span>
          )}
        </div>
        <div className={META}>
          {i18nT("users.passkeyCount", { n: u.credentials.length - orphaned }, "{n} usable passkey(s)")}
          {orphaned > 0 &&
            ` · ${i18nT("users.orphanedHint", { n: orphaned }, "{n} bound to a previous address — re-invite to restore")}`}
          {u.status === "invited" &&
            ` · ${i18nT("users.waitingInvite", undefined, "waiting for the person to scan the invite")}`}
        </div>
      </div>
      {!revoked && (
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            aria-label={i18nT("users.tierFor", { name: u.name }, "Tier for {name}")}
            className={`${INPUT} !min-h-[32px] !w-auto !px-2 !py-0.5 !text-xs`}
            value={u.tier}
            disabled={props.busy}
            onChange={(e) => props.onTier(e.target.value as Tier)}
          >
            {TIER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={BTN_SMALL}
            disabled={props.busy || !props.stable}
            aria-describedby={props.reasonId}
            onClick={props.onInvite}
            data-testid={`user-invite-${u.id}`}
          >
            {i18nT("users.invite", undefined, "Invite QR")}
          </button>
          {props.confirming ? (
            <>
              <button type="button" className={BTN_SMALL_DANGER} disabled={props.busy} onClick={props.onRevoke}>
                {i18nT("common.confirmRevoke", undefined, "Confirm revoke")}
              </button>
              <button type="button" className={BTN_SMALL_GHOST} onClick={props.onCancelRevoke}>
                {i18nT("common.cancel", undefined, "Cancel")}
              </button>
            </>
          ) : (
            <button
              type="button"
              className={BTN_SMALL_GHOST}
              aria-label={i18nT("users.revokeNamed", { name: u.name }, "Revoke {name}")}
              onClick={props.onAskRevoke}
            >
              {i18nT("users.revoke", undefined, "Revoke")}
            </button>
          )}
        </div>
      )}
    </li>
  );
}
