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
