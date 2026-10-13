/**
 * Vault Import tab: names-only review with the account each key becomes, optional same-name
 * variables, partial-failure report.
 * See change: retro-ux-credential-vault (test-plan E22, X5).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VaultOverview } from "../../../../lib/vault/vault-api.js";
import { VaultImportPanel } from "../VaultImportPanel.js";
import { type Call, callsTo, fail, makeOverview, ok, stubVaultFetch } from "./vault-fixtures.js";

const acct = (id: string, label: string) => ({ id, provider: label.split("_")[0].toLowerCase(), kind: "key", namespace: "user", label });
const names = (...n: string[]) => n.map((name) => ({ name }));
const CANDIDATES = [{ id: "c1", label: "skill .env", exists: true }];

let overview: VaultOverview;
let calls: Call[];
const onChanged = vi.fn();
const onGoToVariables = vi.fn();

/** Proposal `p1` with `items`; confirming creates one account per name, labelled with the name. */
function stubImport(items: string[], extra?: (c: Call) => Response | undefined) {
  calls = stubVaultFetch({
    handler: (c) => {
      if (c.url === "/api/vault/import/propose") return ok({ id: "p1", items: names(...items), skipped: [{ name: "B_KEY", reason: "value shorter than 8 characters" }] });
      if (c.url === "/api/vault/import/confirm") {
        const asked = (c.body as { names: string[] }).names;
        return ok({ created: asked.map((n, i) => acct(`n${i + 1}`, n)) });
      }
      return extra?.(c);
    },
  });
}
const review = async () => {
  render(<VaultImportPanel overview={overview} candidates={CANDIDATES} onChanged={onChanged} onGoToVariables={onGoToVariables} />);
  fireEvent.click(await screen.findByRole("button", { name: /Review/ }));
  return screen.findByTestId("vault-import-proposal");
};
const bindingPosts = () => callsTo(calls, "POST", "/api/vault/bindings");

beforeEach(() => {
  onChanged.mockClear();
  onGoToVariables.mockClear();
  overview = makeOverview({ bindings: [{ name: "SONIOX_API_KEY", target: "env", defaultAccountId: "x" }] });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("review", () => {
  it("lists names only, the account each becomes, and why a name gets no variable", async () => {
    stubImport(["GEMINI_API_KEY", "SONIOX_API_KEY", "LD_HACK"]);
    const proposal = await review();
    const text = proposal.textContent ?? "";
    for (const n of ["GEMINI_API_KEY", "SONIOX_API_KEY", "LD_HACK"]) expect(text).toContain(n);
    expect(within(proposal).getByTestId("vault-import-note-GEMINI_API_KEY").textContent).toMatch(/variable will be created/);
    expect(within(proposal).getByTestId("vault-import-note-SONIOX_API_KEY").textContent).toMatch(/variable already exists/);
    expect(within(proposal).getByTestId("vault-import-note-LD_HACK").textContent).toContain("no variable: reserved name");
    expect(within(proposal).getByTestId("vault-import-skipped").textContent).toContain("B_KEY");
    expect((within(proposal).getByTestId("vault-import-variable-toggle") as HTMLInputElement).checked).toBe(true);
  });
});

describe("E22 — import creates same-name variables", () => {
  it("creates one binding, for the new valid name, with the created account as default", async () => {
    stubImport(["GEMINI_API_KEY", "SONIOX_API_KEY", "LD_HACK"]);
    const proposal = await review();
    fireEvent.click(within(proposal).getByTestId("vault-import-confirm"));
    await screen.findByTestId("vault-import-done");
    expect(callsTo(calls, "POST", "/api/vault/import/confirm")[0].body).toEqual({ proposalId: "p1", names: ["GEMINI_API_KEY", "SONIOX_API_KEY", "LD_HACK"] });
    expect(bindingPosts()).toHaveLength(1);
    expect(bindingPosts()[0].body).toEqual({ name: "GEMINI_API_KEY", defaultAccountId: "n1" });
    expect(onChanged).toHaveBeenCalled();
    expect(screen.getByTestId("vault-import-done").textContent).toContain("GEMINI_API_KEY");
    fireEvent.click(screen.getByRole("button", { name: "Grant them to a project" }));
    expect(onGoToVariables).toHaveBeenCalled();
  });

  it("unticking the option creates accounts only", async () => {
    stubImport(["GEMINI_API_KEY"]);
    const proposal = await review();
    fireEvent.click(within(proposal).getByTestId("vault-import-variable-toggle"));
    fireEvent.click(within(proposal).getByTestId("vault-import-confirm"));
    await screen.findByTestId("vault-import-done");
    expect(bindingPosts()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Grant them to a project" })).toBeNull();
  });
});

describe("X5 — a variable that fails does not hide the accounts that were created", () => {
  it("names the created variable and the failed one; both accounts exist", async () => {
    stubImport(["A_KEY", "B_KEY2"], (c) => {
      if (c.method === "POST" && c.url === "/api/vault/bindings" && (c.body as { name: string }).name === "B_KEY2") return fail(409, "conflict", "Binding already exists");
      return undefined;
    });
    const proposal = await review();
    fireEvent.click(within(proposal).getByTestId("vault-import-confirm"));
    const done = await screen.findByTestId("vault-import-done");
    await waitFor(() => expect(bindingPosts()).toHaveLength(2));
    expect(done.textContent).toContain("Imported 2");
    expect(screen.getByTestId("vault-import-created").textContent).toContain("A_KEY");
    expect(screen.getByTestId("vault-import-created").textContent).not.toContain("B_KEY2");
    expect(screen.getByTestId("vault-import-failed").textContent).toContain("B_KEY2");
  });
});

describe("candidates and upload", () => {
  it("lists existing candidates only", async () => {
    calls = stubVaultFetch();
    render(
      <VaultImportPanel
        overview={overview}
        candidates={[...CANDIDATES, { id: "c2", label: "missing", exists: false }]}
        onChanged={onChanged}
      />,
    );
    await screen.findByText("skill .env");
    expect(screen.queryByText("missing")).toBeNull();
    expect(screen.getByLabelText(/Or choose a .env or JSON file/)).toBeTruthy();
  });
});
