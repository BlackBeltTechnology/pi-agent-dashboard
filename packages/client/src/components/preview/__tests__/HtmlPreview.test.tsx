/**
 * HtmlPreview frames a live-server static target (change:
 * improve-canvas-html-and-url-ux, test-plan #F14; file-and-url-preview spec).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));

import { clearGrantChannel, setGrantChannel } from "../../../lib/access-grants/grant-channel.js";
import { PreviewProvenance } from "../../../lib/access-grants/preview-provenance.js";
import { resetExposureStore } from "../../../lib/live-preview/exposure-store.js";
import { type FakeServers, installFakeLiveServer } from "../../editor-pane/__tests__/live-fake-api.js";
import { HtmlPreview } from "../HtmlPreview.js";

let fake: FakeServers;
const target = { kind: "file" as const, cwd: "/p", path: "mockups/a/index.html" };
const mounted = (ui: ReactNode) => render(<>{ui}</>);
const iframe = () => document.querySelector("iframe") as HTMLIFrameElement;
const startCall = () => fake.callsTo("/start-static", "POST")[0];

beforeEach(() => {
  resetExposureStore();
  fake = installFakeLiveServer();
  setGrantChannel("cap-live");
});
afterEach(() => {
  cleanup();
  fake.restore();
  clearGrantChannel();
});

describe("F14 — HtmlPreview frames a static target", () => {
  it("never carries srcdoc, whatever the provenance", async () => {
    for (const ui of [
      <PreviewProvenance autoOpened={false} key="o"><HtmlPreview target={target} /></PreviewProvenance>,
      <HtmlPreview key="n" target={target} />,
      <PreviewProvenance autoOpened key="a"><HtmlPreview target={target} /></PreviewProvenance>,
    ]) {
      mounted(ui);
      await waitFor(() => expect(iframe()).toBeTruthy());
      expect(iframe().hasAttribute("srcdoc")).toBe(false);
      expect(iframe().getAttribute("sandbox")).not.toContain("allow-same-origin");
      cleanup();
    }
  });

  it("registers the file as a static target with the surface's cwd + path", async () => {
    mounted(<HtmlPreview target={target} />);
    await waitFor(() => expect(iframe()).toBeTruthy());
    expect(startCall().body).toEqual({ cwd: "/p", path: "mockups/a/index.html" });
    expect(iframe().getAttribute("src")).toMatch(/\/index\.html$/);
  });

  it("operator surface → open egress with scripts (4 sandbox tokens)", async () => {
    mounted(<PreviewProvenance autoOpened={false}><HtmlPreview target={target} /></PreviewProvenance>);
    await waitFor(() => expect(iframe()).toBeTruthy());
    expect(fake.mints().at(-1)?.body).toMatchObject({ egress: "open", scripts: true });
    expect(iframe().getAttribute("sandbox")).toBe("allow-scripts allow-forms allow-popups allow-downloads");
  });

  it("an undeclared surface is restricted (the default)", async () => {
    mounted(<HtmlPreview target={target} />);
    await waitFor(() => expect(iframe()).toBeTruthy());
    expect(fake.mints().at(-1)?.body).toMatchObject({ egress: "restricted" });
    expect(iframe().getAttribute("sandbox")).not.toContain("allow-popups");
  });

  it("an agent-declared surface is restricted", async () => {
    mounted(<PreviewProvenance autoOpened><HtmlPreview target={target} /></PreviewProvenance>);
    await waitFor(() => expect(iframe()).toBeTruthy());
    expect(fake.mints().at(-1)?.body).toMatchObject({ egress: "restricted" });
  });

  it("Static (no scripts) renders the same document with an empty sandbox", async () => {
    mounted(<PreviewProvenance autoOpened={false}><HtmlPreview target={target} /></PreviewProvenance>);
    await waitFor(() => expect(iframe()).toBeTruthy());
    const before = iframe().getAttribute("src");
    fireEvent.click(screen.getByTestId("live-mode-static"));
    await waitFor(() => expect(iframe().getAttribute("sandbox")).toBe(""));
    expect(iframe().getAttribute("src")).toMatch(/\/index\.html$/);
    expect(before).toMatch(/\/index\.html$/);
  });

  it("a refused start keeps the denial notice and mints nothing", async () => {
    fake.staticRefusal = {
      status: 403,
      body: { success: false, error: "x", denialId: "d", subject: "/etc/hosts", promptOutcome: "ineligible" },
    };
    mounted(<HtmlPreview target={target} />);
    expect(await screen.findByTestId("denial-notice")).toBeTruthy();
    expect(iframe()).toBeNull();
    expect(fake.mints()).toHaveLength(0);
  });

  it("an undeclared surface starts the target opted out of the grant dialog", async () => {
    const seen: Array<string | null> = [];
    const real = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>;
    globalThis.fetch = vi.fn((u: string, i?: RequestInit) => {
      if (u.endsWith("/start-static")) seen.push(new Headers(i?.headers).get("X-Pi-Grant-Channel"));
      return real(u, i);
    }) as unknown as typeof fetch;
    mounted(<HtmlPreview target={target} />);
    await waitFor(() => expect(iframe()).toBeTruthy());
    expect(seen).toEqual([""]);
  });

  it("an observe-tier reader (the mint answers for a static target) still frames the page", async () => {
    // The raw-read tier admits the static mint; the viewer just frames what the server minted.
    mounted(<PreviewProvenance autoOpened={false}><HtmlPreview target={target} /></PreviewProvenance>);
    await waitFor(() => expect(iframe()).toBeTruthy());
    expect(iframe().getAttribute("src")).toContain("/live/stat1234/~c/");
  });
});

// rich-chat-links (test-plan #E28): `htmlMode: "static"` seeds the EXISTING Scripts ⇄ Static toggle.
describe("E28 — htmlMode static seeds the toggle", () => {
  const staticBtn = () => screen.getByTestId("live-mode-static");
  const scriptsBtn = () => screen.getByTestId("live-mode-scripts");

  it("starts at Static: empty sandbox, toggle on Static, scripts not requested", async () => {
    mounted(<PreviewProvenance autoOpened={false}><HtmlPreview target={target} htmlMode="static" /></PreviewProvenance>);
    await waitFor(() => expect(iframe()).toBeTruthy());
    expect(iframe().getAttribute("sandbox")).toBe("");
    expect(staticBtn().getAttribute("aria-checked")).toBe("true");
    expect(scriptsBtn().getAttribute("aria-checked")).toBe("false");
    expect(fake.mints().at(-1)?.body).toMatchObject({ scripts: false });
  });

  it("without htmlMode the toggle still starts at Scripts (unchanged)", async () => {
    mounted(<PreviewProvenance autoOpened={false}><HtmlPreview target={target} /></PreviewProvenance>);
    await waitFor(() => expect(iframe()).toBeTruthy());
    expect(scriptsBtn().getAttribute("aria-checked")).toBe("true");
  });

  it("the operator can still switch to Scripts from a Static start", async () => {
    mounted(<PreviewProvenance autoOpened={false}><HtmlPreview target={target} htmlMode="static" /></PreviewProvenance>);
    await waitFor(() => expect(iframe()).toBeTruthy());
    fireEvent.click(scriptsBtn());
    await waitFor(() => expect(iframe().getAttribute("sandbox")).toContain("allow-scripts"));
  });

  it("restricted exposure: the existing policy rules apply unchanged (Static start, Run scripts only once Scripts is chosen)", async () => {
    fake.policy = { exposure: "exposed", epoch: 3, promptingEnabled: false };
    mounted(<PreviewProvenance autoOpened><HtmlPreview target={target} htmlMode="static" /></PreviewProvenance>);
    await waitFor(() => expect(iframe()).toBeTruthy());
    expect(iframe().getAttribute("sandbox")).toBe("");
    expect(screen.queryByTestId("live-run-scripts")).toBeNull(); // scripts are not wanted yet
    fireEvent.click(scriptsBtn());
    expect(await screen.findByTestId("live-run-scripts")).toBeTruthy(); // exposed + restricted: gated as before
    expect(iframe().getAttribute("sandbox")).toBe("");
    expect(fake.mints().at(-1)?.body).toMatchObject({ egress: "restricted", scripts: false });
    expect(fake.mints().some((m) => m.body?.runScripts === true)).toBe(false);
  });
});
