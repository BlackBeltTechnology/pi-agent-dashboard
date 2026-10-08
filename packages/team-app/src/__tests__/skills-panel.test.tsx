/**
 * Admin Skills panel + form (E38, surfaces S3-S6). See change: add-team-skill-access.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AdminSkillRow } from "../api/types.js";
import { SkillForm } from "../skills/SkillForm.js";
import { SkillsPanel } from "../skills/SkillsPanel.js";
import { bootRoutes, type FakeHost, makeHost, project, renderApp } from "./helpers.js";

const SKILLS = "GET /api/plugins/team/skills";
const USERS = "GET /api/plugins/team/users";

const row = (name: string, extra: Partial<AdminSkillRow> = {}): AdminSkillRow => ({
  name,
  source: "managed",
  path: `/s/${name}`,
  users: "*",
  targets: "*",
  valid: true,
  usage: { personas: 0, liveSessions: 0 },
  ...extra,
});

const ROWS = (): AdminSkillRow[] => [
  row("review", { targets: ["billing"], description: "Code review checklist", usage: { personas: 2, liveSessions: 2 } }),
  row("openspec-propose", { source: "config", path: "/w/openspec-propose", description: "Draft an OpenSpec change", usage: { personas: 1, liveSessions: 1 } }),
  row("legacy-lint", { path: "/opt/old/legacy-lint", targets: ["crm"], valid: false, invalidReason: "path_invalid", usage: { personas: 1, liveSessions: 0 } }),
  row("misnamed", { source: "config", path: "/w/misnamed", valid: false, invalidReason: "name_mismatch" }),
];

function panelHost(opts: { me?: Parameters<typeof bootRoutes>[1]; rows?: AdminSkillRow[]; managedLoadError?: string; projects?: Parameters<typeof project>[0][] } = {}): FakeHost {
  const host = makeHost();
  bootRoutes(host, { admin: true, ...opts.me }, (opts.projects ?? ["billing", "crm"]).map((id) => project(id, { name: `${id}-api` })));
  const rows = opts.rows ?? ROWS();
  host.routes.set(SKILLS, () => ({ skills: rows, ...(opts.managedLoadError ? { managedLoadError: opts.managedLoadError } : {}) }));
  host.routes.set(USERS, () => ({ users: [{ iss: "i", sub: "alice", name: "Kiss Anna" }, { iss: "i", sub: "bob", name: "Nagy Bence" }] }));
  return host;
}

describe("E38: Skills panel list", () => {
  it("renders rows: source chips, usage line, users/targets cells, managed menu, config lock without a menu", async () => {
    const host = panelHost();
    renderApp(<SkillsPanel />, host, "/skills");
    await screen.findByRole("heading", { name: "Képességek" });
    const managed = document.querySelector('[data-skill="review"]') as HTMLElement;
    expect(managed.className).not.toContain("is-invalid");
    expect(within(managed).getByText("Kezelt")).toBeTruthy();
    expect(within(managed).getByText("2 persona · 2 élő munkamenet")).toBeTruthy();
    expect(within(managed).getByText("Mindenki")).toBeTruthy();
    expect(within(managed).getByText("billing-api")).toBeTruthy();
    expect(within(managed).getAllByRole("button", { name: "Műveletek: review" }).length).toBe(1);

    const config = document.querySelector('[data-skill="openspec-propose"]') as HTMLElement;
    expect(within(config).getByText("Konfig")).toBeTruthy();
    expect(config.querySelector(".sr-only")?.textContent).toBe("Konfigurációból, csak olvasható");
    expect(within(config).queryByRole("button", { name: /Műveletek/ })).toBeNull();
  });

  it("invalid rows: warning chip + consequence; name_mismatch gets its own reason", async () => {
    const host = panelHost();
    renderApp(<SkillsPanel />, host, "/skills");
    await screen.findByRole("heading", { name: "Képességek" });
    const bad = document.querySelector('[data-skill="legacy-lint"]') as HTMLElement;
    expect(bad.className).toContain("is-invalid");
    expect(within(bad).getByText("Útvonal érvénytelen")).toBeTruthy();
    expect(within(bad).getByText("Nem indul vele beszélgetés, amíg az útvonalat nem javítod.")).toBeTruthy();
    const named = document.querySelector('[data-skill="misnamed"]') as HTMLElement;
    expect(within(named).getByText("A név nem egyezik a képesség saját nevével.")).toBeTruthy();
  });

  it("a managed load error shows a banner", async () => {
    const host = panelHost({ managedLoadError: "skills.json is corrupt" });
    renderApp(<SkillsPanel />, host, "/skills");
    await screen.findByText(/A kezelt katalógus fájlja hibás/);
  });

  it("single-user mode: the users cell says not restricted", async () => {
    const host = panelHost({ me: { mode: "single" } });
    renderApp(<SkillsPanel />, host, "/skills");
    await screen.findByRole("heading", { name: "Képességek" });
    const managed = document.querySelector('[data-skill="review"]') as HTMLElement;
    expect(within(managed).getByText("Nem korlátozott (egyfelhasználós mód)")).toBeTruthy();
  });

  it("a member is redirected to the grid", async () => {
    const host = panelHost({ me: { admin: false } });
    renderApp(<SkillsPanel />, host, "/skills");
    // redirected off /skills to the grid (store resolves the first available project)
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/?project=billing"));
  });

  it("remove confirms session end, then deletes", async () => {
    const host = panelHost();
    host.routes.set("DELETE /api/plugins/team/skills/:name", () => ({ ok: true }));
    renderApp(<SkillsPanel />, host, "/skills");
    await screen.findByRole("heading", { name: "Képességek" });
    const managed = document.querySelector('[data-skill="review"]') as HTMLElement;
    fireEvent.click(within(managed).getByRole("button", { name: "Műveletek: review" }));
    fireEvent.click(await within(managed).findByText("Eltávolítás"));
    await screen.findByText("Eltávolítod: review?");
    expect(screen.getByRole("dialog", { name: "Eltávolítod: review?" }).textContent).toContain("2 élő munkamenet leáll");
    fireEvent.click(screen.getByTestId("dlg-ok"));
    await waitFor(() => expect(host.calls.some((c) => c.method === "DELETE" && c.path.includes("/skills/review"))).toBe(true));
  });
});

describe("E38: add skill", () => {
  function newHost(): FakeHost {
    const host = panelHost({ rows: [row("review", { targets: ["billing"] })] });
    host.routes.set("GET /api/plugins/team/skills/available", () => ({
      skills: [
        { name: "doc-summarizer", description: "Summarize documents", path: "/s/doc-summarizer", source: "~/.pi/agent/skills" },
        { name: "review", description: "Code review checklist", path: "/s/review", source: "~/.pi/agent/skills" },
      ],
    }));
    host.routes.set("POST /api/plugins/team/skills", ({ body }) => ({ ...(body as object), name: (body as { name: string }).name, source: "managed", valid: true, usage: { personas: 0, liveSessions: 0 } }));
    return host;
  }

  it("picker gates taken names; save stays disabled until a pick; a pick prefills name + path; save posts", async () => {
    const host = newHost();
    renderApp(<SkillForm />, host, "/skills/new");
    await screen.findByText("Telepített képesség");
    const save = await screen.findByTestId("skill-save");
    expect((save as HTMLButtonElement).disabled).toBe(true);
    // taken name is disabled with its reason
    const taken = document.querySelector('input[name="pick"][value="review"]') as HTMLInputElement;
    expect(taken.disabled).toBe(true);
    expect(document.querySelector('[data-skill="review"] .p-meta')?.textContent).toBe("Már a katalógusban");
    // pick the free one → prefill + save enabled
    fireEvent.click(document.querySelector('input[name="pick"][value="doc-summarizer"]') as HTMLInputElement);
    expect((document.getElementById("f-name") as HTMLInputElement).value).toBe("doc-summarizer");
    expect(document.querySelector(".path-line")?.textContent).toBe("/s/doc-summarizer");
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(host.calls.some((c) => c.method === "POST" && c.path.endsWith("/skills"))).toBe(true));
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/skills?project=billing"));
  });

  it("path source: a server path error is shown on the field and in the summary", async () => {
    const host = newHost();
    host.routes.set("POST /api/plugins/team/skills", () => new Response(JSON.stringify({ error: "invalid_skill", fields: { path: "inside_project" } }), { status: 400, headers: { "Content-Type": "application/json" } }));
    renderApp(<SkillForm />, host, "/skills/new");
    await screen.findByText("Telepített képesség");
    fireEvent.click(screen.getByText("Útvonal megadása"));
    fireEvent.change(await screen.findByLabelText("Útvonal"), { target: { value: "/work/billing/skill" } });
    fireEvent.change(document.getElementById("f-name") as HTMLInputElement, { target: { value: "mine" } });
    fireEvent.click(screen.getByTestId("skill-save"));
    // shown on the field AND in the summary
    await screen.findAllByText("Az útvonal egy projekt mappájában van. Válassz a projekteken kívüli helyet.");
    expect(document.getElementById("path-err")).toBeTruthy();
    expect(screen.getByText("A mentés nem sikerült")).toBeTruthy();
    expect(host.calls.filter((c) => c.method === "POST").length).toBe(1);
  });
});

describe("E38: edit skill (impact + confirm)", () => {
  function editHost(): FakeHost {
    const host = panelHost({ rows: [row("review", { targets: ["billing"], description: "Code review checklist", usage: { personas: 2, liveSessions: 2 } })] });
    host.routes.set("POST /api/plugins/team/skills/review/impact", () => ({
      endSessions: 2,
      blockedPersonas: [{ key: "shared:backend", name: "Backend", lostTargets: ["billing"] }],
      otherUsersPrivate: 1,
    }));
    host.routes.set("PATCH /api/plugins/team/skills/:name", ({ body }) => ({ name: "review", source: "managed", path: "/s/review", valid: true, usage: { personas: 0, liveSessions: 0 }, ...(body as object) }));
    return host;
  }

  it("narrowing shows the impact preview; save confirms (focus on Cancel, focus returns on close) then patches", async () => {
    const host = editHost();
    renderApp(<SkillForm name="review" />, host, "/skills/review");
    await screen.findByText("Hol használható");
    // static name + path in edit mode
    expect(screen.queryByLabelText("Név")).toBeNull();
    expect(screen.getAllByText("/s/review").length).toBeGreaterThan(0);
    // narrow: add crm, then drop billing → non-empty narrowed set
    fireEvent.click(document.querySelector('input[name="targetList"][value="crm"]') as HTMLInputElement);
    fireEvent.click(document.querySelector('input[name="targetList"][value="billing"]') as HTMLInputElement);
    await screen.findByText(/2 élő munkamenet leáll/);
    expect(screen.getByText("Backend")).toBeTruthy();
    expect(screen.getByText("billing-api")).toBeTruthy();
    expect(screen.getByText("+ 1 saját persona más felhasználóktól")).toBeTruthy();
    const save = screen.getByTestId("skill-save");
    save.focus(); // a real click focuses the opener before the dialog opens
    fireEvent.click(save);
    await screen.findByText("Mented a változást?");
    expect(document.activeElement).toBe(screen.getByTestId("dlg-cancel"));
    fireEvent.click(screen.getByTestId("dlg-cancel"));
    expect(document.activeElement).toBe(save);
    fireEvent.click(save);
    await screen.findByText("Mented a változást?");
    fireEvent.click(screen.getByTestId("dlg-ok"));
    await waitFor(() => expect(host.calls.some((c) => c.method === "PATCH")).toBe(true));
    const patch = host.calls.find((c) => c.method === "PATCH");
    expect((patch?.body ?? {}) as { targets: string[] }).toMatchObject({ targets: ["crm"] });
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/skills?project=billing"));
  });

  it("an empty target list fails locally with a focused summary and no request", async () => {
    const host = editHost();
    renderApp(<SkillForm name="review" />, host, "/skills/review");
    await screen.findByText("Hol használható");
    fireEvent.click(document.querySelector('input[name="targetList"][value="billing"]') as HTMLInputElement);
    await screen.findByText(/2 élő munkamenet leáll/);
    fireEvent.click(screen.getByTestId("skill-save"));
    await screen.findAllByText("Válassz legalább egy helyet.");
    expect(document.activeElement?.id).toBe("err-summary");
    expect(host.calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("a config entry is read-only: info callout, disabled fields, no save", async () => {
    const host = panelHost({ rows: [row("openspec-propose", { source: "config", path: "/w/openspec-propose" })] });
    renderApp(<SkillForm name="openspec-propose" />, host, "/skills/openspec-propose");
    await screen.findByText("Konfigurációból, csak olvasható");
    expect(screen.queryByTestId("skill-save")).toBeNull();
    expect((document.querySelector('input[name="targets"][value="*"]') as HTMLInputElement).disabled).toBe(true);
    expect((document.querySelector('input[name="users"][value="*"]') as HTMLInputElement).disabled).toBe(true);
  });

  it("single-user mode hides the users field", async () => {
    const host = panelHost({ me: { mode: "single" }, rows: [row("review")] });
    renderApp(<SkillForm name="review" />, host, "/skills/review");
    await screen.findByText("Hol használható");
    expect(document.querySelector('input[name="users"]')).toBeNull();
    expect(screen.getByText("Egyfelhasználós módban nincs felhasználói korlát.")).toBeTruthy();
  });
});
