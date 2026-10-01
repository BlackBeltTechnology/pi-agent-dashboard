/**
 * ChainEditor: boundary controls disabled, focus follows a moved entry,
 * incompatible backends hidden until revealed, off-machine options disabled.
 * See change: add-system-one-registry.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { BackendView, Draft } from "../api.js";
import { ChainEditor } from "../ChainEditor.js";

afterEach(cleanup);

const caps = (ctx: number | null) => ({ maxContextTokens: ctx, maxOptions: null, languages: null, primitives: null });
const v = (over: Partial<BackendView> = {}): BackendView => ({
  capabilities: caps(null),
  offMachine: false,
  egress: "loopback",
  keyRef: null,
  languageLabel: null,
  priceUsdPerMTok: null,
  managed: null,
  ...over,
});
const draft: Draft = {
  allowOffMachine: false,
  backends: {
    von: { kind: "managed", engine: "von" },
    kev: { kind: "http", url: "http://127.0.0.1:1/x", model: "kev" },
    laya: { kind: "managed", engine: "laya" },
    jev: { kind: "http", url: "https://x", model: "jev-1.13.0" },
  },
  presets: { p: { chain: ["von", "kev"] } },
  activePreset: "p",
};
const views = { von: v({ capabilities: caps(8192) }), kev: v(), laya: v({ capabilities: caps(512) }), jev: v({ offMachine: true, egress: "hosted" }) };

function Harness({ consumer }: { consumer?: any }) {
  const [chain, setChain] = useState(["von", "kev"]);
  return <ChainEditor idPrefix="t" chain={chain} draft={draft} views={views} onChange={setChain} consumer={consumer} />;
}

describe("ChainEditor", () => {
  it("disables boundary moves and keeps focus on the moved entry", () => {
    render(<Harness />);
    expect((screen.getByLabelText("Move von up") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Move kev down") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Move kev up"));
    expect(screen.getByTestId("t-entry-0").textContent).toContain("kev");
    // moved to the top: its "up" is now disabled, so focus lands on its "down"
    expect(document.activeElement).toBe(screen.getByLabelText("Move kev down"));
  });

  it("disables off-machine backends while the switch is off", () => {
    render(<Harness />);
    const jev = screen.getByRole("option", { name: /^jev/ }) as HTMLOptionElement;
    expect(jev.disabled).toBe(true);
    expect(jev.textContent).toContain("off-machine, disabled");
  });

  it("hides incompatible backends until revealed, then warns", () => {
    render(<Harness consumer={{ id: "c", failurePolicy: "fail-open", requires: { minContextTokens: 4000 } }} />);
    expect(screen.queryByRole("option", { name: /^laya/ })).toBeNull();
    fireEvent.click(screen.getByTestId("t-show-incompat"));
    expect(screen.getByRole("option", { name: /^laya/ }).textContent).toContain("incompatible: context 512 < 4000");
    expect(screen.getByTestId("t-incompat-warning")).toBeTruthy();
  });
});
