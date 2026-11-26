// Settings → Google accounts for add-google-connect, told as ONE story in three parts:
//   A. What most users see: their own Google accounts, one "Connect" button, one-screen dialog.
//   B. Organisations only (Advanced, collapsed for everyone else).
//   D. Dashboard on another computer (return page, no Gmail, local-only actions).
//   C. Compared with today (Current = the REAL GmailSettings over a /api/plugins/gmail/state fixture).
import { UiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime";
import { createHostPrimitiveRegistry } from "@app/lib/plugins/host-primitives.tsx";
import { GmailSettings } from "@gmail/client/GmailSettings.tsx";
import { Fix, type Fixtures, Issue, type Mock } from "mock-site/kit";
import type { ReactNode } from "react";
import {
  AccountCard,
  AddOrgClientForm,
  AdminBlocked,
  BUILT_IN_ID,
  ConnectDialog,
  DisconnectDialog,
  DoneDialog,
  GmailMovedNotice,
  GooglePages,
  GooglePicker,
  GoogleSettings,
  LocalBrowserRequired,
  NEW_ACCT,
  ORG_ACCT,
  PERSONAL,
  PickerPrompt,
  REMOTE_ACCT,
  ReturnPage,
  WaitingDialog,
  WORK,
  type Account,
} from "./proposed.tsx";

const registry = createHostPrimitiveRegistry();
const Host = ({ children }: { children: ReactNode }) => (
  <UiPrimitiveProvider value={registry}>
    <div className="bg-[var(--bg-primary)] p-4">{children}</div>
  </UiPrimitiveProvider>
);

const gmailFixtures = (): Fixtures => ({
  http: {
    "GET /api/plugins/gmail/state": () => ({
      client: { configured: true, clientId: "603220229616-gm1x9a.apps.googleusercontent.com", projectId: "robson-pi-gmail" },
      accounts: [
        { sub: "1", email: "robson.csakany@gmail.com", tier: "send", status: "ok", addedAt: 1_760_000_000_000 },
        { sub: "2", email: "robson@semmi.se", tier: "draft", status: "ok", addedAt: 1_761_000_000_000 },
      ],
      setup: { projectId: "robson-pi-gmail", ownerAccount: "robson.csakany@gmail.com" },
    }),
  },
});

const withSheets: Account = { ...WORK, products: { ...WORK.products, slides: { level: "read" } } };

const mock: Mock = {
  title: "Google accounts - connect your Google accounts",
  category: "Settings",
  change: "add-google-connect",
  frames: [
    // ---------- A. What most users see ----------
    {
      title: "A1 Google accounts page - what most users see",
      why: "Your Google accounts, one Connect button; organisation setup hidden under Advanced.",
      width: 760,
      proposed: (
        <Host>
          <GoogleSettings accounts={[PERSONAL, WORK]} cardRing="1" connectRing="2" advancedRing="3" />
        </Host>
      ),
    },
    {
      title: "A2 Connect another Google account",
      why: "Like other apps: one screen, Google picks the account, done.",
      width: 620,
      steps: [
        { label: "click Connect", proposed: <Host><GoogleSettings accounts={[PERSONAL, WORK]} connectTap /></Host> },
        { label: "choose what the agent may use", proposed: (
          <Host><ConnectDialog picked={["gmail", "calendar", "drive"]} tapContinue ring={undefined} /></Host>
        ) },
        { label: "Google's page (new window)", proposed: <Host><GooglePages account="pi.dashboard.demo@gmail.com" /></Host> },
        { label: "dashboard waits", proposed: <Host><WaitingDialog clientId={BUILT_IN_ID} /></Host> },
        { label: "done", proposed: (
          <Host><DoneDialog email="pi.dashboard.demo@gmail.com" products="Gmail, Calendar, Drive" tapDone /></Host>
        ) },
        { label: "three accounts", proposed: <Host><GoogleSettings accounts={[PERSONAL, WORK, NEW_ACCT]} /></Host> },
      ],
    },
    {
      title: "A3 Change what the agent may use",
      why: "Open an account card; turning something on asks Google once, for that only.",
      width: 620,
      steps: [
        { label: "open the card", proposed: <Host><AccountCard acct={WORK} open tapProduct="slides" tableRing="4" accessRing="9" driveRing="10" /></Host> },
        { label: "Google needs your OK", proposed: (
          <Host>
            <ConnectDialog title="Allow Slides for robson@semmi.se" picked={["gmail", "calendar", "sheets", "slides"]} tapContinue
              intro="Google will ask you to allow Slides for this account. Everything else stays as it is." />
          </Host>
        ) },
        { label: "done", proposed: <Host><AccountCard acct={withSheets} open /></Host> },
      ],
    },
    {
      title: "A4 Google's page unticked something the agent already uses",
      why: "Nothing changes; what worked keeps working.",
      width: 620,
      steps: [
        { label: "Gmail unticked on Google's page", proposed: (
          <Host><GooglePages account="robson@semmi.se" asks={["See your calendar events"]} /></Host>
        ) },
        { label: "nothing changed", proposed: (
          <Host><Fix n={14} tip="Narrower reply changes nothing" block>
            <DoneDialog title="Allow Calendar for robson@semmi.se" email="robson@semmi.se" products="" unchanged={{ added: "Calendar", dropped: "Gmail" }} />
          </Fix></Host>
        ) },
      ],
    },
    {
      title: "A5 Disconnect an account",
      why: "Deletes it here; removing access at Google is a separate, explained choice.",
      width: 620,
      steps: [
        { label: "click Disconnect", proposed: <Host><AccountCard acct={WORK} open tapDisconnect /></Host> },
        { label: "confirm", proposed: (
          <Host><Fix n={15} tip="Revoke at Google is opt-in" block><DisconnectDialog email="robson@semmi.se" tapConfirm /></Fix></Host>
        ) },
        { label: "also at Google", proposed: <Host><DisconnectDialog email="robson@semmi.se" revoke tapConfirm /></Host> },
        { label: "Google unreachable", proposed: <Host><DisconnectDialog email="robson@semmi.se" revoke revokeFailed /></Host> },
      ],
    },
    {
      title: "A6 The agent asks for a Drive file",
      why: "Drive 'Files you pick': you choose the file in Google's own picker.",
      width: 620,
      steps: [
        { label: "agent asks", proposed: <Host><Fix n={16} tip="Agent asks, you pick" block><PickerPrompt state="ask" tapPick /></Fix></Host> },
        { label: "Google's picker", proposed: <Host><GooglePicker /></Host> },
        { label: "picked", proposed: <Host><PickerPrompt state="picked" /></Host> },
      ],
    },

    // ---------- B. Organisations only ----------
    {
      title: "B1 Organisation sign-in (Advanced)",
      why: "Only for companies whose Google admin requires their own sign-in.",
      width: 620,
      steps: [
        { label: "Advanced opened", proposed: <Host><GoogleSettings accounts={[PERSONAL]} advancedOpen /></Host> },
        { label: "add organisation", proposed: <Host><AddOrgClientForm /></Host> },
        { label: "set up", proposed: <Host><GoogleSettings accounts={[PERSONAL, ORG_ACCT]} advancedOpen withClient /></Host> },
      ],
    },
    {
      title: "B2 Connect when an organisation is set up",
      why: "Only then does the dialog show a 'Sign in with' choice.",
      width: 620,
      proposed: (
        <Host><ConnectDialog picked={["gmail", "docs"]} orgChoice ring="5" /></Host>
      ),
    },
    {
      title: "B3 Company blocks pi-dashboard.dev",
      why: "Plain words: ask the admin, or set up organisation sign-in.",
      width: 620,
      proposed: (
        <Host><Fix n="6" tip="Blocked by company admin" block><AdminBlocked /></Fix></Host>
      ),
    },

    // ---------- D. Dashboard on another computer ----------
    {
      title: "D1 Connect from another computer",
      why: "Dashboard on a server or reached through a tunnel: Google returns through pi-dashboard.dev, you confirm the address.",
      width: 620,
      steps: [
        { label: "choose (no Gmail here)", proposed: (
          <Host><ConnectDialog picked={["calendar", "drive"]} remote tapContinue remoteRing="11" disclosureRing="12" /></Host>
        ) },
        { label: "Google's page", proposed: (
          <Host><GooglePages account="pi.dashboard.demo@gmail.com" asks={["See your calendar events", "See and download the Google Drive files you pick"]} /></Host>
        ) },
        { label: "dashboard waits", proposed: <Host><WaitingDialog clientId={BUILT_IN_ID} remote /></Host> },
        { label: "confirm your dashboard", proposed: (
          <Host><Fix n={13} tip="Hands off only after you confirm" block><ReturnPage state="confirm" tapContinue /></Fix></Host>
        ) },
        { label: "window: connected", proposed: <Host><ReturnPage state="done" /></Host> },
        { label: "done", proposed: <Host><DoneDialog email="pi.dashboard.demo@gmail.com" products="Calendar, Drive" /></Host> },
        { label: "account listed", proposed: <Host><GoogleSettings accounts={[REMOTE_ACCT]} /></Host> },
      ],
    },
    {
      title: "D2 Return page when something is off",
      why: "Can't reach the dashboard: copy the address. Inside another page: refuse.",
      width: 620,
      steps: [
        { label: "dashboard unreachable", proposed: <Host><ReturnPage state="unreachable" /></Host> },
        { label: "loaded inside a frame", proposed: <Host><ReturnPage state="framed" /></Host> },
      ],
    },
    {
      title: "D3 Same-computer account, used from elsewhere",
      why: "Changes and file picking need the dashboard's own computer.",
      width: 620,
      steps: [
        { label: "turn on Sheets", proposed: <Host><LocalBrowserRequired email="robson.csakany@gmail.com" product="Sheets" /></Host> },
        { label: "agent asks for a file", proposed: <Host><PickerPrompt state="unavailable" /></Host> },
      ],
    },

    // ---------- C. Compared with today ----------
    {
      title: "C1 Today vs proposed",
      why: "Today: build your own Google Cloud app first, Gmail only.",
      width: 760,
      fixtures: gmailFixtures,
      current: (
        <Host>
          <Issue n={7} tip="Google Cloud setup first, Gmail only" block>
            <GmailSettings />
          </Issue>
        </Host>
      ),
      proposed: (
        <Host>
          <Fix n={7} tip="Connect with any Google account" block>
            <GoogleSettings accounts={[PERSONAL, WORK]} />
          </Fix>
        </Host>
      ),
    },
    {
      title: "C2 Gmail section after the move",
      why: "Gmail lives under Google accounts now; nothing to reconnect.",
      width: 620,
      fixtures: gmailFixtures,
      current: <Host><GmailSettings /></Host>,
      proposed: <Host><Fix n={8} tip="Pointer to Google accounts" block><GmailMovedNotice /></Fix></Host>,
    },
    {
      title: "C3 Phone",
      phone: true,
      fixtures: gmailFixtures,
      current: <Host><GmailSettings /></Host>,
      proposed: <Host><GoogleSettings accounts={[PERSONAL, WORK]} /></Host>,
    },
  ],
};
export default mock;
