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
interface Product { id: ProductId; name: string; what: string; levels: { value: string; label: string }[] }
const RW = [{ value: "read", label: "Read" }, { value: "write", label: "Read and change" }];
export const PRODUCTS: Product[] = [
  { id: "gmail", name: "Gmail", what: "Search, read, draft and send mail", levels: [
    { value: "readonly", label: "Read" }, { value: "draft", label: "Read and draft" }, { value: "send", label: "Read, draft and send" }] },
  { id: "calendar", name: "Calendar", what: "Events and free/busy", levels: RW },
  { id: "drive", name: "Drive", what: "Find, export and upload files", levels: RW },
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

export const PERSONAL: Account = { sub: "1", email: "robson.csakany@gmail.com", products: { gmail: { level: "send" }, calendar: { level: "write" }, drive: { level: "read" } } };
export const WORK: Account = { sub: "2", email: "robson@semmi.se", products: { gmail: { level: "draft" }, calendar: { level: "read" }, sheets: { level: "write" } } };
export const NEW_ACCT: Account = { sub: "3", email: "pi.dashboard.demo@gmail.com", products: { gmail: { level: "readonly" }, calendar: { level: "read" }, drive: { level: "read" } } };
export const ORG_ACCT: Account = { sub: "4", email: "team-pi@blackbelt.hu", org: "BlackBelt", products: { gmail: { level: "readonly" }, docs: { level: "read" } } };

// ---- account card ----
function summary(a: Account): string {
  const on = Object.keys(a.products) as ProductId[];
  return on.length ? on.map(nameOf).join(" · ") : "Nothing turned on yet";
}

export function AccountCard({ acct, open = false, tapProduct, ring, tableRing }: {
  acct: Account; open?: boolean; tapProduct?: ProductId; ring?: string; tableRing?: string;
}) {
  const reauth = Object.values(acct.products).some((p) => p?.status === "reauth_required");
  const table = (
    <SettingsTable caption={`What the agent may use in ${acct.email}`} columns={["Google product", "Agent may", ""]}
      rows={PRODUCTS.map((p) => {
        const cur = acct.products[p.id];
        const control = (
          <select aria-label={`${p.name} for ${acct.email}`} className={select} value={cur?.level ?? "off"} onChange={() => {}}>
            <option value="off">Nothing (off)</option>
            {p.levels.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
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
        <div className="flex flex-wrap items-center gap-2">
          {reauth ? <button type="button" className={primaryBtn}>Sign in again</button> : null}
          <button type="button" className={btn}>Disconnect</button>
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

export function ConnectDialog({ picked, tapContinue, orgChoice, title = "Connect a Google account", intro, ring }: {
  picked: ProductId[]; tapContinue?: boolean; orgChoice?: boolean; title?: string; intro?: string; ring?: string;
}) {
  const go = <button type="button" className={primaryBtn}>Continue with Google</button>;
  return (
    <DialogShell title={title}
      footer={<><button type="button" className={btn}>Cancel</button><T on={tapContinue}>{go}</T></>}>
      <p className="m-0">{intro ?? "You'll pick the account on Google's page. What may the agent use?"}</p>
      <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Google products">
        {PRODUCTS.map((p) => (
          <label key={p.id} className="flex items-center gap-2 rounded border border-[var(--border-secondary)] px-2 py-1.5">
            <input type="checkbox" checked={picked.includes(p.id)} onChange={() => {}} className="focus-ring" />
            <span className="font-semibold">{p.name}</span>
          </label>
        ))}
      </div>
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
      <ul className="m-0 flex list-disc flex-col gap-0.5 pl-4 text-[var(--text-secondary)]">
        <li>Your sign-in stays on this dashboard. Nothing is sent to pi-dashboard.dev.</li>
        <li>What the agent reads goes to your AI model provider only to answer you.</li>
        <li>Every change (sending mail, editing files, creating events) asks you first.</li>
      </ul>
      <span className={muted}>By continuing you agree to the <SafeLink href="https://pi-dashboard.dev/privacy.html">privacy policy</SafeLink>.</span>
    </DialogShell>
  );
}

export function WaitingDialog({ clientId, title = "Connect a Google account" }: { clientId: string; title?: string }) {
  const OAuthFlow = useUiPrimitive("ui:oauth-flow");
  return (
    <DialogShell title={title} footer={<button type="button" className={btn}>Cancel</button>}>
      <p className="m-0"><strong>Finish in the Google window</strong> that just opened: pick the account, then allow access. Tick every box Google shows. The window closes and you come back here automatically, also when the dashboard runs on another computer.</p>
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

export function DoneDialog({ email, products, missing, tapDone, title = "Connect a Google account" }: {
  email: string; products: string; missing?: string; tapDone?: boolean; title?: string;
}) {
  return (
    <DialogShell title={title}
      footer={<>{missing ? <button type="button" className={btn}>Try again</button> : null}<T on={tapDone}><button type="button" className={primaryBtn}>Done</button></T></>}>
      <SettingsNotice tone="success">{email} is connected. The agent may now read: {products}.</SettingsNotice>
      {missing ? <SettingsNotice tone="warning">Google did not allow {missing}. Try again and tick every box.</SettingsNotice> : null}
    </DialogShell>
  );
}

/** Google's own pages, drawn only for orientation (Google renders them, not the dashboard). */
export function GooglePages({ account }: { account: string }) {
  const box = "flex w-[260px] flex-col gap-2 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-primary)] p-4 text-xs text-[var(--text-primary)]";
  return (
    <div className="flex flex-wrap items-start gap-3">
      <div className={box}>
        <span className="text-[11px] text-[var(--text-secondary)]">accounts.google.com</span>
        <strong className="text-sm">Choose an account</strong>
        <span>to continue to <strong>pi-dashboard</strong></span>
        {["robson.csakany@gmail.com", "robson@semmi.se", account].map((a) => (
          <span key={a} className={`rounded border px-2 py-1 ${a === account ? "border-[var(--accent-solid)]" : "border-[var(--border-secondary)]"}`}>{a}</span>
        ))}
      </div>
      <div className={box}>
        <span className="text-[11px] text-[var(--text-secondary)]">accounts.google.com</span>
        <strong className="text-sm">pi-dashboard wants access to your Google Account</strong>
        <span className="text-[var(--text-secondary)]">{account}</span>
        <label className="flex gap-2"><input type="checkbox" checked readOnly />Read your email in Gmail</label>
        <label className="flex gap-2"><input type="checkbox" checked readOnly />See your calendar events</label>
        <label className="flex gap-2"><input type="checkbox" checked readOnly />See your Google Drive files</label>
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
