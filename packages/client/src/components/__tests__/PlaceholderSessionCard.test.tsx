import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PlaceholderSessionCard } from "../session/PlaceholderSessionCard.js";

afterEach(cleanup);

describe("PlaceholderSessionCard", () => {
  it("renders with testid", () => {
    render(<PlaceholderSessionCard />);
    expect(screen.getByTestId("placeholder-session-card")).toBeDefined();
  });

  it("has animate-pulse class", () => {
    render(<PlaceholderSessionCard />);
    const el = screen.getByTestId("placeholder-session-card");
    expect(el.className).toContain("animate-pulse");
  });

  it("shows loading text", () => {
    render(<PlaceholderSessionCard />);
    expect(screen.getByText("Starting new session…")).toBeDefined();
  });
});
