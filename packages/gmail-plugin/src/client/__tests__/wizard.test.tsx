// @vitest-environment jsdom
/**
 * L1 setup-wizard tests (test-plan E1, E2, E3). See change: add-gmail-plugin.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateClientJson } from "../../shared/client-json.js";
import { SetupWizard } from "../GmailSettings.js";
import { consoleLinks, errorStep, gcloudCommands } from "../wizard.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ID = "x.apps.googleusercontent.com";

describe("E1 — client JSON validation (decision table)", () => {
  it.each([
    [{ installed: { client_id: ID, client_secret: "s" } }, null],
    [{ web: { client_id: ID, client_secret: "s" } }, { code: "web_client", step: 4 }],
    [{ installed: { client_id: ID } }, { code: "missing_secret", step: 5 }],
    [{ installed: { client_id: "x.example.com", client_secret: "s" } }, { code: "bad_client_id", step: 4 }],
    ["{not json", { code: "not_json", step: 5 }],
  ])("%j → %j", (input, expected) => {
    const r = validateClientJson(typeof input === "string" ? input : JSON.stringify(input));
    if (expected === null) expect(r).toEqual({ ok: true, client: { clientId: ID, clientSecret: "s" } });
    else expect(r).toEqual({ ok: false, error: expected });
  });

  const state = { client: { configured: false }, accounts: [] };
  const uploadFile = (content: string) => {
    const input = screen.getByTestId("gmail-client-upload") as HTMLInputElement;
    const file = new File([content], "client_secret_1.json", { type: "application/json" });
    fireEvent.change(input, { target: { files: [file] } });
  };

  it("a valid Desktop client is uploaded (stored under `client`)", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const onUploaded = vi.fn();
    render(<SetupWizard state={state} highlight={null} onUploaded={onUploaded} />);
    uploadFile(JSON.stringify({ installed: { client_id: ID, client_secret: "s" } }));
    await waitFor(() => expect(onUploaded).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("/api/plugins/gmail/client", expect.objectContaining({ method: "PUT" }));
  });

  it("a web client is rejected locally with step-4 guidance and nothing is sent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<SetupWizard state={state} highlight={null} onUploaded={vi.fn()} />);
    uploadFile(JSON.stringify({ web: { client_id: ID, client_secret: "s" } }));
    const alert = await screen.findByTestId("gmail-upload-error");
    expect(alert.dataset.step).toBe("4");
    expect(alert.textContent).toMatch(/Desktop app/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("E2 — sign-in error → wizard step", () => {
  it.each([
    ["access_denied", 3],
    ["org_internal", 3],
    ["redirect_uri_mismatch", 4],
    ["invalid_client", 5],
  ])("%s → step %i", (code, step) => {
    expect(errorStep(code)).toBe(step);
  });
  it("unknown codes map to no step", () => {
    expect(errorStep("state_mismatch")).toBeNull();
  });
});

describe("E3 — deep links", () => {
  it("links carry ?project=<id>; gcloud commands contain the id", () => {
    const l = consoleLinks("my-proj-1");
    for (const u of [l.branding, l.audience, l.clientCreate, l.gmailApi]) expect(u).toContain("?project=my-proj-1");
    expect(l.branding).toBe("https://console.cloud.google.com/auth/branding?project=my-proj-1");
    expect(l.audience).toBe("https://console.cloud.google.com/auth/audience?project=my-proj-1");
    expect(l.clientCreate).toBe("https://console.cloud.google.com/auth/clients/create?project=my-proj-1");
    expect(gcloudCommands("my-proj-1")).toEqual([
      "gcloud projects create my-proj-1",
      "gcloud services enable gmail.googleapis.com --project my-proj-1",
    ]);
  });

  it("renders the links for the typed project id", () => {
    render(<SetupWizard state={{ client: { configured: false }, accounts: [] }} highlight={null} onUploaded={vi.fn()} />);
    fireEvent.change(screen.getByTestId("gmail-project-id"), { target: { value: "my-proj-1" } });
    const hrefs = [...document.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("https://console.cloud.google.com/auth/branding?project=my-proj-1");
    expect(document.body.textContent).toContain("gcloud services enable gmail.googleapis.com --project my-proj-1");
  });

  it("an invalid project id never reaches a gcloud command", () => {
    expect(gcloudCommands("x; rm -rf /")).toEqual([
      "gcloud projects create <project-id>",
      "gcloud services enable gmail.googleapis.com --project <project-id>",
    ]);
  });
});
