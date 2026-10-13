/**
 * RoleRef — the shared role-ref display (spec model-selector "Role refs render
 * through one shared display"). See change: retro-ux-model-selector.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RoleRef } from "../RoleRef.js";

afterEach(cleanup);

const here = dirname(fileURLToPath(import.meta.url));
const src = (f: string) => readFileSync(join(here, "..", f), "utf8");

describe("RoleRef follows mode (E1)", () => {
  it("shows the role token, a short model id, the level chip and keeps provider/id in textContent", () => {
    const { container } = render(<RoleRef role="@fast" model="anthropic/claude-haiku-4-5" level="low" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.querySelector("[data-role-ref-token]")?.textContent).toBe("@fast");
    const model = root.querySelector("[data-role-ref-model]") as HTMLElement;
    expect(model.textContent).toContain("anthropic/claude-haiku-4-5");
    expect(model.querySelector(".sr-only")?.textContent).toBe("anthropic/");
    expect(Array.from(model.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join("")).toBe("claude-haiku-4-5");
    const level = root.querySelector("[data-role-ref-level]") as HTMLElement;
    expect(level.textContent).toContain("low");
    expect(level.querySelector(".sr-only")?.textContent).toContain("thinking");
    expect(root.hasAttribute("aria-label")).toBe(false);
    expect(root.querySelector("[aria-label]")).toBeNull();
  });
});

describe("RoleRef once / unresolved / labels (E2)", () => {
  it("once mode shows the model then 'from @fast' and no role token", () => {
    const { container } = render(<RoleRef role="@fast" model="anthropic/claude-haiku-4-5" mode="once" />);
    expect(container.querySelector("[data-role-ref-token]")).toBeNull();
    expect(container.querySelector("[data-role-ref-from]")?.textContent).toBe("from @fast");
    expect(container.textContent).toContain("claude-haiku-4-5");
  });

  it("no model value → warning pill 'No model assigned'", () => {
    const { container } = render(<RoleRef role="@research" />);
    const pill = container.querySelector("[data-role-ref-unassigned]") as HTMLElement;
    expect(pill.textContent).toBe("No model assigned");
    expect(pill.className).toContain("--severity-warning-bg");
    expect(pill.className).toContain("--severity-warning-fg");
    expect(container.querySelector("[data-role-ref-model]")).toBeNull();
  });

  it("uses passed labels", () => {
    const { container } = render(<RoleRef role="@fast" labels={{ noModel: "Nincs modell" }} />);
    expect(container.textContent).toContain("Nincs modell");
    const { container: c2 } = render(<RoleRef role="fast" model="a/b" mode="once" labels={{ from: "innen:" }} />);
    expect(c2.querySelector("[data-role-ref-from]")?.textContent).toBe("innen: @fast");
  });

  it("a dangling slot with a last model shows the model, not the pill", () => {
    const { container } = render(<RoleRef role="@fast" model="anthropic/claude-sonnet-4-5" />);
    expect(container.querySelector("[data-role-ref-unassigned]")).toBeNull();
    expect(container.textContent).toContain("anthropic/claude-sonnet-4-5");
  });
});

describe("RoleRef runtime boundary (E3)", () => {
  it("is exported and neither imports the client nor fetches", () => {
    expect(src("index.ts")).toMatch(/export \{ RoleRef \} from "\.\/RoleRef\.js"/);
    const body = src("RoleRef.tsx");
    expect(body).not.toMatch(/packages\/client|pi-dashboard-client-utils|from "[^"]*\/client\//);
    expect(body).not.toContain("fetch(");
  });
});
