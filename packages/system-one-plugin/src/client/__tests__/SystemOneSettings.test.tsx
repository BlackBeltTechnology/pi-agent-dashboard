/**
 * SystemOneSettings: shared settings groups, danger Remove, visible add-backend
 * validation (test-plan #E24) and plain-sentence errors with details on demand
 * (test-plan #X7). No SettingsDraftProvider is mounted, so `useSettingsDraftSource`
 * is a no-op; the draft id stays `plugin:system-one`.
 * See change: retro-ux-plugin-settings-wave-2.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackendView, ConfigResponse } from "../api.js";
import { SystemOneSettings } from "../SystemOneSettings.js";

const view = (over: Partial<BackendView> = {}): BackendView => ({
  capabilities: { maxContextTokens: 8192, maxOptions: null, languages: null, primitives: null },
  offMachine: false,
  egress: "loopback",
  keyRef: null,
  languageLabel: null,
  priceUsdPerMTok: null,
  managed: { state: "stopped" },
  ...over,
});

function config(over: { views?: Record<string, BackendView> } = {}): ConfigResponse {
  return {
    revision: "r1",
    exists: true,
    path: "~/.pi/agent/system-one.json",
    config: {
      allowOffMachine: false,
      backends: { von: { kind: "managed", engine: "von" } },
      presets: { default: { chain: ["von"] } },
      activePreset: "default",
      calibration: {},
    },
    backends: over.views ?? { von: view() },
  };
}

function jsonRes(status: number, body: unknown): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

/** Routes GET /config, /keys, /consumers; `extra` handles anything else (e.g. POST /keys/…). */
function stubApi(opts: {
  config?: () => Response;
  keys?: Record<string, { set: boolean; source: "env" | "file" | null }>;
  extra?: (method: string, url: string) => Response | undefined;
}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      const extra = opts.extra?.(method, u);
      if (extra) return extra;
      if (method === "GET" && u.endsWith("/config")) return (opts.config ?? (() => jsonRes(200, config())))();
      if (method === "GET" && u.endsWith("/keys")) return jsonRes(200, { keys: opts.keys ?? {} });
      if (method === "GET" && u.endsWith("/consumers")) return jsonRes(200, { consumers: [] });
      throw new Error(`unexpected request: ${method} ${u}`);
    }),
  );
}

let copied: string[] = [];
beforeEach(() => {
  copied = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn(async (text: string) => {
        copied.push(text);
      }),
    },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("hierarchy, danger Remove, add-backend validation (test-plan #E24)", () => {
  it("renders four settings groups, no nested card shadow, no repeated plugin title", async () => {
    stubApi({});
    render(<SystemOneSettings />);
    const body = await screen.findByTestId("system-one-settings");

    for (const id of ["s1-h-privacy", "s1-h-preset", "s1-h-backends", "s1-h-consumers"]) {
      const title = body.querySelector(`#${id}`);
      expect(title, id).toBeTruthy();
      expect(title?.closest("details"), `${id} is a settings group`).toBeTruthy();
    }
    expect(body.innerHTML).not.toContain("shadow-card");
    expect(body.innerHTML).not.toContain("elevation-rim");
    // #E7: no heading repeating the plugin's display name or id
    const headings = Array.from(body.querySelectorAll("h1,h2,h3,h4,h5,h6")).map((h) => h.textContent ?? "");
    expect(headings.some((h) => /decision models \(system 1\)|^system-one$/i.test(h))).toBe(false);
    // the lead paragraph and config path are still shown
    expect(body.querySelector("code")?.textContent).toBe("~/.pi/agent/system-one.json");
  });

  it("Remove is danger-toned and named after the backend; Start is neutral; status reads as words", async () => {
    stubApi({});
    render(<SystemOneSettings />);
    const item = await screen.findByTestId("backend-von");
    const remove = within(item).getByRole("button", { name: "Remove von" });
    const start = within(item).getByRole("button", { name: "Start von" });
    expect(remove.className).toContain("severity-error");
    expect(start.className).not.toContain("severity-error");
    expect(within(item).getByTestId("managed-status").textContent).toContain("Stopped");
    expect(item.textContent).toContain("On-machine");
  });

  it("shows linked, visible id and URL errors and keeps Add backend disabled", async () => {
    stubApi({});
    render(<SystemOneSettings />);
    const panel = await screen.findByTestId("add-backend");
    const submit = panel.querySelector('button[type="submit"]') as HTMLButtonElement;
    const idInput = within(panel).getByLabelText("Backend id") as HTMLInputElement;

    fireEvent.change(idInput, { target: { value: "-bad" } });
    expect(idInput.getAttribute("aria-invalid")).toBe("true");
    const idMsg = document.getElementById(idInput.getAttribute("aria-describedby")?.split(" ").pop() ?? "");
    expect(idMsg?.textContent ?? "").toMatch(/letter or digit/i);
    expect(submit.disabled).toBe(true);

    fireEvent.change(idInput, { target: { value: "von" } });
    const dupMsg = document.getElementById(idInput.getAttribute("aria-describedby")?.split(" ").pop() ?? "");
    expect(dupMsg?.textContent ?? "").toMatch(/already used/i);
    expect(submit.disabled).toBe(true);

    fireEvent.click(within(panel).getByLabelText(/HTTP endpoint/));
    fireEvent.change(within(panel).getByLabelText("Backend id"), { target: { value: "jev" } });
    const urlInput = within(panel).getByLabelText("URL") as HTMLInputElement;
    fireEvent.change(urlInput, { target: { value: "ftp://x" } });
    expect(urlInput.getAttribute("aria-invalid")).toBe("true");
    const urlMsg = document.getElementById(urlInput.getAttribute("aria-describedby")?.split(" ").pop() ?? "");
    expect(urlMsg?.textContent ?? "").toMatch(/only http and https/i);
    expect(submit.disabled).toBe(true);

    fireEvent.change(urlInput, { target: { value: "https://x.example/v1" } });
    expect(urlInput.getAttribute("aria-invalid")).toBeNull();
    expect(submit.disabled).toBe(false);
  });
});

describe("errors as sentences, codes only in Copy details (test-plan #X7)", () => {
  it("damaged config: sentence + Try again + Copy details; no E_PARSE visible", async () => {
    stubApi({ config: () => jsonRes(500, { error: "E_PARSE" }) });
    render(<SystemOneSettings />);
    const notice = await screen.findByTestId("system-one-load-error");
    expect(notice.textContent).not.toContain("E_PARSE");
    expect(notice.textContent).toContain("system-one.json");
    expect(within(notice).getByRole("button", { name: "Try again" })).toBeTruthy();
    fireEvent.click(within(notice).getByRole("button", { name: "Copy details" }));
    await waitFor(() => expect(copied.join(" ")).toContain("E_PARSE"));
  });

  it("key save failure: sentence tied to the field, code only via Copy details", async () => {
    stubApi({
      config: () => jsonRes(200, config({ views: { von: view({ keyRef: "TJ_KEY", managed: null }) } })),
      keys: { TJ_KEY: { set: false, source: null } },
      extra: (method, url) => (method === "POST" && url.includes("/keys/") ? jsonRes(400, { error: "E_KEY" }) : undefined),
    });
    render(<SystemOneSettings />);
    const box = await screen.findByTestId("key-TJ_KEY");
    const input = within(box).getByLabelText("API key") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "sk-123" } });
    fireEvent.click(within(box).getByRole("button", { name: "Save key" }));

    await waitFor(() => expect(input.getAttribute("aria-invalid")).toBe("true"));
    expect(box.textContent).not.toContain("E_KEY");
    const msg = document.getElementById(input.getAttribute("aria-describedby")?.split(" ").pop() ?? "");
    expect(msg?.textContent ?? "").toMatch(/could not be saved/i);
    fireEvent.click(within(box).getByRole("button", { name: "Copy details" }));
    await waitFor(() => expect(copied.join(" ")).toContain("E_KEY"));
  });
});
