/**
 * The one connect dialog: connect a new account (product checkboxes read-only to start, data-use disclosure for
 * the built-in app, "Sign in with" only when an organisation client exists), then wait for Google (paste fallback
 * folded away), then the result. The same dialog carries a product change that needs consent and "Sign in again".
 * See change: add-google-connect.
 */
import { oauthFlowClient, SafeLink, SettingsNotice, useT, useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ProductWish } from "./AccountCard.js";
import type { Audience } from "../shared/auto-setup.js";
import { showUnverifiedNotice } from "./auto-setup.js";
import { errorText } from "./connect-errors.js";
import { Disclosure } from "./Disclosure.js";
import { isEmail, normalizeEmail } from "../shared/setup.js";
import { UNVERIFIED_HINT_EN } from "./wizard.js";
import { emailDomain, lowestLevel, PRODUCT_NAME, PRODUCTS, type Product, productNames } from "./products.js";
import type { AccountSummary, ClientRef, ClientSummary, GoogleState } from "./types.js";
import { api, btn, muted, primaryBtn, selectCls } from "./ui.js";

export const PRIVACY_URL = "https://pi-dashboard.dev/privacy.html";
const DEFAULT_PICKED: Product[] = ["gmail", "calendar", "drive"];
const REPORT_CODES = ["org_internal", "access_denied", "admin_policy_enforced", "other"] as const;
/** Codes that mean "your Google admin / organisation blocks this app": offer organisation sign-in. */
const WORKSPACE_BLOCKS = new Set(["admin_policy_enforced", "org_internal"]);

export type Wish = Partial<Record<Product, ProductWish>>;
export interface Started {
  flowId: string;
  path: string;
  client: ClientRef;
}
interface Applied {
  applied: true;
}

export type ConnectIntent =
  | { kind: "new" }
  | { kind: "change"; account: AccountSummary; wish: Wish; started?: Started; blocked?: string; needDisclosure?: boolean }
  | { kind: "reauth"; account: AccountSummary; started?: Started; blocked?: string; needDisclosure?: boolean };

type FlowState = React.ComponentProps<ReturnType<typeof useUiPrimitive<"ui:oauth-flow">>>["flow"];
type FlowStatus = NonNullable<FlowState["status"]>;

type Stage =
  | { s: "choose" }
  | { s: "starting" }
  | { s: "waiting"; flowId: string; status: FlowStatus; client: ClientRef }
  | { s: "done"; account?: AccountSummary; missing: Product[] }
  | { s: "error"; code: string; client?: ClientRef; retry: "choose" | "restart" }
  | { s: "blocked"; code: string };

export interface ConnectDialogProps {
  intent: ConnectIntent;
  state: GoogleState;
  onClose: () => void;
  /** Audience the user picked in automatic setup (feeds the unverified-app hint); `null` = unknown. */
  audience?: Audience | null;
  /** Reload `GET state`; resolves the fresh state (or `null` when it failed). */
  onRefresh: () => Promise<GoogleState | null>;
  /** "Set up organisation sign-in": close and open Advanced with the add form, domain prefilled. */
  onSetupOrg: (domain?: string) => void;
}

function useFlowPoll(flowId: string | undefined, onPending: (s: FlowStatus) => void, onDone: (code: string | null) => void) {
  const pending = useRef(onPending);
  const done = useRef(onDone);
  pending.current = onPending;
  done.current = onDone;
  useEffect(() => {
    if (!flowId) return;
    let stopped = false;
    const timer = setInterval(() => {
      oauthFlowClient.status(flowId).then(
        (s) => {
          if (stopped) return;
          if (s.status === "pending") pending.current(s);
          else {
            stopped = true;
            done.current(s.status === "complete" ? null : (s.error ?? s.status));
          }
        },
        (err: unknown) => {
          if (stopped) return;
          stopped = true;
          done.current(err instanceof Error ? err.message : String(err));
        },
      );
    }, 500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [flowId]);
}

const optionLabel = (c: ClientSummary) => `${c.label}${c.domains.length ? ` (${c.domains.join(", ")})` : ""}`;

/** Which accounts a finished flow touched: the new one (unknown sub before) or the intent's account. */
function resultAccount(intent: ConnectIntent, before: Set<string>, next: GoogleState | null): AccountSummary | undefined {
  if (!next) return undefined;
  if (intent.kind !== "new") return next.accounts.find((a) => a.sub === intent.account.sub);
  return next.accounts.find((a) => !before.has(a.sub)) ?? undefined;
}

export function ConnectDialog({ intent, state, audience = null, onClose, onRefresh, onSetupOrg }: ConnectDialogProps) {
  const t = useT();
  const Dialog = useUiPrimitive("ui:dialog");
  const OAuthFlow = useUiPrimitive("ui:oauth-flow");
  const ids = useId();
  const before = useRef(new Set(state.accounts.map((a) => a.sub)));
  const reported = useRef<string | null>(null);
  const opened = useRef<string | null>(null);

  const account = intent.kind === "new" ? undefined : intent.account;
  const locked = intent.kind !== "new";
  const showSignInWith = intent.kind === "new" && state.clients.length > 0;
  const builtinRef = state.builtin.available ? state.builtin.ref : undefined;

  const [picked, setPicked] = useState<Product[]>(DEFAULT_PICKED);
  const [clientChoice, setClientChoice] = useState<string>(builtinRef ?? "");
  const [workEmail, setWorkEmail] = useState("");
  const [serverChoices, setServerChoices] = useState<ClientSummary[] | null>(null);
  const [stage, setStage] = useState<Stage>(() => {
    if (intent.kind !== "new" && intent.blocked) return { s: "blocked", code: intent.blocked };
    return { s: "choose" };
  });
  const [fold, setFold] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [consumed, setConsumed] = useState(false);

  // The client this dialog signs in with: the account's, the chosen one, or the only possible one.
  const effectiveClient: string = account ? account.client : showSignInWith ? clientChoice : (builtinRef ?? "");
  const isBuiltin = effectiveClient === "builtin" || effectiveClient === "builtin-remote";
  const remoteLine = effectiveClient === "builtin-remote";
  const gmailBlocked = !locked && effectiveClient === "builtin-remote";
  const needsAccept = isBuiltin && !state.disclosure.accepted;
  const emailKnown = account?.email ?? (isEmail(normalizeEmail(workEmail)) ? normalizeEmail(workEmail) : undefined);

  const picks: Product[] = locked
    ? PRODUCTS.filter((p) => account?.products[p] || (intent.kind === "change" && intent.wish[p]))
    : picked.filter((p) => !(p === "gmail" && gmailBlocked));
  const noClientOffered = intent.kind === "new" && !showSignInWith && !builtinRef;
  const clientMissing = showSignInWith && !clientChoice;
  const emailInvalid = showSignInWith && workEmail.trim() !== "" && !isEmail(normalizeEmail(workEmail));

  const startFor = useCallback(
    async (override?: { client?: string }): Promise<Started | Applied> => {
      if (intent.kind === "change") {
        return api<Started | Applied>(`/accounts/${encodeURIComponent(intent.account.sub)}/products`, { method: "POST", body: JSON.stringify({ products: intent.wish }) });
      }
      if (intent.kind === "reauth") return api<Started>(`/accounts/${encodeURIComponent(intent.account.sub)}/reauth`, { method: "POST" });
      const products = Object.fromEntries(picks.map((p) => [p, { level: lowestLevel(p) }]));
      const client = override?.client ?? (showSignInWith ? clientChoice : undefined);
      const email = normalizeEmail(workEmail);
      return api<Started>("/accounts", {
        method: "POST",
        body: JSON.stringify({ products, ...(client ? { client } : {}), ...(showSignInWith && isEmail(email) ? { email } : {}) }),
      });
    },
    // biome-ignore lint/correctness/useExhaustiveDependencies: `picks` derives from the listed inputs
    [intent, picked, clientChoice, workEmail, showSignInWith, gmailBlocked],
  );

  const finish = useCallback(
    async (code: string | null, client?: ClientRef) => {
      if (reported.current) return;
      if (code) {
        setStage({ s: "error", code, client, retry: intent.kind === "new" ? "choose" : "restart" });
        void onRefresh();
        return;
      }
      const next = await onRefresh();
      const acct = resultAccount(intent, before.current, next);
      setStage({ s: "done", account: acct, missing: acct?.missing ?? [] });
    },
    [intent, onRefresh],
  );

  const attach = useCallback(
    async (s: Started) => {
      reported.current = null;
      try {
        const status = await oauthFlowClient.status(s.flowId);
        if (status.authUrl && opened.current !== s.flowId) {
          opened.current = s.flowId;
          window.open(status.authUrl, "_blank", "noopener");
        }
        setStage({ s: "waiting", flowId: s.flowId, status, client: s.client });
      } catch (err) {
        setStage({ s: "error", code: (err as Error).message, client: s.client, retry: intent.kind === "new" ? "choose" : "restart" });
      }
    },
    [intent.kind],
  );

  const run = useCallback(
    async (override?: { client?: string }) => {
      setStartError(null);
      setStage({ s: "starting" });
      try {
        if (needsAccept) await api("/disclosure", { method: "PUT" });
        const r = intent.kind !== "new" && intent.started && !consumed ? intent.started : await startFor(override);
        setConsumed(true);
        if ("applied" in r) {
          await finish(null);
          return;
        }
        await attach(r);
      } catch (err) {
        const e = err as { code?: string; body?: { clients?: ClientSummary[] } };
        if (e.code === "client_required" && e.body?.clients?.length) {
          setServerChoices(e.body.clients);
          setStage({ s: "choose" });
          return;
        }
        if (e.code === "local_browser_required") {
          setStage({ s: "blocked", code: e.code });
          return;
        }
        setStartError(e.code ?? (err as Error).message);
        setStage({ s: "choose" });
      }
    },
    [attach, consumed, finish, intent, needsAccept, startFor],
  );

  // A flow the server already started (sign in again): go straight to waiting.
  const autoAttached = useRef(false);
  useEffect(() => {
    if (autoAttached.current) return;
    if (intent.kind === "reauth" && intent.started && !intent.needDisclosure) {
      autoAttached.current = true;
      void run();
    }
  }, [intent, run]);

  const waitingFlowId = stage.s === "waiting" ? stage.flowId : undefined;
  const waitingClient = stage.s === "waiting" ? stage.client : undefined;
  useFlowPoll(
    waitingFlowId,
    (status) => {
      if (!reported.current) setStage((cur) => (cur.s === "waiting" ? { ...cur, status } : cur));
    },
    (code) => void finish(code, waitingClient),
  );

  const close = () => {
    if (waitingFlowId) void oauthFlowClient.cancel(waitingFlowId).catch(() => {});
    onClose();
    void onRefresh();
  };

  const report = (code: string) => {
    if (stage.s !== "waiting") return;
    reported.current = code;
    void oauthFlowClient.cancel(stage.flowId).catch(() => {});
    setStage({ s: "error", code, client: stage.client, retry: intent.kind === "new" ? "choose" : "restart" });
  };

  const switchPath = () => {
    if (stage.s !== "waiting") return;
    void oauthFlowClient.cancel(stage.flowId).catch(() => {});
    const next = stage.client === "builtin" ? "builtin-remote" : "builtin";
    setClientChoice(next);
    void run({ client: next });
  };

  const sendInput = async (id: string, value: string) => {
    try {
      await oauthFlowClient.input(id, value);
    } catch (err) {
      reported.current = "input";
      void oauthFlowClient.cancel(id).catch(() => {});
      setStage({ s: "error", code: (err as Error).message, client: waitingClient, retry: intent.kind === "new" ? "choose" : "restart" });
    }
  };

  const title = account ? (intent.kind === "reauth" ? t("reauthTitle", { email: account.email }, `Sign in again: ${account.email}`) : t("changeTitle", { email: account.email }, `Allow more for ${account.email}`)) : t("connectTitle", undefined, "Connect a Google account");

  // ── pieces ──────────────────────────────────────────────────────────────────

  const returnLine = remoteLine
    ? t("discRemote", undefined, "Google returns once through pi-dashboard.dev's return page, which stores nothing. Your sign-in is kept only on this dashboard.")
    : t("discLocal", undefined, "Your sign-in stays on this computer. Nothing is sent to pi-dashboard.dev.");

  const disclosure = isBuiltin ? (
    <>
      <ul className="m-0 flex list-disc flex-col gap-0.5 pl-4 text-[var(--text-secondary)]" data-testid="google-disclosure">
        <li data-testid="google-disclosure-line-1">{returnLine}</li>
        <li data-testid="google-disclosure-line-2">{t("discModel", undefined, "What the agent reads goes to your AI model provider only to answer you.")}</li>
        <li data-testid="google-disclosure-line-3">{t("discAsk", undefined, "Every change (sending mail, editing files, creating events) asks you first.")}</li>
      </ul>
      <span className={muted}>
        {t("privacyPre", undefined, "By continuing you agree to the")}{" "}
        <SafeLink href={PRIVACY_URL} data-testid="google-privacy-link">
          {t("privacyLink", undefined, "privacy policy")}
        </SafeLink>
        .
      </span>
    </>
  ) : null;

  const products = (
    <div className="grid grid-cols-2 gap-1.5" role="group" aria-label={t("productsLabel", undefined, "Google products")} data-testid="google-products">
      {PRODUCTS.map((p) => {
        const off = p === "gmail" && gmailBlocked;
        const on = picks.includes(p);
        return (
          <label key={p} className={`flex items-center gap-2 rounded border border-[var(--border-secondary)] px-2 py-1.5 ${off ? "text-[var(--text-secondary)]" : ""}`}>
            <input
              type="checkbox"
              className="focus-ring"
              data-testid={`google-product-check-${p}`}
              checked={on}
              disabled={locked || off}
              aria-describedby={off ? `${ids}-gmail-off` : undefined}
              onChange={(e) => setPicked((cur) => (e.target.checked ? [...cur, p] : cur.filter((x) => x !== p)))}
            />
            <span className="font-semibold">{PRODUCT_NAME[p]}</span>
            {off && <span className="text-[11px]">{t("notHere", undefined, "not here")}</span>}
          </label>
        );
      })}
    </div>
  );

  const reasonLine = (code: string) => (
    <p className="m-0" data-testid="google-start-error" role="alert">
      {errorText(t, code)}
    </p>
  );

  const workspaceBlock = (code: string, client: ClientRef | undefined) => {
    const clientId = client && client.startsWith("own:") ? state.clients.find((c) => c.ref === client)?.clientId : state.builtin.available ? state.builtin.clientId : undefined;
    const domain = emailDomain(emailKnown);
    return (
      <SettingsNotice
        tone="error"
        role="alert"
        testId="google-workspace-block"
        actions={
          <button type="button" className={btn} data-testid="google-setup-org" onClick={() => { onClose(); onSetupOrg(domain); }}>
            {t("setupOrg", undefined, "Set up organisation sign-in")}
          </button>
        }
      >
        <span className="flex flex-col gap-1">
          <span data-testid="google-block-text">{errorText(t, code, { clientId: clientId ?? "" })}</span>
          {clientId && <span className="font-mono text-[11px] break-all" data-testid="google-block-client-id">{clientId}</span>}
          {domain && <span className={muted} data-testid="google-block-domain">{domain}</span>}
        </span>
      </SettingsNotice>
    );
  };

  // ── bodies per stage ────────────────────────────────────────────────────────

  let body: React.ReactNode;
  let footer: React.ReactNode;

  if (stage.s === "choose" || stage.s === "starting") {
    const busy = stage.s === "starting";
    const canContinue = !busy && picks.length > 0 && !clientMissing && !noClientOffered && !emailInvalid;
    body = (
      <>
        <p className="m-0">
          {account
            ? intent.kind === "reauth"
              ? t("reauthIntro", undefined, "Google needs you to sign in again for this account.")
              : t("changeIntro", undefined, "Google needs your OK for the new access. Products already on stay on; turning one off happens in the account table.")
            : t("connectIntro", undefined, "You'll pick the account on Google's page. What may the agent use?")}
        </p>
        {products}
        {gmailBlocked && (
          <p id={`${ids}-gmail-off`} className={`${muted} m-0`} data-testid="google-gmail-unavailable">
            {t("gmailRemoteReason", undefined, "Gmail isn't available from this computer: open the dashboard on its own computer, or use organisation sign-in.")}
          </p>
        )}
        {!locked && <p className={`${muted} m-0`}>{t("readOnlyStart", undefined, "Read-only to start. Allow changes later on the account card.")}</p>}
        {showSignInWith && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={`${ids}-with`} className="font-semibold">
                {t("signInWith", undefined, "Sign in with")}
              </label>
              <select id={`${ids}-with`} data-testid="google-signin-with" className={selectCls} value={clientChoice} onChange={(e) => setClientChoice(e.target.value)}>
                {!builtinRef && <option value="">{t("chooseClient", undefined, "Choose…")}</option>}
                {builtinRef && <option value={builtinRef}>{t("builtinOption", undefined, "pi-dashboard.dev (personal and most accounts)")}</option>}
                {state.clients.map((c) => (
                  <option key={c.id} value={c.ref}>
                    {t("orgOption", { label: optionLabel(c) }, `${optionLabel(c)} organisation`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${ids}-email`} className="font-semibold">
                {t("workEmail", undefined, "Work email (optional)")}
              </label>
              <input
                id={`${ids}-email`}
                data-testid="google-work-email"
                type="email"
                className={selectCls}
                value={workEmail}
                placeholder="you@example.com"
                aria-invalid={emailInvalid || undefined}
                aria-describedby={emailInvalid ? `${ids}-email-error` : undefined}
                onChange={(e) => setWorkEmail(e.target.value)}
              />
              {emailInvalid && (
                <span id={`${ids}-email-error`} role="alert" className="text-xs text-[var(--severity-error-fg)]" data-testid="google-work-email-error">
                  {errorText(t, "invalid_email")}
                </span>
              )}
            </div>
          </div>
        )}
        {serverChoices && (
          <fieldset className="m-0 flex flex-col gap-1 border-0 p-0" data-testid="google-client-choices">
            <legend className="font-semibold">{t("pickClient", undefined, "Which organisation sign-in should be used?")}</legend>
            {serverChoices.map((c) => (
              <label key={c.id} className="flex items-center gap-2">
                <input type="radio" name={`${ids}-client`} className="focus-ring" data-testid={`google-client-choice-${c.id}`} onChange={() => { setServerChoices(null); void run({ client: c.ref }); }} />
                <span>{optionLabel(c)}</span>
              </label>
            ))}
          </fieldset>
        )}
        {noClientOffered && (
          <SettingsNotice tone="info" testId="google-no-client">
            {t("noClient", undefined, "Signing in through pi-dashboard.dev is not available on this dashboard. Add your organisation's own sign-in under Advanced: organisation sign-in.")}
          </SettingsNotice>
        )}
        {disclosure}
        {startError && reasonLine(startError)}
      </>
    );
    footer = (
      <>
        <button type="button" className={btn} data-testid="google-cancel" onClick={close}>
          {t("cancel", undefined, "Cancel")}
        </button>
        {noClientOffered ? (
          <button type="button" className={btn} data-testid="google-setup-org" onClick={() => { onClose(); onSetupOrg(); }}>
            {t("setupOrg", undefined, "Set up organisation sign-in")}
          </button>
        ) : (
          <button type="button" className={primaryBtn} data-testid="google-continue" disabled={!canContinue} onClick={() => void run()}>
            {t("continueGoogle", undefined, "Continue with Google")}
          </button>
        )}
      </>
    );
  } else if (stage.s === "waiting") {
    const waitingRemote = stage.client === "builtin-remote";
    const canSwitch = intent.kind === "new" && (stage.client === "builtin" || stage.client === "builtin-remote") && state.browser === "local";
    body = (
      <>
        <p className="m-0" data-testid="google-waiting" role="status">
          <strong>{t("waitingLead", undefined, "Finish in the Google window")}</strong>{" "}
          {t("waitingBody", undefined, "that just opened: pick the account, then allow access. Tick every box Google shows.")}{" "}
          {waitingRemote
            ? t("waitingRemote", undefined, "Google then shows a pi-dashboard.dev page: check that it names this dashboard's address and continue. The window closes and this dialog updates.")
            : t("waitingLocal", undefined, "The window closes and you come back here automatically.")}
        </p>
        {(stage.client === "builtin" || stage.client === "builtin-remote") && (
          <p className={`${muted} m-0`} data-testid="google-return-path">
            {waitingRemote
              ? t("discRemote", undefined, "Google returns once through pi-dashboard.dev's return page, which stores nothing. Your sign-in is kept only on this dashboard.")
              : t("discLocal", undefined, "Your sign-in stays on this computer. Nothing is sent to pi-dashboard.dev.")}
          </p>
        )}
        {stage.client.startsWith("own:") && showUnverifiedNotice(audience) && (
          <p className={`${muted} m-0`} data-testid="google-unverified-hint">
            {t("unverifiedHint", undefined, UNVERIFIED_HINT_EN)}
          </p>
        )}
        <Disclosure
          variant="bare"
          open={fold}
          onToggle={setFold}
          toggleTestId="google-fallback-toggle"
          bodyTestId="google-fallback"
          header={<span>{t("fallbackToggle", undefined, "Window didn't open or didn't come back?")}</span>}
        >
          <OAuthFlow flow={{ phase: "waiting", status: stage.status }} onSendInput={sendInput} onCancel={() => close()} />
          <div className="flex flex-col gap-1" role="group" aria-label={t("reportLabel", undefined, "Google showed an error")}>
            <span className="text-xs font-semibold text-[var(--text-primary)]">{t("reportLead", undefined, "Google showed an error:")}</span>
            <div className="flex flex-wrap gap-2">
              {REPORT_CODES.map((c) => (
                <button key={c} type="button" className={btn} data-testid={`google-report-${c}`} onClick={() => report(c)}>
                  {c === "other" ? t("reportOther", undefined, "Another error") : c}
                </button>
              ))}
            </div>
          </div>
          {canSwitch && (
            <button type="button" className={btn} data-testid="google-switch-path" onClick={switchPath}>
              {stage.client === "builtin"
                ? t("switchToReturn", undefined, "Use the pi-dashboard.dev return page instead")
                : t("switchToLocal", undefined, "Use this computer's sign-in instead")}
            </button>
          )}
        </Disclosure>
      </>
    );
    footer = (
      <button type="button" className={btn} data-testid="google-cancel" onClick={close}>
        {t("cancel", undefined, "Cancel")}
      </button>
    );
  } else if (stage.s === "done") {
    const names = productNames(stage.account?.products ?? {});
    body = (
      <>
        <SettingsNotice tone="success" role="status" testId="google-connect-result">
          <span data-testid="google-connected-email">{stage.account?.email ?? t("connectedGeneric", undefined, "The Google account")}</span>{" "}
          {t("connectedTail", { products: names.join(", ") }, `is connected. The agent may now use: ${names.join(", ") || "nothing yet"}.`)}
        </SettingsNotice>
        {stage.missing.length > 0 && (
          <SettingsNotice tone="warning" testId="google-connect-missing">
            {t("missingNotice", { products: stage.missing.map((p) => PRODUCT_NAME[p]).join(", ") }, `Google did not allow ${stage.missing.map((p) => PRODUCT_NAME[p]).join(", ")}. Try again and tick every box.`)}
          </SettingsNotice>
        )}
      </>
    );
    footer = (
      <button type="button" className={btn} data-testid="google-done" onClick={close}>
        {t("done", undefined, "Done")}
      </button>
    );
  } else if (stage.s === "error") {
    const block = WORKSPACE_BLOCKS.has(stage.code);
    const narrower = stage.code === "scope_missing" && account;
    const narrowerText = t(
      "narrowerNotice",
      { email: account?.email ?? "" },
      `Nothing was changed for ${account?.email ?? ""}. On Google's page something the agent already uses was unticked, so the new access stays off. Try again and tick every box.`,
    );
    body = block ? (
      workspaceBlock(stage.code, stage.client)
    ) : (
      <SettingsNotice tone="warning" role="alert" testId="google-connect-error">
        <span data-code={stage.code} data-testid="google-connect-error-text">
          {narrower ? narrowerText : stage.code === "access_denied" ? t("accessCancelled", undefined, "Google access was cancelled. Try again and allow access.") : stage.code === "timeout" ? t("timedOut", undefined, "Sign-in timed out — try again.") : errorText(t, stage.code)}
        </span>
      </SettingsNotice>
    );
    footer = (
      <>
        <button type="button" className={btn} data-testid="google-cancel" onClick={close}>
          {t("close", undefined, "Close")}
        </button>
        {!block && (
          <button type="button" className={primaryBtn} data-testid="google-retry" onClick={() => (stage.retry === "choose" ? setStage({ s: "choose" }) : void run())}>
            {t("tryAgain", undefined, "Try again")}
          </button>
        )}
      </>
    );
  } else {
    body = (
      <SettingsNotice tone="info" role="alert" testId="google-local-required">
        {t(
          "localRequired",
          { email: account?.email ?? "" },
          `${account?.email ?? "This account"} was connected on the dashboard's own computer. To change what the agent may use, open the dashboard on its own computer to change Google access and try again. Nothing was changed.`,
        )}
      </SettingsNotice>
    );
    footer = (
      <button type="button" className={btn} data-testid="google-cancel" onClick={close}>
        {t("close", undefined, "Close")}
      </button>
    );
  }

  return (
    <Dialog open onClose={close} title={title} testId="google-connect-dialog">
      <div className="flex flex-col gap-3 text-xs text-[var(--text-primary)]" data-testid="google-connect-body" data-stage={stage.s}>
        {body}
      </div>
      <Dialog.Footer>{footer}</Dialog.Footer>
    </Dialog>
  );
}

