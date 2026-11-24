/**
 * One connected Google account: collapsed summary (email, alias, products, status pill), expanded product ×
 * access table, the access-model statement, alias, Sign in again and Disconnect (confirm dialog with the
 * opt-in "Also remove access at Google"). Disabled controls always point at a visible reason
 * (`aria-describedby`), never `title` only. See change: add-google-connect.
 */
import { SafeLink, SettingsNotice, SettingsStatusPill, SettingsTable, useT, useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import { useId, useState } from "react";
import { Disclosure } from "./Disclosure.js";
import { levelChoices, lowestLevel, PRODUCT_NAME, PRODUCT_WHAT, PRODUCTS, type Product, productNames } from "./products.js";
import type { AccountSummary, GoogleState } from "./types.js";
import { api, btn, muted, selectCls } from "./ui.js";

/** `null` turns the product off; otherwise the wished level (+ options kept from the stored selection). */
export type ProductWish = { level: string; options?: Record<string, boolean> } | null;

export const OWN_CLIENT_REASON = "needs your organisation's own sign-in";
export const REMOTE_GMAIL_REASON = "needs the dashboard's own computer, or organisation sign-in";

export interface AccountCardProps {
  acct: AccountSummary;
  state: GoogleState;
  onChange: (acct: AccountSummary, wish: Partial<Record<Product, ProductWish>>) => void;
  onReauth: (acct: AccountSummary) => void;
  onRefresh: () => void;
  /** `revoke` = the user asked to remove access at Google too; `remoteRevoked` = Google answered (`null` = not asked). */
  onDisconnected: (email: string, revoke: boolean, remoteRevoked: boolean | null) => void;
  /** An action failed (code from the server). */
  onError: (code: string) => void;
}

function DisconnectDialog({ email, onCancel, onConfirm }: { email: string; onCancel: () => void; onConfirm: (revoke: boolean) => void }) {
  const t = useT();
  const Dialog = useUiPrimitive("ui:dialog");
  const [revoke, setRevoke] = useState(false);
  const hintId = useId();
  return (
    <Dialog open onClose={onCancel} title={t("disconnectTitle", { email }, `Disconnect ${email}?`)} testId="google-disconnect-dialog">
      <div className="flex flex-col gap-3 text-xs text-[var(--text-primary)]">
        <p className="m-0">{t("disconnectBody", undefined, "The agent can no longer use this account. Its sign-in is deleted from this dashboard.")}</p>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={revoke} onChange={(e) => setRevoke(e.target.checked)} className="focus-ring mt-0.5" aria-describedby={hintId} />
          <span className="flex flex-col gap-0.5">
            <span className="font-semibold">{t("disconnectRevoke", undefined, "Also remove access at Google")}</span>
            <span id={hintId} className={muted}>
              {t(
                "disconnectRevokeHint",
                undefined,
                "Ends access for every dashboard that uses the same app for this Google account, not only this one.",
              )}
            </span>
          </span>
        </label>
      </div>
      <Dialog.Footer>
        <button type="button" className={btn} data-testid="google-disconnect-cancel" onClick={onCancel}>
          {t("cancel", undefined, "Cancel")}
        </button>
        <button type="button" className={btn} data-testid="google-disconnect-confirm" onClick={() => onConfirm(revoke)}>
          {t("disconnect", undefined, "Disconnect")}
        </button>
      </Dialog.Footer>
    </Dialog>
  );
}

export function AccountCard({ acct, state, onChange, onReauth, onRefresh, onDisconnected, onError }: AccountCardProps) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [alias, setAlias] = useState(acct.alias ?? "");
  const ids = useId();
  const busyId = `${ids}-busy`;
  const driveId = `${ids}-drive`;
  const gmailId = `${ids}-gmail`;

  const builtin = acct.client === "builtin" || acct.client === "builtin-remote";
  const clientLabel = acct.client.startsWith("own:") ? state.clients.find((c) => c.ref === acct.client)?.label : undefined;
  // A same-computer (built-in local) account can only be changed from the dashboard's own computer.
  const needsLocal = state.browser === "remote" && acct.client === "builtin";
  const names = productNames(acct.products);
  const summary = names.length ? names.join(" · ") : t("noProducts", undefined, "No products on");
  const subtitle = clientLabel ? `${summary} · ${t("viaOrg", { name: clientLabel }, `organisation sign-in: ${clientLabel}`)}` : summary;
  const reauth = acct.status === "reauth_required";
  const email = acct.email;
  const missing = new Set(acct.missing ?? []);
  const ownReason = t("ownClientReason", undefined, OWN_CLIENT_REASON);
  const remoteGmailReason = t("remoteGmailReason", undefined, REMOTE_GMAIL_REASON);

  const choose = (product: Product, value: string) => {
    const cur = acct.products[product];
    const wish: ProductWish = value === "off" ? null : cur?.options ? { level: value, options: cur.options } : { level: value };
    onChange(acct, { [product]: wish });
  };
  const toggleOption = (product: Product, name: string, on: boolean) => {
    const cur = acct.products[product];
    if (cur) onChange(acct, { [product]: { level: cur.level, options: { ...cur.options, [name]: on } } });
  };

  const describedBy = (product: Product, level: string | null): string | undefined => {
    if (working) return busyId;
    if (product === "drive" && builtin) return driveId;
    if (product === "gmail" && acct.client === "builtin-remote") return gmailId;
    void level;
    return undefined;
  };

  const control = (product: Product) => {
    const cur = acct.products[product];
    const label = `${PRODUCT_NAME[product]} level for ${email}`;
    const reasonId = describedBy(product, null);
    return (
      <select
        aria-label={t("levelFor", { product: PRODUCT_NAME[product], email }, label)}
        data-testid={`google-level-${product}`}
        className={selectCls}
        value={cur?.level ?? "off"}
        disabled={working}
        aria-describedby={reasonId}
        onChange={(e) => choose(product, e.target.value)}
      >
        <option value="off">{t("levelOff", undefined, "Nothing (off)")}</option>
        {levelChoices(product).map((l) => {
          const reason = builtin && l.ownClientOnly ? ownReason : product === "gmail" && acct.client === "builtin-remote" ? remoteGmailReason : null;
          return (
            <option key={l.id} value={l.id} disabled={reason !== null} aria-describedby={reason ? (product === "gmail" ? gmailId : driveId) : undefined}>
              {reason ? `${l.label} (${reason})` : l.label}
            </option>
          );
        })}
      </select>
    );
  };

  const rows = PRODUCTS.map((p) => ({
    key: p,
    testId: `google-product-row-${p}`,
    cells: [
      <span key="n" className="flex flex-col">
        <span className="font-semibold">{PRODUCT_NAME[p]}</span>
        <span className="text-[11px] text-[var(--text-secondary)]">{PRODUCT_WHAT[p]}</span>
      </span>,
      <span key="c" className="flex flex-col gap-1">
        {control(p)}
        {p === "gmail" && acct.products.gmail && (
          <label className={`${muted} flex items-center gap-1`}>
            <input
              type="checkbox"
              className="focus-ring"
              aria-label={t("filtersFor", { email }, `Gmail filters for ${email}`)}
              checked={acct.products.gmail.options?.filters === true}
              disabled={working}
              onChange={(e) => toggleOption("gmail", "filters", e.target.checked)}
            />
            {t("filtersLabel", undefined, "Also manage Gmail filters")}
          </label>
        )}
      </span>,
      <span key="s" className="flex flex-wrap items-center gap-1">
        {missing.has(p) ? (
          <>
            <span data-testid={`google-product-status-${p}`} data-status="scope_missing" className={muted}>
              {t("scopeMissing", undefined, "Google did not allow this. Try again and tick every box.")}
            </span>
            <button
              type="button"
              className={btn}
              aria-label={t("retryProduct", { product: PRODUCT_NAME[p], email }, `Try again for ${PRODUCT_NAME[p]} on ${email}`)}
              disabled={working}
              aria-describedby={working ? busyId : undefined}
              onClick={() => onChange(acct, { [p]: { level: lowestLevel(p) } })}
            >
              {t("tryAgain", undefined, "Try again")}
            </button>
          </>
        ) : (
          <span data-testid={`google-product-status-${p}`} />
        )}
      </span>,
    ],
  }));

  const saveAlias = async () => {
    setWorking(true);
    try {
      await api(`/accounts/${encodeURIComponent(acct.sub)}`, { method: "PATCH", body: JSON.stringify({ alias: alias.trim() || null }) });
      onRefresh();
    } catch (err) {
      onError((err as { code?: string }).code ?? (err as Error).message);
    } finally {
      setWorking(false);
    }
  };

  const disconnect = async (revoke: boolean) => {
    setConfirming(false);
    setWorking(true);
    try {
      const r = await api<{ remoteRevoked: boolean | null }>(`/accounts/${encodeURIComponent(acct.sub)}${revoke ? "?revoke=true" : ""}`, { method: "DELETE" });
      onDisconnected(email, revoke, r.remoteRevoked);
    } catch (err) {
      onError((err as { code?: string }).code ?? (err as Error).message);
    } finally {
      setWorking(false);
    }
  };

  return (
    <div data-testid="google-account-row" data-email={email} data-sub={acct.sub}>
      <Disclosure
        toggleTestId="google-account-toggle"
        header={
          <>
            <span className="min-w-0 flex-1">
              <span className="block break-words text-sm font-semibold text-[var(--text-primary)]">
                {acct.alias ? `${acct.alias} · ${email}` : email}
              </span>
              <span data-testid="google-account-summary" className="block break-words text-[12px] font-normal text-[var(--text-secondary)]">
                {subtitle}
              </span>
            </span>
            <SettingsStatusPill testId="google-account-status" status={acct.status} tone={reauth ? "error" : "success"}>
              {reauth ? t("statusReauth", undefined, "Sign in again") : t("statusOk", undefined, "Connected")}
            </SettingsStatusPill>
          </>
        }
      >
        {needsLocal && (
          <p className={`${muted} m-0`} data-testid="google-local-only">
            {t("localOnly", { email }, `${email} was connected on the dashboard's own computer. Changing what the agent may use needs that computer.`)}
          </p>
        )}
        <SettingsTable
          testId="google-product-table"
          caption={t("tableCaption", { email }, `What the agent may use in ${email}`)}
          columns={[t("colProduct", undefined, "Google product"), t("colAccess", undefined, "Agent may"), t("colStatus", undefined, "Status")]}
          rows={rows}
        />
        {builtin && (
          <p id={driveId} className={`${muted} m-0`} data-testid="google-drive-note">
            {t(
              "driveNote",
              { reason: ownReason },
              `Drive "Files I pick or create": the agent sees only files you pick for it or files it created, not your other Drive files. Reading all files ${ownReason}.`,
            )}
          </p>
        )}
        {acct.client === "builtin-remote" && (
          <p id={gmailId} className={`${muted} m-0`} data-testid="google-gmail-note">
            {t("gmailRemoteNote", undefined, "Gmail is not available for an account connected from another computer: open the dashboard on its own computer, or use organisation sign-in.")}
          </p>
        )}
        <p className={`${muted} m-0`} data-testid="google-access-model">
          {t(
            "accessModel",
            undefined,
            "This dashboard enforces these levels, not Google. Every agent session on the dashboard's own computer may use this account within these levels; sessions connected from other computers cannot.",
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={selectCls}
            aria-label={t("aliasFor", { email }, `Alias for ${email}`)}
            placeholder={t("aliasPlaceholder", undefined, "Alias")}
            value={alias}
            maxLength={40}
            onChange={(e) => setAlias(e.target.value)}
          />
          <button type="button" className={btn} aria-label={t("saveAliasFor", { email }, `Save alias for ${email}`)} disabled={working} aria-describedby={working ? busyId : undefined} onClick={() => void saveAlias()}>
            {t("aliasSave", undefined, "Save")}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {reauth && (
            <button
              type="button"
              className={btn}
              aria-label={t("reauthFor", { email }, `Sign in again ${email}`)}
              disabled={working}
              aria-describedby={working ? busyId : undefined}
              onClick={() => onReauth(acct)}
            >
              {t("signInAgain", undefined, "Sign in again")}
            </button>
          )}
          <button
            type="button"
            className={btn}
            aria-label={t("disconnectFor", { email }, `Disconnect ${email}`)}
            disabled={working}
            aria-describedby={working ? busyId : undefined}
            data-testid="google-account-disconnect"
            onClick={() => setConfirming(true)}
          >
            {t("disconnect", undefined, "Disconnect")}
          </button>
          {working && (
            <span id={busyId} role="status" className={muted}>
              {t("working", undefined, "Working…")}
            </span>
          )}
        </div>
        {acct.testingHint && <SettingsNotice tone="info">{t("testingHint", undefined, "Google testing mode: the sign-in may expire after 7 days.")}</SettingsNotice>}
      </Disclosure>
      {confirming && <DisconnectDialog email={email} onCancel={() => setConfirming(false)} onConfirm={(r) => void disconnect(r)} />}
    </div>
  );
}

/** The notice shown after a disconnect that asked Google to revoke and could not reach it. */
export function RevokeFailedNotice({ email }: { email: string }) {
  const t = useT();
  return (
    <SettingsNotice tone="warning" role="alert" testId="google-disconnect-result">
      {t("revokeFailedPre", { email }, `${email} was removed from this dashboard, but Google couldn't be reached to remove access. Remove "pi-dashboard" yourself at `)}
      <SafeLink href="https://myaccount.google.com/connections">myaccount.google.com/connections</SafeLink>.
    </SettingsNotice>
  );
}
