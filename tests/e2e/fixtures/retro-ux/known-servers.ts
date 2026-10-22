import type { Page } from "@playwright/test";
import type { UiState } from "../../helpers/ui-capture.js";
import { IDENTITY, MIXED, type Server, stubServers } from "./server-selector.js";
import { fail, hold, settingsSection, stubApi } from "./stubs.js";

/**
 * Settings ▸ Remote Servers ▸ Servers states (the merged saved + discovered list), reached by stubbing
 * `/api/known-servers`, the server-side probe and every address's identity challenge / health answer
 * (the same real-Ed25519 host stubs as the selector fixtures).
 *
 * See change: retro-ux-identity-connectivity; group-servers-by-identity (cards by identity, route table,
 * refused route, a route that cannot prove identity, the pair action and the pair-with-code dialog — test-plan #F12).
 */

const only = (...labels: string[]): Server[] => MIXED.filter((s) => labels.includes(s.label));
/** verified, unverified and moved-to entries (each a card with one route). */
const LIST = only("office-mac", "build-box", "studio-pi", "nas");

const section = (page: Page) => settingsSection(page, "Servers");
// The pair-with-code dialog by test id: Settings itself is a role=dialog and both are open at once.
const dialog = (page: Page) => page.getByTestId("pair-with-code-dialog");

async function gotoRemote(page: Page): Promise<void> {
  await page.goto("/settings/remote");
  await section(page).waitFor({ state: "visible" });
}

/** Every route of every card has settled (no "Checking…" left), so the probes see the final text. */
const settled = async (page: Page): Promise<void> => {
  await section(page).getByText("Checking…").first().waitFor({ state: "detached" });
};

const listWith = (servers: Server[], canManage = true) => (page: Page) => stubServers(page, "mixed", servers, canManage);

const base = { stubs: ["/api/known-servers", "/api/known-servers/probe"], root: section };

export const knownServersStates: UiState[] = [
  {
    id: "list",
    label: "verified, unverified and moved-to entries",
    ...base,
    install: listWith(LIST),
    open: async (page) => {
      await gotoRemote(page);
      await section(page).getByText("office-mac", { exact: true }).waitFor();
      await settled(page);
    },
  },
  {
    id: "identity-cards",
    label: "a card with several routes (one refused) and a tunnel-only card",
    ...base,
    install: listWith(IDENTITY),
    open: async (page) => {
      await gotoRemote(page);
      await section(page).getByRole("article", { name: "home-imac" }).waitFor();
      await settled(page);
      await section(page).getByText(/answered with a different identity/).waitFor();
      await section(page).getByRole("button", { name: /^Pair with code… cloud-box/ }).waitFor();
    },
  },
  {
    id: "cant-prove",
    label: "a route that cannot prove identity next to a refused one",
    ...base,
    install: listWith(only("old-nas", "imposter", "office-mac")),
    open: async (page) => {
      await gotoRemote(page);
      await section(page).getByRole("article", { name: "old-nas" }).waitFor();
      await settled(page);
      await section(page).getByText("Can't prove identity").first().waitFor();
      await section(page).getByText(/Different identity/).first().waitFor();
    },
  },
  {
    id: "pair-with-code",
    label: "pair-with-code dialog open on a tunnel-only card",
    stubs: base.stubs,
    root: dialog,
    install: listWith(IDENTITY),
    open: async (page) => {
      await gotoRemote(page);
      await section(page).getByRole("button", { name: /^Pair with code… cloud-box/ }).click();
      await dialog(page).waitFor({ state: "visible" });
    },
  },
  {
    id: "pair-with-code-refused",
    label: "pair-with-code dialog refusing text that is not for this server",
    stubs: base.stubs,
    root: dialog,
    install: listWith(IDENTITY),
    open: async (page) => {
      await gotoRemote(page);
      await section(page).getByRole("button", { name: /^Pair with code… cloud-box/ }).click();
      await dialog(page).getByLabel("Pairing text").fill("not a pairing text");
      await dialog(page).getByRole("button", { name: "Pair", exact: true }).click();
      await dialog(page).getByRole("alert").waitFor();
    },
  },
  {
    id: "remove-confirm",
    label: "remove awaiting confirmation",
    ...base,
    install: listWith(LIST),
    open: async (page) => {
      await gotoRemote(page);
      await section(page).getByRole("button", { name: /^Remove office-mac/ }).click();
      await section(page).getByRole("button", { name: /^Confirm remove/ }).waitFor();
      await settled(page);
    },
  },
  {
    id: "row-error",
    label: "remove rejected by the server",
    ...base,
    install: async (page) => {
      await listWith(LIST)(page);
      await stubApi(page, "/api/known-servers", (route) => fail(route, "operator credential required"), "DELETE");
    },
    open: async (page) => {
      await gotoRemote(page);
      await section(page).getByRole("button", { name: /^Remove office-mac/ }).click();
      await section(page).getByRole("button", { name: /^Confirm remove/ }).click();
      await section(page).getByRole("alert").waitFor();
      await settled(page);
    },
  },
  {
    id: "read-only",
    label: "viewer without an operator credential",
    ...base,
    install: listWith(LIST, false),
    open: async (page) => {
      await gotoRemote(page);
      await section(page).getByText(/Read-only/).waitFor();
      await settled(page);
    },
  },
  {
    id: "add-open",
    label: "add form open",
    ...base,
    install: listWith(LIST.slice(0, 1)),
    open: async (page) => {
      await gotoRemote(page);
      await section(page).getByRole("button", { name: "Add server manually" }).click();
      await section(page).getByLabel("Address", { exact: true }).waitFor();
      await settled(page);
    },
  },
  {
    id: "add-error",
    label: "add form submitted with an unparseable address",
    ...base,
    install: listWith(LIST.slice(0, 1)),
    open: async (page) => {
      await gotoRemote(page);
      await section(page).getByRole("button", { name: "Add server manually" }).click();
      await section(page).getByLabel("Address", { exact: true }).fill("[::1");
      await section(page).getByRole("button", { name: "Add server", exact: true }).click();
      await section(page).getByRole("alert").waitFor();
      await settled(page);
    },
  },
  {
    id: "empty",
    label: "no remote servers saved",
    ...base,
    install: listWith([]),
    open: async (page) => {
      await gotoRemote(page);
      await section(page).getByText(/No remote servers saved/).waitFor();
    },
  },
  {
    id: "loading",
    label: "request in flight",
    stubs: ["/api/known-servers"],
    root: section,
    install: (page) => stubApi(page, "/api/known-servers", () => hold(), "GET"),
    open: async (page) => {
      await gotoRemote(page);
      await section(page).getByRole("status").waitFor();
    },
  },
  {
    id: "load-error",
    label: "list request failed",
    stubs: ["/api/known-servers"],
    root: section,
    install: (page) => stubApi(page, "/api/known-servers", (route) => fail(route, "HTTP 503"), "GET"),
    open: async (page) => {
      await gotoRemote(page);
      await section(page).getByRole("alert").waitFor();
    },
  },
];
