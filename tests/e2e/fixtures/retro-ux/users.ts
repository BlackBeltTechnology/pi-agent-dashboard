import type { Page } from "@playwright/test";
import type { UiState } from "../../helpers/ui-capture.js";
import { fail, hold, ok, settingsSection, stubApi } from "./stubs.js";

/**
 * Settings ▸ Security ▸ Users states (plus the passkey impact note), reached by
 * stubbing `/api/users*`. See change: retro-ux-identity-connectivity.
 */

const RP = "mac-studio.tail3c2f1.ts.net";
const cred = (orphaned = false) => ({ rpId: orphaned ? "old.zrok.io" : RP, orphaned });
const user = (id: string, name: string, status: string, tier: string, credentials: ReturnType<typeof cred>[]) => ({
  id,
  name,
  tier,
  status,
  createdAt: 1,
  credentials,
  invites: [],
});
const USERS = [
  user("u1", "Anna Kovács", "active", "operate", [cred(), cred()]),
  user("u2", "Bence Tóth", "invited", "control", []),
  user("u3", "Dóra Szabó", "active", "observe", [cred(), cred(true), cred(true)]),
  user("u4", "Gábor Nagy", "revoked", "observe", []),
];
const STABLE = { rpId: RP, rpOrigin: `https://${RP}`, stable: true };
const state = (over: Record<string, unknown> = {}) => ({ enabled: true, rp: STABLE, bootstrapRequired: false, users: USERS, ...over });
const QR = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#000"/></svg>').toString("base64")}`;
const INVITE = {
  inviteId: "i1",
  url: `https://${RP}/auth/invite#k7Hq2vT9wXbN4mReJ0aPzL`,
  qrDataUrl: QR,
  expiresAt: Date.UTC(2030, 0, 2, 18, 42),
  maxUses: 1,
};

const section = (page: Page) => settingsSection(page, "Users");

async function gotoSecurity(page: Page): Promise<void> {
  await page.goto("/settings/security");
  await section(page).waitFor({ state: "visible" });
}

const listUsers = (over: Record<string, unknown> = {}) => (page: Page) =>
  stubApi(page, "/api/users", (route) => ok(route, state(over)), "GET");

const base = { stubs: ["/api/users"], root: section };

export const usersStates: UiState[] = [
  {
    id: "list",
    label: "active, invited, revoked and orphaned users",
    ...base,
    install: listUsers(),
    open: async (page) => {
      await gotoSecurity(page);
      await page.getByTestId("user-u1").waitFor();
    },
  },
  {
    id: "unstable",
    label: "invites disabled on an unstable origin",
    ...base,
    install: listUsers({ rp: { ...STABLE, stable: false, reason: "ephemeral_tunnel" } }),
    open: async (page) => {
      await gotoSecurity(page);
      await page.getByTestId("users-unstable").waitFor();
    },
  },
  {
    id: "invite-open",
    label: "minted invite with QR and link",
    ...base,
    install: async (page) => {
      await listUsers()(page);
      await stubApi(page, "/api/users/u2/invites", (route) => ok(route, INVITE), "POST");
    },
    open: async (page) => {
      await gotoSecurity(page);
      await page.getByTestId("user-invite-u2").click();
      await page.getByTestId("users-invite").waitFor();
    },
  },
  {
    id: "copy-failed",
    label: "copy link failed",
    ...base,
    install: async (page) => {
      await listUsers()(page);
      await stubApi(page, "/api/users/u2/invites", (route) => ok(route, INVITE), "POST");
      // `copyText` tries navigator.clipboard, then execCommand — fail both.
      await page.addInitScript(() => {
        const nav = navigator as unknown as { clipboard?: { writeText: () => Promise<void> } };
        if (nav.clipboard) nav.clipboard.writeText = () => Promise.reject(new Error("denied"));
        document.execCommand = () => false;
      });
    },
    open: async (page) => {
      await gotoSecurity(page);
      await page.getByTestId("user-invite-u2").click();
      await page.getByTestId("users-invite").getByRole("button", { name: "Copy link" }).click();
      await page.getByText(/Copy failed/).waitFor();
    },
  },
  {
    id: "revoke-confirm",
    label: "revoke awaiting confirmation",
    ...base,
    install: listUsers(),
    open: async (page) => {
      await gotoSecurity(page);
      await page.getByRole("button", { name: "Revoke Anna Kovács" }).click();
      await page.getByRole("button", { name: "Confirm revoke" }).waitFor();
    },
  },
  {
    id: "mutation-error",
    label: "add user rejected by the server",
    ...base,
    install: async (page) => {
      await listUsers()(page);
      await stubApi(page, "/api/users", (route) => fail(route, "user_name_taken"), "POST");
    },
    open: async (page) => {
      await gotoSecurity(page);
      await page.getByLabel("Name", { exact: true }).fill("Anna Kovács");
      await page.getByRole("button", { name: "Add user" }).click();
      await page.getByRole("alert").waitFor();
    },
  },
  {
    id: "bootstrap",
    label: "empty directory, first-operator bootstrap",
    ...base,
    install: listUsers({ bootstrapRequired: true, users: [] }),
    open: async (page) => {
      await gotoSecurity(page);
      await page.getByText(/first user is an operator/).waitFor();
    },
  },
  {
    id: "disabled",
    label: "passkey users switched off",
    ...base,
    install: listUsers({ enabled: false }),
    open: async (page) => {
      await gotoSecurity(page);
      await page.getByTestId("users-disabled").waitFor();
    },
  },
  {
    id: "loading",
    label: "request in flight",
    ...base,
    install: (page) => stubApi(page, "/api/users", () => hold(), "GET"),
    open: async (page) => {
      await gotoSecurity(page);
      await section(page).getByRole("status").waitFor();
    },
  },
  {
    id: "load-error",
    label: "list request failed",
    ...base,
    install: (page) => stubApi(page, "/api/users", (route) => fail(route, "failed to load users"), "GET"),
    open: async (page) => {
      await gotoSecurity(page);
      await section(page).getByRole("alert").waitFor();
    },
  },
];

/** The orphaned-passkey impact note on the redirect-base-url field (`/api/users/credentials/impact`). */
const impactNote = (orphaned: number): UiState => ({
  id: orphaned > 0 ? "impact" : "impact-none",
  label: orphaned > 0 ? "redirect URL edit would orphan passkeys" : "redirect URL edit orphans nothing (note renders nothing)",
  stubs: ["/api/users/credentials/impact"],
  install: (page) =>
    stubApi(page, "/api/users/credentials/impact", (route) =>
      ok(route, { currentRpId: RP, nextRpId: "pi.example.com", orphaned, users: orphaned > 0 ? 1 : 0 }),
    ),
  open: async (page) => {
    await page.goto("/settings/security");
    const input = page.getByTestId("redirect-base-url-input");
    await input.fill("https://pi.example.com");
    if (orphaned > 0) await page.getByTestId("redirect-base-url-passkey-impact").waitFor();
    else await page.waitForTimeout(800); // debounce (400 ms) + request: the note must stay absent
  },
  // The note itself exists only when it has something to say; probe the field block it sits in.
  root: (page) => page.getByTestId("redirect-base-url-input").locator("xpath=.."),
});

export const impactStates: UiState[] = [impactNote(2), impactNote(0)];
