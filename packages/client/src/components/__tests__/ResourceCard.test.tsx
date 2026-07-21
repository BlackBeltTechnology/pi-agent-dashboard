/**
 * ResourceCard — base card, agent variant, theme variant, activation toggle.
 * See change: resources-card-tabs.
 */

import type { PiResource } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResourceActivationController } from "../../hooks/useResourceActivation.js";
import { ResourceCard } from "../resource/ResourceCard.js";

afterEach(() => cleanup());

function makeActivation(overrides?: Partial<ResourceActivationController>): ResourceActivationController {
  return {
    isEnabled: (r) => r.enabled,
    toggle: vi.fn(),
    pending: null,
    reload: vi.fn(),
    clearPending: vi.fn(),
    ...overrides,
  };
}

const skill: PiResource = {
  name: "code-review",
  description: "Review code before commit.",
  filePath: "/p/.pi/skills/code-review/SKILL.md",
  type: "skill",
  enabled: true,
};

describe("ResourceCard — base", () => {
  it("renders name, description, path, scope + source badges and fires onView", () => {
    const onView = vi.fn();
    render(<ResourceCard resource={skill} scope="local" onView={onView} />);
    const card = screen.getByTestId("resource-card");
    expect(within(card).getByText("code-review")).toBeTruthy();
    expect(within(card).getByText("Review code before commit.")).toBeTruthy();
    expect(within(card).getByText("/p/.pi/skills/code-review/SKILL.md")).toBeTruthy();
    expect(within(card).getByTestId("badge-scope").textContent).toContain("local");
    expect(within(card).getByTestId("badge-source").textContent).toContain("loose");
    fireEvent.click(card);
    expect(onView).toHaveBeenCalledOnce();
  });

  it("shows a package source badge for a package-contributed resource", () => {
    render(<ResourceCard resource={skill} scope="local" packageName="opsx" packageSource="npm:opsx" onView={vi.fn()} />);
    expect(screen.getByTestId("badge-source").textContent).toContain("opsx");
  });

  it("global scope renders the global badge", () => {
    render(<ResourceCard resource={{ ...skill, enabled: true }} scope="global" onView={vi.fn()} />);
    expect(screen.getByTestId("badge-scope").textContent).toContain("global");
  });

  it("toggle fires activation.toggle with the card scope and package source", () => {
    const activation = makeActivation();
    render(<ResourceCard resource={skill} scope="local" packageSource="npm:opsx" onView={vi.fn()} activation={activation} />);
    const toggle = screen.getByTestId("resource-activation-toggle");
    fireEvent.click(toggle);
    expect(activation.toggle).toHaveBeenCalledWith(skill, "local", "npm:opsx");
  });

  it("dims the card when the resource is disabled", () => {
    const activation = makeActivation({ isEnabled: () => false });
    render(<ResourceCard resource={skill} scope="local" onView={vi.fn()} activation={activation} />);
    expect(screen.getByTestId("resource-card").className).toContain("opacity-55");
  });
});

describe("ResourceCard — agent variant", () => {
  const agent: PiResource = {
    name: "react-expert",
    description: "React refactors.",
    filePath: "/p/.pi/agents/react-expert.md",
    type: "agent",
    enabled: true,
    model: "sonnet",
    tools: "edit,read",
  };

  it("renders model + tools badges", () => {
    render(<ResourceCard resource={agent} scope="local" onView={vi.fn()} />);
    expect(screen.getByTestId("badge-model").textContent).toContain("sonnet");
    expect(screen.getByTestId("badge-tools").textContent).toContain("edit,read");
  });

  it("omits the activation toggle (agents have no activation dimension)", () => {
    const activation = makeActivation();
    render(<ResourceCard resource={agent} scope="local" onView={vi.fn()} activation={activation} />);
    expect(screen.queryByTestId("resource-activation-toggle")).toBeNull();
  });
});

describe("ResourceCard — theme variant", () => {
  const theme: PiResource = {
    name: "midnight",
    description: "Dark theme.",
    filePath: "/g/.pi/agent/themes/midnight.json",
    type: "theme",
    enabled: true,
    colors: ["#0a0a0a", "#141414", "#3b82f6", "#e5e5e5"],
  };

  it("renders a swatch strip in place of the description row", () => {
    render(<ResourceCard resource={theme} scope="global" onView={vi.fn()} />);
    const swatch = screen.getByTestId("resource-card-swatch");
    expect(swatch.querySelectorAll("span").length).toBe(4);
    expect(screen.queryByText("Dark theme.")).toBeNull();
  });
});
