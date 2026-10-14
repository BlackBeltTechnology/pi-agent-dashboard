/**
 * Vault project picker: connected + remembered projects, already-granted and refused entries,
 * manual repository entry normalised before it is compared, older-server fallback.
 * See change: retro-ux-credential-vault (test-plan E20, E21, X3).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VaultOverview, VaultProjects } from "../../../../lib/vault/vault-api.js";
import { VaultProjectPicker } from "../VaultProjectPicker.js";
import { type Call, callsTo, fail, html, makeOverview, ok, stubVaultFetch } from "./vault-fixtures.js";

const acct = (id: string, provider: string, label: string) => ({ id, provider, kind: "key", namespace: "user", label });
const BINDING = { name: "GEMINI_API_KEY", target: "env", defaultAccountId: "a1" };
const DAY = 86_400_000;

const PROJECTS: VaultProjects = {
  open: [
    { kind: "repo", deviceId: "hub", dir: "/Users/robson/Project/deck3d", repoKey: "github.com/robson/deck3d", sessions: 1 },
    { kind: "dir", deviceId: "hub", dir: "/Users/robson/Movies/video-feliratozas", sessions: 2 },
    { kind: "dir", dir: "/home/robson/edge-lab", sessions: 1, blocked: "transport-insecure" },
  ],
  recent: [
    { kind: "dir", deviceId: "hub", dir: "/Users/robson/scratch", lastSeenAt: Date.now() - 3 * DAY },
    { kind: "repo", deviceId: "hub", dir: "/Users/robson/Project/compsy", repoKey: "github.com/robson/compsychletter", lastSeenAt: Date.now() - 9 * DAY },
  ],
};

let overview: VaultOverview;
let calls: Call[];
const onGranted = vi.fn();
const onCancel = vi.fn();

function renderPicker(projectsReply: Response | (() => Response) = ok(PROJECTS)) {
  calls = stubVaultFetch({
    handler: (c) => (c.url === "/api/vault/projects" ? (typeof projectsReply === "function" ? projectsReply() : projectsReply.clone()) : undefined),
  });
  return render(<VaultProjectPicker binding={BINDING} overview={overview} onGranted={onGranted} onCancel={onCancel} />);
}
const grantPosts = () => callsTo(calls, "POST", "/api/vault/grants");

beforeEach(() => {
  onGranted.mockClear();
  onCancel.mockClear();
  overview = makeOverview({ accounts: [acct("a1", "gemini", "personal"), acct("a2", "gemini", "work")], bindings: [BINDING] });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("open and remembered projects", () => {
  it("lists connected projects with their session count and remembered ones with their age", async () => {
    renderPicker();
    const open = await screen.findByTestId("vault-picker-open");
    expect(open.textContent).toContain("deck3d");
    expect(open.textContent).toContain("github.com/robson/deck3d");
    expect(open.textContent).toContain("2 sessions");
    const recent = screen.getByTestId("vault-picker-recent");
    expect(recent.textContent).toContain("scratch");
    expect(recent.textContent).toContain("last seen 3 days ago");
  });

  it("granting a repository project sends repo:<key>; the account choice rides along; the checkout note shows", async () => {
    renderPicker();
    fireEvent.click(await screen.findByRole("radio", { name: /deck3d/ }));
    expect(screen.getByTestId("vault-picker-repo-note").textContent).toMatch(/confirm each checkout/);
    fireEvent.change(screen.getByLabelText("Account for this project"), { target: { value: "a2" } });
    fireEvent.click(screen.getByRole("button", { name: "Grant GEMINI_API_KEY" }));
    await waitFor(() => expect(grantPosts()).toHaveLength(1));
    expect(grantPosts()[0].body).toEqual({ subject: "repo:github.com/robson/deck3d", bindingName: "GEMINI_API_KEY", accountId: "a2" });
    await waitFor(() => expect(onGranted).toHaveBeenCalled());
  });

  it("granting a folder sends dir:<device>:<path> without an account when the default is kept", async () => {
    renderPicker();
    fireEvent.click(await screen.findByRole("radio", { name: /video-feliratozas/ }));
    expect(screen.queryByTestId("vault-picker-repo-note")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Grant GEMINI_API_KEY" }));
    await waitFor(() => expect(grantPosts()).toHaveLength(1));
    expect(grantPosts()[0].body).toEqual({ subject: "dir:hub:/Users/robson/Movies/video-feliratozas", bindingName: "GEMINI_API_KEY" });
  });

  it("Grant stays disabled until a project is chosen; the search filters by name, repository or path", async () => {
    renderPicker();
    await screen.findByTestId("vault-picker-open");
    expect((screen.getByRole("button", { name: "Grant GEMINI_API_KEY" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "compsychletter" } });
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "/Movies/" } });
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "" } });
    expect(screen.getAllByRole("radio").length).toBeGreaterThan(1);
  });

  it("a project already granted this variable is disabled and says so", async () => {
    overview = { ...overview, grants: [{ subject: "repo:github.com/robson/deck3d", bindingName: "GEMINI_API_KEY", state: "ok" }] };
    renderPicker();
    const radio = (await screen.findByRole("radio", { name: /deck3d/ })) as HTMLInputElement;
    expect(radio.disabled).toBe(true);
    expect(radio.closest("label")?.textContent).toContain("Already granted");
  });

  it("Cancel calls back", async () => {
    renderPicker();
    await screen.findByTestId("vault-picker-open");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("E21 — a refused session is shown, not offered", () => {
  it("lists it disabled with the reason and never shows a repository key", async () => {
    renderPicker(
      ok({
        open: [{ kind: "dir", dir: "/home/robson/edge-lab", sessions: 1, blocked: "transport-insecure" }],
        recent: [],
      }),
    );
    const radio = (await screen.findByRole("radio", { name: /edge-lab/ })) as HTMLInputElement;
    expect(radio.disabled).toBe(true);
    const label = radio.closest("label");
    expect(label?.textContent).toMatch(/remote delivery is off/);
    expect(label?.textContent).not.toMatch(/github\.com/);
    fireEvent.click(radio);
    expect(radio.checked).toBe(false);
    expect((screen.getByRole("button", { name: "Grant GEMINI_API_KEY" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("an untrusted session gets its own reason", async () => {
    renderPicker(ok({ open: [{ kind: "dir", dir: "/srv/x", sessions: 1, blocked: "untrusted" }], recent: [] }));
    const radio = await screen.findByRole("radio");
    expect(radio.closest("label")?.textContent).toMatch(/not trusted/);
  });
});

describe("E20 — manual entry never overwrites an existing grant", () => {
  beforeEach(() => {
    overview = { ...overview, grants: [{ subject: "repo:github.com/acme/app", bindingName: "GEMINI_API_KEY", accountId: "a2", state: "ok" }] };
  });

  it("SSH and HTTPS spellings of the same repository both say it already has this variable and send nothing", async () => {
    renderPicker();
    fireEvent.click(await screen.findByRole("button", { name: /Not listed/ }));
    for (const spelling of ["git@github.com:acme/app.git", "https://GitHub.com/acme/app"]) {
      fireEvent.change(screen.getByLabelText("Repository"), { target: { value: spelling } });
      expect(screen.getByTestId("vault-picker-already").textContent).toContain("already has this variable");
      const grant = screen.getByRole("button", { name: "Grant GEMINI_API_KEY" }) as HTMLButtonElement;
      expect(grant.disabled).toBe(true);
      fireEvent.click(grant);
      expect(grantPosts()).toHaveLength(0);
    }
  });

  it("a new repository typed as host/path is granted as its normalised key", async () => {
    renderPicker();
    fireEvent.click(await screen.findByRole("button", { name: /Not listed/ }));
    fireEvent.change(screen.getByLabelText("Repository"), { target: { value: "git@github.com:acme/new-app.git" } });
    expect(screen.queryByTestId("vault-picker-already")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Grant GEMINI_API_KEY" }));
    await waitFor(() => expect(grantPosts()).toHaveLength(1));
    expect(grantPosts()[0].body).toEqual({ subject: "repo:github.com/acme/new-app", bindingName: "GEMINI_API_KEY" });
  });

  it("a bare host/path is accepted; text that is not a repository is refused inline", async () => {
    renderPicker();
    fireEvent.click(await screen.findByRole("button", { name: /Not listed/ }));
    fireEvent.change(screen.getByLabelText("Repository"), { target: { value: "github.com/acme/other" } });
    fireEvent.click(screen.getByRole("button", { name: "Grant GEMINI_API_KEY" }));
    await waitFor(() => expect(grantPosts()).toHaveLength(1));
    expect(grantPosts()[0].body).toMatchObject({ subject: "repo:github.com/acme/other" });
    fireEvent.change(screen.getByLabelText("Repository"), { target: { value: "not a repo" } });
    const input = screen.getByLabelText("Repository");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect((screen.getByRole("button", { name: "Grant GEMINI_API_KEY" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a folder is entered as device and path", async () => {
    renderPicker();
    fireEvent.click(await screen.findByRole("button", { name: /Not listed/ }));
    fireEvent.click(screen.getByRole("button", { name: "Folder" }));
    fireEvent.change(screen.getByLabelText("Device id"), { target: { value: "hub" } });
    fireEvent.change(screen.getByLabelText("Folder path"), { target: { value: "/work/scratch" } });
    fireEvent.click(screen.getByRole("button", { name: "Grant GEMINI_API_KEY" }));
    await waitFor(() => expect(grantPosts()).toHaveLength(1));
    expect(grantPosts()[0].body).toEqual({ subject: "dir:hub:/work/scratch", bindingName: "GEMINI_API_KEY" });
  });
});

describe("X3 — an older server cannot list projects", () => {
  for (const [name, reply] of [
    ["200 HTML", () => html(200)],
    ["404 not_found", () => fail(404, "not_found", "No API route for GET /api/vault/projects")],
  ] as const) {
    it(`${name}: both lists are hidden, it says so and manual entry is open`, async () => {
      renderPicker(reply);
      const note = await screen.findByTestId("vault-picker-unsupported");
      expect(note.textContent).toMatch(/can't list projects yet/);
      expect(screen.queryByTestId("vault-picker-open")).toBeNull();
      expect(screen.queryByTestId("vault-picker-recent")).toBeNull();
      expect(screen.getByLabelText("Repository")).toBeTruthy();
    });
  }

  it("any other failure shows its message and still opens manual entry", async () => {
    renderPicker(() => fail(500, "internal", "internal error (see server.log)"));
    const note = await screen.findByTestId("vault-picker-error");
    expect(note.textContent).toContain("internal error");
    expect(within(document.body).getByLabelText("Repository")).toBeTruthy();
  });
});
