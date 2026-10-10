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
import { mdiAccountKey } from "@mdi/js";
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
import { TIER_OPTIONS } from "./PairedDevicesSection.js";

const badge = "ml-2 rounded bg-[var(--bg-surface)] px-1.5 py-0.5 align-middle text-[10px] uppercase text-[var(--text-muted)]";

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
      <div className="text-sm text-[var(--severity-error-fg)]">{error}</div>
    ) : (
      <div className="text-sm text-[var(--text-muted)]">{i18nT("status.loading2", undefined, "Loading...")}</div>
    );
  }

  if (!state.enabled) {
    return (
      <div className="text-sm text-[var(--text-muted)]" data-testid="users-disabled">
        {i18nT(
          "users.disabled",
          undefined,
          "Passkey users are off. Set auth.passkeys.enabled to true in the dashboard config to manage users.",
        )}
      </div>
    );
  }

  const stable = state.rp.stable;
  const reasonId = "users-unstable-reason";

  return (
    <div className="space-y-2">
      {error && (
        <div className="text-sm text-[var(--severity-error-fg)]" role="alert">
          {error}
        </div>
      )}
      <div className="text-xs text-[var(--text-muted)]">
        {i18nT("users.rpId", { rpId: state.rp.rpId }, "Passkeys are bound to {rpId}.")}
      </div>
      {!stable && (
        <div id={reasonId} className="text-xs text-[var(--severity-warning-fg)]" data-testid="users-unstable">
          {unstableReasonText(state.rp.reason)}
        </div>
      )}

      <form
        className="flex flex-wrap items-center gap-2"
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
        <input
          aria-label={i18nT("users.name", undefined, "Name")}
          className="min-w-0 flex-1 rounded border border-[var(--border-primary)] bg-transparent px-2 py-1 text-sm"
          value={name}
          maxLength={64}
          placeholder={
            state.bootstrapRequired
              ? i18nT("users.firstOperator", undefined, "Your name (first operator)")
              : i18nT("users.namePlaceholder", undefined, "Person's name")
          }
          onChange={(e) => setName(e.target.value)}
        />
        {!state.bootstrapRequired && (
          <select
            aria-label={i18nT("settings.tokenTier", undefined, "Capability")}
            className="rounded border border-[var(--border-primary)] bg-transparent px-2 py-1 text-sm"
            value={tier}
            onChange={(e) => setTier(e.target.value as Tier)}
          >
            {TIER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        <button type="submit" disabled={busy || !name.trim()} className="text-sm text-[var(--accent)] hover:underline disabled:opacity-50">
          {i18nT("users.add", undefined, "Add user")}
        </button>
      </form>
      {state.bootstrapRequired && (
        <div className="text-xs text-[var(--text-muted)]">
          {i18nT(
            "users.bootstrapHint",
            undefined,
            "The first user is an operator and can only be created from this machine (localhost).",
          )}
        </div>
      )}

      {invite && (
        <div className="space-y-2 rounded border border-[var(--border-primary)] bg-[var(--bg-tertiary)] p-3" data-testid="users-invite">
          <div className="text-xs text-[var(--text-muted)]">
            {i18nT(
              "users.inviteHint",
              { expires: new Date(invite.data.expiresAt).toLocaleString() },
              "Scan on the person's phone to create their passkey. Valid until {expires}, single use.",
            )}
          </div>
          <img
            src={invite.data.qrDataUrl}
            alt={i18nT("users.inviteQrAlt", undefined, "Invite QR code")}
            className="h-48 w-48 rounded bg-white p-2"
          />
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate text-xs">{invite.data.url}</code>
            <button
              type="button"
              className="text-xs text-[var(--accent)] hover:underline"
              onClick={() => void copyText(invite.data.url).then((ok) => setCopied(ok ? "ok" : "failed"))}
            >
              {i18nT("users.copyLink", undefined, "Copy link")}
            </button>
            {copied === "ok" && <span className="text-xs text-[var(--text-muted)]">{i18nT("common.copied", undefined, "Copied")}</span>}
            {copied === "failed" && (
              <span className="text-xs text-[var(--status-error)]">
                {i18nT("common.copyFailed", undefined, "Copy failed — select and copy manually.")}
              </span>
            )}
            <button
              type="button"
              className="text-xs text-[var(--text-muted)] hover:underline"
              onClick={() => {
                setInvite(null);
                setCopied("idle");
              }}
            >
              {i18nT("common.dismiss", undefined, "Dismiss")}
            </button>
          </div>
        </div>
      )}

      {state.users.length === 0 ? (
        <div className="py-1 text-sm text-[var(--text-muted)]">{i18nT("users.none", undefined, "No users yet.")}</div>
      ) : (
        <ul className="space-y-1">
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
  return (
    <li className="flex flex-wrap items-center gap-2 rounded border border-[var(--border-primary)] px-3 py-2" data-testid={`user-${u.id}`}>
      <Icon path={mdiAccountKey} size={0.8} className="shrink-0 text-[var(--text-muted)]" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">
          {u.name}
          <span className={badge} data-testid={`user-status-${u.id}`}>
            {u.status}
          </span>
          {orphaned > 0 && (
            <span className={badge} data-testid={`user-orphaned-${u.id}`}>
              {i18nT("users.orphaned", { n: orphaned }, "{n} orphaned")}
            </span>
          )}
        </div>
        <div className="text-xs text-[var(--text-muted)]">
          {i18nT("users.passkeyCount", { n: u.credentials.length - orphaned }, "{n} usable passkey(s)")}
        </div>
      </div>
      {!revoked && (
        <>
          <select
            aria-label={i18nT("users.tierFor", { name: u.name }, "Tier for {name}")}
            className="rounded border border-[var(--border-primary)] bg-transparent px-1 py-0.5 text-xs"
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
            className="text-xs text-[var(--accent)] hover:underline disabled:opacity-50"
            disabled={props.busy || !props.stable}
            aria-describedby={props.reasonId}
            onClick={props.onInvite}
            data-testid={`user-invite-${u.id}`}
          >
            {i18nT("users.invite", undefined, "Invite QR")}
          </button>
          {props.confirming ? (
            <>
              <button
                type="button"
                className="text-xs text-[var(--severity-error-fg)] hover:underline disabled:opacity-50"
                disabled={props.busy}
                onClick={props.onRevoke}
              >
                {i18nT("common.confirmRevoke", undefined, "Confirm revoke")}
              </button>
              <button type="button" className="text-xs text-[var(--text-muted)] hover:underline" onClick={props.onCancelRevoke}>
                {i18nT("common.cancel", undefined, "Cancel")}
              </button>
            </>
          ) : (
            <button type="button" className="text-xs text-[var(--text-muted)] hover:text-[var(--severity-error-fg)]" onClick={props.onAskRevoke}>
              {i18nT("users.revoke", undefined, "Revoke")}
            </button>
          )}
        </>
      )}
    </li>
  );
}
