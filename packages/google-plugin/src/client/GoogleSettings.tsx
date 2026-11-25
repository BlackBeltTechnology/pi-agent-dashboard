/**
 * Settings → Google accounts: the accounts list (one card per account), the one primary
 * "Connect a Google account" button, and the collapsed "Advanced: organisation sign-in". Account changes that
 * need Google's consent, "Sign in again" and a new connect share one dialog. See change: add-google-connect.
 */
import { SettingsNotice, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import { useCallback, useEffect, useState } from "react";
import type { Audience } from "../shared/auto-setup.js";
import { AccountCard, RevokeFailedNotice } from "./AccountCard.js";
import { ConnectDialog, type ConnectIntent, type Started, type Wish } from "./ConnectDialog.js";
import { errorText } from "./connect-errors.js";
import { OrgSignIn } from "./OrgSignIn.js";
import type { AccountSummary, GoogleState } from "./types.js";
import { api, muted, primaryBtn } from "./ui.js";

type Flash = { kind: "revoke-failed"; email: string } | { kind: "error"; code: string } | null;

export function GoogleSettings() {
  const t = useT();
  const [state, setState] = useState<GoogleState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash>(null);
  const [intent, setIntent] = useState<ConnectIntent | null>(null);
  const [orgOpen, setOrgOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [orgDomain, setOrgDomain] = useState<string | undefined>();
  const [audience, setAudience] = useState<Audience | null>(null);

  const refresh = useCallback(async (): Promise<GoogleState | null> => {
    try {
      const next = await api<GoogleState>("/state");
      setState(next);
      setLoadError(null);
      return next;
    } catch (err) {
      setLoadError((err as Error).message);
      return null;
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A setup run the server still holds (page reload mid-run): open the section that shows it.
  const liveRun = state?.autoSetup?.runId;
  useEffect(() => {
    if (!liveRun) return;
    setOrgOpen(true);
    setAddOpen(true);
  }, [liveRun]);

  const refusal = (err: unknown, retry: ConnectIntent) => {
    const code = (err as { code?: string }).code ?? (err as Error).message;
    if (retry.kind !== "new" && code === "local_browser_required") setIntent({ ...retry, blocked: code });
    else if (retry.kind !== "new" && code === "disclosure_required") setIntent({ ...retry, needDisclosure: true });
    else setFlash({ kind: "error", code });
  };

  const changeProducts = async (account: AccountSummary, wish: Wish) => {
    setFlash(null);
    const next: ConnectIntent = { kind: "change", account, wish };
    try {
      const r = await api<Started | { applied: true }>(`/accounts/${encodeURIComponent(account.sub)}/products`, { method: "POST", body: JSON.stringify({ products: wish }) });
      if ("flowId" in r) setIntent({ ...next, started: r });
      else await refresh();
    } catch (err) {
      refusal(err, next);
    }
  };

  const reauth = async (account: AccountSummary) => {
    setFlash(null);
    const next: ConnectIntent = { kind: "reauth", account };
    const builtin = account.client === "builtin" || account.client === "builtin-remote";
    if (builtin && state && !state.disclosure.accepted) {
      setIntent({ ...next, needDisclosure: true });
      return;
    }
    try {
      setIntent({ ...next, started: await api<Started>(`/accounts/${encodeURIComponent(account.sub)}/reauth`, { method: "POST" }) });
    } catch (err) {
      refusal(err, next);
    }
  };

  if (loadError) {
    return (
      <SettingsNotice tone="error" testId="google-load-error">
        {loadError}
      </SettingsNotice>
    );
  }
  if (!state) {
    return (
      <div data-testid="google-loading" className={muted}>
        {t("loading", undefined, "Loading…")}
      </div>
    );
  }

  const connectLabel = state.accounts.length
    ? t("connectAnother", undefined, "Connect another Google account")
    : t("connect", undefined, "Connect a Google account");

  return (
    <section className="flex flex-col gap-3" data-testid="google-settings" aria-labelledby="google-settings-title">
      <div className="flex flex-col gap-0.5">
        <h3 id="google-settings-title" className="m-0 text-sm font-semibold text-[var(--text-primary)]">
          {t("title", undefined, "Google accounts")}
        </h3>
        <p className={`${muted} m-0`}>
          {t(
            "intro",
            undefined,
            "Let the agent use Gmail, Calendar, Drive, Docs, Sheets, Slides, Tasks and Contacts. Connect as many Google accounts as you like; every change the agent makes asks you first.",
          )}
        </p>
      </div>
      {flash?.kind === "revoke-failed" && <RevokeFailedNotice email={flash.email} />}
      {flash?.kind === "error" && (
        <SettingsNotice tone="error" role="alert" testId="google-action-error">
          {errorText(t, flash.code)}
        </SettingsNotice>
      )}
      <div className="flex flex-col gap-2" data-testid="google-accounts">
        {state.accounts.map((a) => (
          <AccountCard
            key={a.sub}
            acct={a}
            state={state}
            onChange={(acct, wish) => void changeProducts(acct, wish)}
            onReauth={(acct) => void reauth(acct)}
            onRefresh={() => void refresh()}
            onDisconnected={(email, revoke, remoteRevoked) => {
              setFlash(revoke && remoteRevoked === false ? { kind: "revoke-failed", email } : null);
              void refresh();
            }}
            onError={(code) => setFlash({ kind: "error", code })}
          />
        ))}
      </div>
      <div className="flex flex-col items-start gap-1">
        <button type="button" className={primaryBtn} data-testid="google-connect" onClick={() => setIntent({ kind: "new" })}>
          {connectLabel}
        </button>
        <span className={muted}>{t("connectHelp", undefined, "You choose the account on Google's own sign-in page.")}</span>
      </div>
      <OrgSignIn
        state={state}
        open={orgOpen}
        onToggle={setOrgOpen}
        addOpen={addOpen}
        onAddOpen={setAddOpen}
        prefillDomain={orgDomain}
        onChanged={() => void refresh()}
        onAudience={setAudience}
      />
      {intent && (
        <ConnectDialog
          key={intent.kind === "new" ? "new" : `${intent.kind}-${intent.account.sub}`}
          intent={intent}
          state={state}
          audience={audience}
          onClose={() => setIntent(null)}
          onRefresh={refresh}
          onSetupOrg={(domain) => {
            setOrgDomain(domain);
            setOrgOpen(true);
            setAddOpen(true);
          }}
        />
      )}
    </section>
  );
}
