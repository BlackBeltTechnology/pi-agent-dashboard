/**
 * Persona editor (F12, F25). See change: add-team-plugin.
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PersonaEditor, slugFromName } from "../persona/PersonaEditor.js";
import { bootRoutes, json, makeHost, persona, project, renderApp } from "./helpers.js";

const PERSONAS = "GET /api/plugins/team/personas";

describe("F12: validation", () => {
  it("a 61-code-point name shows a field error and sends nothing", async () => {
    const host = makeHost();
    bootRoutes(host);
    host.routes.set(PERSONAS, () => ({ personas: [] }));
    renderApp(<PersonaEditor />, host, "/personas/new");
    const name = await screen.findByLabelText("Név");
    fireEvent.change(name, { target: { value: "😀".repeat(61) } });
    fireEvent.click(screen.getByTestId("save"));
    await screen.findByText("A név legfeljebb 60 karakter lehet.", { selector: "p" });
    expect(host.calls.some((c) => c.method === "POST" || c.method === "PUT")).toBe(false);
    expect(document.getElementById("err-summary")).toBeTruthy();
  });

  it("a server 400 field error is shown on the field and the save is not retried", async () => {
    const host = makeHost();
    bootRoutes(host);
    host.routes.set(PERSONAS, () => ({ personas: [] }));
    host.routes.set("POST /api/plugins/team/personas", () => json({ error: "invalid_persona", fields: { instructions: "too_long" } }, 400));
    renderApp(<PersonaEditor />, host, "/personas/new");
    fireEvent.change(await screen.findByLabelText("Név"), { target: { value: "Backend" } });
    fireEvent.click(screen.getByTestId("save"));
    await screen.findByText("Az utasítások legfeljebb 32 768 bájtosak lehetnek.", { selector: "p" });
    expect(host.calls.filter((c) => c.method === "POST").length).toBe(1);
  });

  it("`full` is absent for private personas and in multi-user mode; present for shared in single-user", async () => {
    let host = makeHost();
    bootRoutes(host, { admin: true, mode: "multi" });
    host.routes.set(PERSONAS, () => ({ personas: [] }));
    renderApp(<PersonaEditor />, host, "/personas/new");
    await screen.findByLabelText("Név");
    expect(document.querySelector('[data-tool="full"]')).toBeNull();
    fireEvent.click(screen.getByLabelText(/Közös sablon/));
    expect(document.querySelector('[data-tool="full"]')).toBeNull();
    document.body.innerHTML = "";

    host = makeHost();
    bootRoutes(host, { admin: true, mode: "single" });
    host.routes.set(PERSONAS, () => ({ personas: [] }));
    renderApp(<PersonaEditor />, host, "/personas/new");
    await screen.findByLabelText("Név");
    expect(document.querySelector('[data-tool="full"]')).toBeNull(); // private by default
    fireEvent.click(screen.getByLabelText(/Közös sablon/));
    expect(document.querySelector('[data-tool="full"]')).toBeTruthy();
  });

  it("slug derivation is accent-folded and slug-safe", () => {
    expect(slugFromName("Szövegíró Ügynök")).toBe("szovegiro-ugynok");
    expect(slugFromName("😀")).toBe("persona");
    expect(slugFromName("a".repeat(80)).length).toBe(40);
  });

  it("create retries a taken slug with a numeric suffix", async () => {
    const host = makeHost();
    bootRoutes(host);
    host.routes.set(PERSONAS, () => ({ personas: [] }));
    let n = 0;
    host.routes.set("POST /api/plugins/team/personas", ({ body }) => {
      n++;
      return n === 1 ? json({ error: "slug_taken" }, 409) : json({ ...(body as object), key: "private:x" }, 201);
    });
    renderApp(<PersonaEditor />, host, "/personas/new");
    fireEvent.change(await screen.findByLabelText("Név"), { target: { value: "Backend" } });
    fireEvent.click(screen.getByTestId("save"));
    await waitFor(() => expect(host.calls.filter((c) => c.method === "POST").map((c) => (c.body as { slug: string }).slug)).toEqual(["backend", "backend-2"]));
  });
});

describe("F25: project assignment", () => {
  it("a new private persona preselects own workspace + the current project; options = _ws + allowed; none ticked ⇒ field error, no request", async () => {
    const host = makeHost();
    bootRoutes(host, { admin: false }, [project("billing", { name: "billing-api" }), project("crm", { available: false })]);
    host.routes.set(PERSONAS, () => ({ personas: [] }));
    localStorage.setItem("team:target", "billing");
    renderApp(<PersonaEditor />, host, "/personas/new");
    await screen.findByLabelText("Név");
    const boxes = () => [...document.querySelectorAll<HTMLInputElement>('input[name="projects"]')];
    await waitFor(() => expect(boxes().map((b) => [b.value, b.checked])).toEqual([["_ws", true], ["billing", true]]));
    for (const b of boxes()) fireEvent.click(b); // untick all
    fireEvent.change(screen.getByLabelText("Név"), { target: { value: "X" } });
    fireEvent.click(screen.getByTestId("save"));
    await screen.findByText("Válassz legalább egy helyet.", { selector: "p" });
    expect(host.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("an admin editing a shared persona sees every configured project", async () => {
    const host = makeHost();
    bootRoutes(host, { admin: true }, [project("billing"), project("crm")]);
    host.routes.set(PERSONAS, () => ({ personas: [persona("shared:s", { projects: ["billing"] })] }));
    renderApp(<PersonaEditor editKey="shared:s" />, host, "/personas/shared%3As");
    await screen.findByLabelText("Név");
    const values = [...document.querySelectorAll<HTMLInputElement>('input[name="projects"]')].map((b) => b.value);
    expect(values).toEqual(["_ws", "billing", "crm"]);
  });

  it("fork keeps only usable projects, else own workspace", async () => {
    const host = makeHost();
    bootRoutes(host, { admin: false }, [project("billing")]);
    host.routes.set(PERSONAS, () => ({ personas: [persona("shared:s", { projects: ["crm", "billing"], tools: "full" })] }));
    renderApp(<PersonaEditor forkKey="shared:s" />, host, "/personas/new?fork=shared%3As");
    await screen.findByLabelText("Név");
    const checked = [...document.querySelectorAll<HTMLInputElement>('input[name="projects"]')].filter((b) => b.checked).map((b) => b.value);
    expect(checked).toEqual(["billing"]);
    expect(screen.getByText(/Másolat innen/)).toBeTruthy();
  });
});

const SKILLS = "GET /api/plugins/team/skills";

describe("E34: skills follow the targets", () => {
  it("ticking crm unticks + disables review (billing only), links the reason, announces the note, keeps focus", async () => {
    const host = makeHost();
    bootRoutes(host, { admin: true }, [project("billing", { name: "billing-api" }), project("crm", { name: "crm-web" })]);
    host.routes.set(PERSONAS, () => ({ personas: [] }));
    host.routes.set(SKILLS, () => ({
      skills: [{ name: "review", source: "managed", path: "/s/review", users: "*", targets: ["billing"], valid: true, usage: { personas: 0, liveSessions: 0 } }],
    }));
    renderApp(<PersonaEditor />, host, "/personas/new");
    localStorage.setItem("team:target", "_ws");
    await screen.findByLabelText("Név");
    const crm = (await waitFor(() => {
      const b = document.querySelector<HTMLInputElement>('input[name="projects"][value="crm"]');
      expect(b).toBeTruthy();
      return b as HTMLInputElement;
    })) as HTMLInputElement;
    const review = () => screen.getByRole("checkbox", { name: /review/ }) as HTMLInputElement;
    // own workspace is pre-ticked and review is not allowed there: untick it first
    fireEvent.click(document.querySelector<HTMLInputElement>('input[name="projects"][value="_ws"]') as HTMLInputElement);
    fireEvent.click(document.querySelector<HTMLInputElement>('input[name="projects"][value="billing"]') as HTMLInputElement);
    await waitFor(() => expect(review().disabled).toBe(false));
    fireEvent.click(review());
    expect(review().checked).toBe(true);
    crm.focus(); // a real click focuses the checkbox; keep it stable for the focus assertion
    fireEvent.click(crm);
    // unticked + disabled, reason linked via aria-describedby
    expect(review().checked).toBe(false);
    expect(review().disabled).toBe(true);
    const whyId = review().getAttribute("aria-describedby");
    expect(whyId).toBeTruthy();
    expect(document.getElementById(whyId as string)?.textContent).toContain("crm-web");
    // note announced (polite live region)
    expect(document.querySelector('[role="status"]')?.textContent).toContain("review");
    // focus stays on the project checkbox
    expect(document.activeElement).toBe(crm);
  });

  it("a skill allowed everywhere stays ticked when a target is added", async () => {
    const host = makeHost();
    bootRoutes(host, { admin: true }, [project("billing"), project("crm")]);
    host.routes.set(PERSONAS, () => ({ personas: [] }));
    host.routes.set(SKILLS, () => ({
      skills: [{ name: "all-ok", source: "managed", path: "/s/all-ok", users: "*", targets: "*", valid: true, usage: { personas: 0, liveSessions: 0 } }],
    }));
    renderApp(<PersonaEditor />, host, "/personas/new");
    await screen.findByLabelText("Név");
    const allOk = () => screen.getByRole("checkbox", { name: /all-ok/ }) as HTMLInputElement;
    await waitFor(() => expect(allOk().disabled).toBe(false));
    fireEvent.click(allOk());
    fireEvent.click(document.querySelector<HTMLInputElement>('input[name="projects"][value="billing"]') as HTMLInputElement);
    expect(allOk().checked).toBe(true);
    expect(allOk().disabled).toBe(false);
  });
});

describe("E35: empty catalog", () => {
  it("admin sees a hint linking to the Skills panel", async () => {
    const host = makeHost();
    bootRoutes(host, { admin: true });
    host.routes.set(PERSONAS, () => ({ personas: [] }));
    host.routes.set(SKILLS, () => ({ skills: [] }));
    renderApp(<PersonaEditor />, host, "/personas/new");
    await screen.findByText("Még nincs engedélyezett képesség.");
    fireEvent.click(screen.getByText("Képességek kezelése"));
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/skills?project=_ws"));
  });

  it("a member sees no Skills field at all", async () => {
    const host = makeHost();
    bootRoutes(host, { admin: false });
    host.routes.set(PERSONAS, () => ({ personas: [] }));
    host.routes.set(SKILLS, () => ({ skills: [] }));
    renderApp(<PersonaEditor />, host, "/personas/new");
    await screen.findByLabelText("Név");
    await waitFor(() => expect(host.calls.some((c) => c.path.endsWith("/skills"))).toBe(true));
    expect(screen.queryByText("Képességek", { selector: "legend" })).toBeNull();
    expect(document.querySelector('input[name="skills"]')).toBeNull();
  });
});
