// Proposed Settings → Google for add-google-connect. Consumer-first:
// most users connect their OWN Google accounts (often several) through the built-in
// pi-dashboard.dev sign-in and never see OAuth clients. Organisation clients live in a
// collapsed "Advanced" section. Composed from the dashboard-plugin-runtime settings kit
// + host `ui:oauth-flow`; theme tokens only. Mock-only. See ../ui-plan.md.
import {
  SafeLink,
  SettingsGroup,
  SettingsItem,
  SettingsNotice,
  SettingsStatusPill,
  SettingsTable,
  TextField,
  useUiPrimitive,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { Fix, Tap } from "mock-site/kit";
import type { ReactNode } from "react";

// ---- recipes (same strings as gmail-plugin src/client/ui.ts + GmailSettings.tsx) ----
export const btn =
  "focus-ring tap-target rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50";
export const primaryBtn =
  "focus-ring tap-target rounded-md bg-[var(--accent-solid)] px-3 text-xs font-semibold text-white disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)]";
const muted = "text-xs text-[var(--text-secondary)]";
const select =
  "focus-ring rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 py-1 text-xs text-[var(--text-primary)]";
const chip =
  "inline-flex items-center rounded-full border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 py-px text-[11px] text-[var(--text-primary)]";
const mono = "font-mono text-[11px] text-[var(--text-secondary)] break-all";

const T = ({ on, children }: { on?: boolean; children: ReactNode }) => (on ? <Tap>{children}</Tap> : <>{children}</>);
const R = ({ n, tip, children }: { n?: string; tip?: string; children: ReactNode }) =>
  n ? <Fix n={n} tip={tip ?? ""} block>{children}</Fix> : <>{children}</>;

// ---- products (design D4) ----
export type ProductId = "gmail" | "calendar" | "drive" | "docs" | "sheets" | "slides" | "tasks" | "contacts";
interface Level { value: string; label: string; ownClientOnly?: boolean }
interface Product { id: ProductId; name: string; what: string; levels: Level[] }
const RW = [{ value: "read", label: "Read" }, { value: "write", label: "Read and change" }];
export const PRODUCTS: Product[] = [
  { id: "gmail", name: "Gmail", what: "Search, read, draft and send mail", levels: [
    { value: "readonly", label: "Read" }, { value: "draft", label: "Read and draft" }, { value: "send", label: "Read, draft and send" }] },
  { id: "calendar", name: "Calendar", what: "Events and free/busy", levels: RW },
  { id: "drive", name: "Drive", what: "Find, export and upload files", levels: [
    { value: "files", label: "Files you pick" },
    { value: "read", label: "Read all", ownClientOnly: true },
    { value: "write", label: "Read and change all", ownClientOnly: true }] },
  { id: "docs", name: "Docs", what: "Documents", levels: RW },
  { id: "sheets", name: "Sheets", what: "Spreadsheets", levels: RW },
  { id: "slides", name: "Slides", what: "Presentations", levels: RW },
  { id: "tasks", name: "Tasks", what: "Task lists", levels: RW },
  { id: "contacts", name: "Contacts", what: "People and email addresses", levels: RW },
];
const nameOf = (id: ProductId) => PRODUCTS.find((p) => p.id === id)?.name ?? id;

// ---- fixture-shaped data ----
export interface Account {
  sub: string;
  email: string;
  /** Only set for accounts signed in with an organisation client; built-in accounts show no client. */
  org?: string;
  products: Partial<Record<ProductId, { level: string; status?: "reauth_required" | "scope_missing" }>>;
}
export const BUILT_IN_ID = "318204457716-pidash0workspace.apps.googleusercontent.com";
export const ORG_CLIENT = { label: "BlackBelt", domain: "blackbelt.hu", projectId: "blackbelt-pi-connect", clientId: "604117390012-bb7q2k.apps.googleusercontent.com" };

export const PERSONAL: Account = { sub: "1", email: "robson.csakany@gmail.com", products: { gmail: { level: "send" }, calendar: { level: "write" }, drive: { level: "files" } } };
export const WORK: Account = { sub: "2", email: "robson@semmi.se", products: { gmail: { level: "draft" }, calendar: { level: "read" }, sheets: { level: "write" } } };
export const NEW_ACCT: Account = { sub: "3", email: "pi.dashboard.demo@gmail.com", products: { gmail: { level: "readonly" }, calendar: { level: "read" }, drive: { level: "files" } } };
/** Connected from a browser on another computer (built-in remote project): no Gmail. */
export const REMOTE_ACCT: Account = { sub: "5", email: "pi.dashboard.demo@gmail.com", products: { calendar: { level: "read" }, drive: { level: "files" } } };
export const ORG_ACCT: Account = { sub: "4", email: "team-pi@blackbelt.hu", org: "BlackBelt", products: { gmail: { level: "readonly" }, docs: { level: "read" } } };

// ---- account card ----
function summary(a: Account): string {
  const on = Object.keys(a.products) as ProductId[];
  return on.length ? on.map(nameOf).join(" · ") : "Nothing turned on yet";
}

const OWN_CLIENT_REASON = "needs your organisation's own sign-in";

export function AccountCard({ acct, open = false, tapProduct, tapDisconnect, ring, tableRing, accessRing, driveRing }: {
  acct: Account; open?: boolean; tapProduct?: ProductId; tapDisconnect?: boolean; ring?: string; tableRing?: string; accessRing?: string; driveRing?: string;
}) {
  const reauth = Object.values(acct.products).some((p) => p?.status === "reauth_required");
  const table = (
    <SettingsTable caption={`What the agent may use in ${acct.email}`} columns={["Google product", "Agent may", ""]}
      rows={PRODUCTS.map((p) => {
        const cur = acct.products[p.id];
        const control = (
          <select aria-label={`${p.name} for ${acct.email}`} className={select} value={cur?.level ?? "off"} onChange={() => {}}>
            <option value="off">Nothing (off)</option>
            {p.levels.map((l) => {
              const off = l.ownClientOnly && !acct.org;
              return <option key={l.value} value={l.value} disabled={off}>{off ? `${l.label} (${OWN_CLIENT_REASON})` : l.label}</option>;
            })}
          </select>
        );
        return { key: p.id, cells: [
          <span key="n" className="flex flex-col"><span className="font-semibold">{p.name}</span><span className="text-[11px] text-[var(--text-secondary)]">{p.what}</span></span>,
          <T key="c" on={tapProduct === p.id}>{control}</T>,
          <span key="s">{cur?.status === "reauth_required"
            ? <SettingsStatusPill tone="error" status="reauth_required">Sign in again</SettingsStatusPill>
            : cur?.status === "scope_missing"
              ? <SettingsStatusPill tone="warning" status="scope_missing">Not allowed at Google</SettingsStatusPill>
              : null}</span>,
        ] };
      })} />
  );
  return (
    <R n={ring} tip="One card per Google account">
      <SettingsItem collapsible defaultOpen={open}
        title={acct.email}
        subtitle={`${summary(acct)}${acct.org ? ` · organisation sign-in: ${acct.org}` : ""}`}
        status={reauth
          ? <SettingsStatusPill tone="error" status="reauth_required">Sign in again</SettingsStatusPill>
          : <SettingsStatusPill tone="success" status="ok">Connected</SettingsStatusPill>}>
        <R n={tableRing} tip="Change what the agent may use">{table}</R>
        {acct.org ? null : (
          <R n={driveRing} tip="Drive: only files you pick">
            <p className={`${muted} m-0`}>
              Drive "Files you pick": the agent sees only files you pick for it or files it created, not your other Drive
              files. Reading all files {OWN_CLIENT_REASON}.
            </p>
          </R>
        )}
        <R n={accessRing} tip="Who may use this account">
          <p className={`${muted} m-0`}>
            This dashboard enforces these levels, not Google. Every agent session on the dashboard's own computer may use
            this account within these levels; sessions connected from other computers cannot.
          </p>
        </R>
        <div className="flex flex-wrap items-center gap-2">
          {reauth ? <button type="button" className={primaryBtn}>Sign in again</button> : null}
          <T on={tapDisconnect}><button type="button" className={btn}>Disconnect</button></T>
        </div>
      </SettingsItem>
    </R>
  );
}

// ---- organisation clients (Advanced, collapsed by default) ----
export function AdvancedOrg({ open = false, withClient = false, ring }: { open?: boolean; withClient?: boolean; ring?: string }) {
  return (
    <R n={ring} tip="Organisations only, collapsed">
      <SettingsGroup title="Advanced: organisation sign-in" meta={withClient ? "1 organisation" : "Not used"} defaultOpen={open}>
        <div className="flex flex-col gap-2">
          <p className={`${muted} m-0`}>
            Only needed if your company's Google Workspace admin blocks pi-dashboard.dev or requires its own Google Cloud
            sign-in. Personal Google accounts never need this.
          </p>
          {withClient ? (
            <SettingsItem title={`${ORG_CLIENT.label}`} subtitle={`project ${ORG_CLIENT.projectId}`}
              status={<><span className={chip}>{ORG_CLIENT.domain}</span><SettingsStatusPill tone="neutral">1 account</SettingsStatusPill></>} />
          ) : null}
          <div><button type="button" className={btn}>Add organisation sign-in</button></div>
        </div>
      </SettingsGroup>
    </R>
  );
}

export function AddOrgClientForm({ domainError }: { domainError?: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--border-secondary)] p-3">
      <div className="text-sm font-semibold text-[var(--text-primary)]">Add organisation sign-in</div>
      <TextField label="Name" value="BlackBelt" onChange={() => {}} hint="Shown on accounts that use it." />
      <TextField label="Company email domain" value="blackbelt.hu" onChange={() => {}} error={domainError ?? null}
        hint="Accounts with this domain sign in with this organisation's client." />
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-[var(--text-primary)]">OAuth client file from your Google Cloud admin</span>
        <div className="flex items-center gap-2">
          <button type="button" className={btn}>Choose file…</button>
          <span className={mono}>client_secret_604117390012-bb7q2k.apps.googleusercontent.com.json</span>
        </div>
      </div>
      <SettingsGroup title="Don't have the file? Guided Google Cloud setup" defaultOpen={false}>
        <span className={muted}>The existing setup wizard and automatic setup, now enabling every Google product API.</span>
      </SettingsGroup>
      <div><button type="button" className={primaryBtn}>Add</button></div>
    </div>
  );
}

// ---- the page ----
export function GoogleSettings({ accounts, connectRing, connectTap, advancedRing, advancedOpen, withClient, cardRing, header }: {
  accounts: Account[];
  connectRing?: string; connectTap?: boolean;
  advancedRing?: string; advancedOpen?: boolean; withClient?: boolean;
  cardRing?: string; header?: string;
}) {
  const connect = (
    <button type="button" className={primaryBtn}>{accounts.length ? "Connect another Google account" : "Connect a Google account"}</button>
  );
  return (
    <section className="flex flex-col gap-3" aria-labelledby="google-title">
      <R n={header} tip="Google instead of Gmail">
        <div className="flex flex-col gap-0.5">
          <h3 id="google-title" className="m-0 text-sm font-semibold text-[var(--text-primary)]">Google accounts</h3>
          <p className={`${muted} m-0`}>
            Let the agent use Gmail, Calendar, Drive, Docs, Sheets, Slides, Tasks and Contacts. Connect as many Google
            accounts as you like; every change the agent makes asks you first.
          </p>
        </div>
      </R>
      <div className="flex flex-col gap-2">
        {accounts.map((a, i) => <AccountCard key={a.sub} acct={a} ring={i === 0 ? cardRing : undefined} />)}
      </div>
      <R n={connectRing} tip="One button, any Google account">
        <div className="flex flex-col items-start gap-1">
          <T on={connectTap}>{connect}</T>
          <span className={muted}>You choose the account on Google's own sign-in page.</span>
        </div>
      </R>
      <AdvancedOrg open={advancedOpen} withClient={withClient} ring={advancedRing} />
    </section>
  );
}

// ---- connect dialog: ONE screen, then Google, then done ----
function DialogShell({ title, children, footer }: { title: string; children: ReactNode; footer: ReactNode }) {
  // Exact panel classes of client-utils Dialog, drawn inline (the real one portals with `fixed`).
  return (
    <div className="rounded-lg bg-[var(--bg-overlay)] p-6">
      <div role="dialog" aria-modal="true" aria-label={title}
        className="relative mx-auto w-full max-w-lg space-y-4 rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-5 shadow-xl">
        <button type="button" aria-label="Close"
          className="absolute right-2 top-2 flex min-h-[36px] min-w-[36px] items-center justify-center rounded text-[var(--text-secondary)]">✕</button>
        <div className="pr-12 text-lg font-semibold text-[var(--text-primary)]">{title}</div>
        <div className="flex flex-col gap-3 text-xs text-[var(--text-primary)]">{children}</div>
        <div className="flex items-center justify-end gap-2 pt-1">{footer}</div>
      </div>
    </div>
  );
}

const REMOTE_REASON = "open the dashboard on its own computer, or use organisation sign-in";

export function ConnectDialog({ picked, tapContinue, orgChoice, remote, title = "Connect a Google account", intro, ring, remoteRing, disclosureRing }: {
  picked: ProductId[]; tapContinue?: boolean; orgChoice?: boolean;
  /** Browser is not on the dashboard's computer: built-in remote project, no Gmail. */
  remote?: boolean;
  title?: string; intro?: string; ring?: string; remoteRing?: string; disclosureRing?: string;
}) {
  const go = <button type="button" className={primaryBtn}>Continue with Google</button>;
  return (
    <DialogShell title={title}
      footer={<><button type="button" className={btn}>Cancel</button><T on={tapContinue}>{go}</T></>}>
      <p className="m-0">{intro ?? "You'll pick the account on Google's page. What may the agent use?"}</p>
      <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Google products">
        {PRODUCTS.map((p) => {
          const off = remote && p.id === "gmail";
          return (
            <label key={p.id} className={`flex items-center gap-2 rounded border border-[var(--border-secondary)] px-2 py-1.5 ${off ? "text-[var(--text-secondary)]" : ""}`}>
              <input type="checkbox" checked={!off && picked.includes(p.id)} disabled={off} onChange={() => {}} className="focus-ring"
                aria-describedby={off ? "gmail-unavailable" : undefined} />
              <span className="font-semibold">{p.name}</span>
              {off ? <span className="text-[11px]">not here</span> : null}
            </label>
          );
        })}
      </div>
      {remote ? (
        <R n={remoteRing} tip="Gmail needs the dashboard's own computer">
          <p id="gmail-unavailable" className={`${muted} m-0`}>
            Gmail isn't available from this computer: {REMOTE_REASON}.
          </p>
        </R>
      ) : null}
      <p className={`${muted} m-0`}>Read-only to start. Allow changes later on the account card.</p>
      <R n={ring} tip="Org choice only if one is set up">
        {orgChoice ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="signin-with" className="font-semibold">Sign in with</label>
            <select id="signin-with" className={select} value="pi" onChange={() => {}}>
              <option value="pi">pi-dashboard.dev (personal and most accounts)</option>
              <option value="bb">BlackBelt organisation (blackbelt.hu)</option>
            </select>
          </div>
        ) : null}
      </R>
      <R n={disclosureRing} tip="Says how the sign-in returns">
      <ul className="m-0 flex list-disc flex-col gap-0.5 pl-4 text-[var(--text-secondary)]">
        <li>{remote
          ? "Google returns once through pi-dashboard.dev's return page, which stores nothing. Your sign-in is kept only on this dashboard."
          : "Your sign-in stays on this computer. Nothing is sent to pi-dashboard.dev."}</li>
        <li>What the agent reads goes to your AI model provider only to answer you.</li>
        <li>Every change (sending mail, editing files, creating events) asks you first.</li>
      </ul>
      </R>
      <span className={muted}>By continuing you agree to the <SafeLink href="https://pi-dashboard.dev/privacy.html">privacy policy</SafeLink>.</span>
    </DialogShell>
  );
}

export function WaitingDialog({ clientId, remote, title = "Connect a Google account" }: { clientId: string; remote?: boolean; title?: string }) {
  const OAuthFlow = useUiPrimitive("ui:oauth-flow");
  return (
    <DialogShell title={title} footer={<button type="button" className={btn}>Cancel</button>}>
      <p className="m-0"><strong>Finish in the Google window</strong> that just opened: pick the account, then allow access. Tick every box Google shows. {remote
        ? "Google then shows a pi-dashboard.dev page: check that it names this dashboard's address and continue. The window closes and this dialog updates."
        : "The window closes and you come back here automatically."}</p>
      <details className="text-[var(--text-secondary)]">
        <summary className="focus-ring cursor-pointer text-xs">Window didn't open or didn't come back?</summary>
        <div className="mt-2">
          <OAuthFlow
            flow={{ phase: "waiting", status: { flowId: "mock", provider: "google", status: "pending",
              authUrl: `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}`,
              pending: { kind: "manual_code", message: "Paste the full address from the browser after Google finishes." } } }}
            onSendInput={async () => {}} onCancel={() => {}} />
        </div>
      </details>
    </DialogShell>
  );
}

export function DoneDialog({ email, products, missing, unchanged, tapDone, title = "Connect a Google account" }: {
  email: string; products: string; missing?: string;
  /** Existing account: Google's reply dropped something it already relies on, so nothing was stored. */
  unchanged?: { added: string; dropped: string };
  tapDone?: boolean; title?: string;
}) {
  return (
    <DialogShell title={title}
      footer={<>{missing || unchanged ? <button type="button" className={btn}>Try again</button> : null}<T on={tapDone}><button type="button" className={primaryBtn}>Done</button></T></>}>
      {unchanged ? (
        <SettingsNotice tone="warning">
          Nothing was changed for {email}. On Google's page {unchanged.dropped} was unticked, which the agent already uses,
          so {unchanged.added} stays off and {unchanged.dropped} keeps working. Try again and tick every box.
        </SettingsNotice>
      ) : (
        <SettingsNotice tone="success">{email} is connected. The agent may now read: {products}.</SettingsNotice>
      )}
      {missing ? <SettingsNotice tone="warning">Google did not allow {missing}. Try again and tick every box.</SettingsNotice> : null}
    </DialogShell>
  );
}

/** Google's own pages, drawn only for orientation (Google renders them, not the dashboard). */
export function GooglePages({ account, asks = ["Read your email in Gmail", "See your calendar events", "See and download the Google Drive files you pick"] }: { account: string; asks?: string[] }) {
  const box = "flex w-[260px] flex-col gap-2 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-primary)] p-4 text-xs text-[var(--text-primary)]";
  return (
    <div className="flex flex-wrap items-start gap-3">
      <div className={box}>
        <span className="text-[11px] text-[var(--text-secondary)]">accounts.google.com</span>
        <strong className="text-sm">Choose an account</strong>
        <span>to continue to <strong>pi-dashboard</strong></span>
        {[...new Set(["robson.csakany@gmail.com", "robson@semmi.se", account])].map((a) => (
          <span key={a} className={`rounded border px-2 py-1 ${a === account ? "border-[var(--accent-solid)]" : "border-[var(--border-secondary)]"}`}>{a}</span>
        ))}
      </div>
      <div className={box}>
        <span className="text-[11px] text-[var(--text-secondary)]">accounts.google.com</span>
        <strong className="text-sm">pi-dashboard wants access to your Google Account</strong>
        <span className="text-[var(--text-secondary)]">{account}</span>
        {asks.map((a) => <label key={a} className="flex gap-2"><input type="checkbox" checked readOnly />{a}</label>)}
        <span className="self-end rounded bg-[var(--accent-solid)] px-3 py-1 font-semibold text-white">Continue</span>
      </div>
    </div>
  );
}

export function AdminBlocked() {
  return (
    <DialogShell title="Connect a Google account"
      footer={<><button type="button" className={btn}>Close</button><button type="button" className={primaryBtn}>Set up organisation sign-in</button></>}>
      <SettingsNotice tone="error" role="alert">
        Your company (blackbelt.hu) doesn't allow pi-dashboard.dev. Ask your Google Workspace admin to allow app
        <span className={mono}> {BUILT_IN_ID}</span>, or set up your organisation's own sign-in.
      </SettingsNotice>
    </DialogShell>
  );
}

// ---- disconnect ----
export function DisconnectDialog({ email, revoke, revokeFailed, tapConfirm }: {
  email: string; revoke?: boolean; revokeFailed?: boolean; tapConfirm?: boolean;
}) {
  if (revokeFailed) {
    return (
      <DialogShell title="Account disconnected" footer={<button type="button" className={primaryBtn}>Done</button>}>
        <SettingsNotice tone="warning" role="alert">
          {email} was removed from this dashboard, but Google couldn't be reached to remove access. Remove
          "pi-dashboard" yourself at <SafeLink href="https://myaccount.google.com/connections">myaccount.google.com/connections</SafeLink>.
        </SettingsNotice>
      </DialogShell>
    );
  }
  return (
    <DialogShell title={`Disconnect ${email}?`}
      footer={<><button type="button" className={btn}>Cancel</button><T on={tapConfirm}><button type="button" className={primaryBtn}>Disconnect</button></T></>}>
      <p className="m-0">The agent can no longer use this account. Its sign-in is deleted from this dashboard.</p>
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={!!revoke} onChange={() => {}} className="focus-ring mt-0.5" aria-describedby="revoke-hint" />
        <span className="flex flex-col gap-0.5">
          <span className="font-semibold">Also remove access at Google</span>
          <span id="revoke-hint" className={muted}>
            Ends access for every dashboard that uses pi-dashboard with this Google account, not only this one.
          </span>
        </span>
      </label>
    </DialogShell>
  );
}

// ---- consent for a same-computer account from another computer ----
export function LocalBrowserRequired({ email, product }: { email: string; product: string }) {
  return (
    <DialogShell title={`Allow ${product} for ${email}`} footer={<button type="button" className={primaryBtn}>Close</button>}>
      <SettingsNotice tone="info" role="alert">
        {email} was connected on the dashboard's own computer. To change what the agent may use, open the dashboard on
        that computer and try again. Nothing was changed.
      </SettingsNotice>
    </DialogShell>
  );
}

// ---- pi-dashboard.dev/oauth/return.html (static site page, drawn in a browser frame) ----
const DASH = "https://pi.example.com";
function BrowserFrame({ url, children }: { url: string; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-lg overflow-hidden rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-primary)]">
      <div className="border-b border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-3 py-1.5 font-mono text-[11px] text-[var(--text-secondary)]">{url}</div>
      <div className="flex flex-col gap-3 p-5 text-xs text-[var(--text-primary)]">{children}</div>
    </div>
  );
}

export function ReturnPage({ state, tapContinue }: { state: "confirm" | "framed" | "unreachable" | "done"; tapContinue?: boolean }) {
  if (state === "done") {
    return (
      <BrowserFrame url={`${DASH}/api/plugins/google/oauth/remote-callback`}>
        <strong className="text-sm">Google account connected</strong>
        <span>You can close this window and return to the dashboard.</span>
      </BrowserFrame>
    );
  }
  return (
    <BrowserFrame url="https://pi-dashboard.dev/oauth/return.html">
      <strong className="text-sm">Finish connecting your Google account</strong>
      {state === "framed" ? (
        <SettingsNotice tone="error" role="alert">This page can't be used inside another page. Close it and start again from your dashboard.</SettingsNotice>
      ) : (
        <>
          <span>Google sent you here to hand the sign-in to your dashboard. Continue only if this is the dashboard you are using:</span>
          <span className="rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 py-1.5 font-mono text-sm">{DASH}</span>
          {state === "unreachable" ? (
            <SettingsNotice tone="warning" actions={<button type="button" className={btn}>Copy address</button>}>
              This browser couldn't open your dashboard. Copy the address and paste it in the dashboard's
              "Window didn't open or didn't come back?" field.
            </SettingsNotice>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <T on={tapContinue}><button type="button" className={primaryBtn}>Continue to pi.example.com</button></T>
              <button type="button" className={btn}>Not my dashboard</button>
            </div>
          )}
          <span className={muted}>This page stores nothing. The sign-in only works on the dashboard that started it.</span>
        </>
      )}
    </BrowserFrame>
  );
}

// ---- gdrive_pick: the agent asks the user to pick Drive files ----
export function PickerPrompt({ state, tapPick }: { state: "ask" | "picked" | "unavailable"; tapPick?: boolean }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-3 text-xs text-[var(--text-primary)]">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-[var(--text-secondary)]">gdrive_pick</span>
        <span className={muted}>robson.csakany@gmail.com</span>
      </div>
      {state === "ask" ? (
        <>
          <span>The agent asks you to choose Drive files it may read: <em>"the 2026 budget spreadsheet"</em>.</span>
          <div className="flex gap-2">
            <T on={tapPick}><button type="button" className={primaryBtn}>Choose files in Google Drive</button></T>
            <button type="button" className={btn}>Decline</button>
          </div>
        </>
      ) : state === "picked" ? (
        <SettingsNotice tone="success">You picked 1 file: Budget 2026 (Google Sheets). The agent may now read it.</SettingsNotice>
      ) : (
        <SettingsNotice tone="warning">
          Picking Drive files works only with the dashboard open on its own computer. From here the agent sees only
          files it created.
        </SettingsNotice>
      )}
    </div>
  );
}

/** Google's file picker, drawn only for orientation (Google renders it). */
export function GooglePicker() {
  return (
    <div className="flex w-full max-w-md flex-col gap-2 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-primary)] p-4 text-xs text-[var(--text-primary)]">
      <span className="text-[11px] text-[var(--text-secondary)]">Google Drive file picker</span>
      <strong className="text-sm">Select a file</strong>
      {["Budget 2026", "Budget 2025", "Team offsite notes"].map((f, i) => (
        <span key={f} className={`rounded border px-2 py-1 ${i === 0 ? "border-[var(--accent-solid)]" : "border-[var(--border-secondary)]"}`}>{f}</span>
      ))}
      <span className="self-end rounded bg-[var(--accent-solid)] px-3 py-1 font-semibold text-white">Select</span>
    </div>
  );
}

export function GmailMovedNotice() {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="gmail-moved-title">
      <h3 id="gmail-moved-title" className="m-0 text-sm font-semibold text-[var(--text-primary)]">Gmail</h3>
      <SettingsNotice tone="info" actions={<button type="button" className={btn}>Open Google accounts</button>}>
        Gmail is now part of Settings → Google accounts, together with Calendar, Drive and the other Google products.
        Your Gmail accounts were moved there; nothing to reconnect.
      </SettingsNotice>
    </section>
  );
}
