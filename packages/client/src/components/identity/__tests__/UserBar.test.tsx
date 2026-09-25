/** D22 — user line pinned to the bottom of the session list. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/i18n/i18n.js", () => ({
  useI18n: () => ({ t: (_k: string, _v: unknown, fallback: string) => fallback, language: "en" }),
}));

import { initialsOf, UserBar } from "../UserBar.js";

afterEach(cleanup);

describe("UserBar (D22)", () => {
  it("shows name, email and provider, and signs out on click", () => {
    const onSignOut = vi.fn();
    render(<UserBar user={{ sub: "u", name: "Anna Kovacs", email: "anna@example.test" }} label="Keycloak" onSignOut={onSignOut} />);
    expect(screen.getByText("Anna Kovacs")).toBeTruthy();
    expect(screen.getByText(/anna@example\.test · Keycloak/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("falls back to email, then sub, for the display name", () => {
    render(<UserBar user={{ sub: "u-9", email: "bela@example.test" }} onSignOut={vi.fn()} />);
    expect(screen.getAllByText(/bela@example\.test/).length).toBeGreaterThan(0);
    cleanup();
    render(<UserBar user={{ sub: "u-9" }} onSignOut={vi.fn()} />);
    expect(screen.getByText("u-9")).toBeTruthy();
  });

  it("initials: two words → two letters; one word → one letter; nothing → ?", () => {
    expect(initialsOf("Anna Kovacs")).toBe("AK");
    expect(initialsOf("anna@example.test")).toBe("A");
    expect(initialsOf("")).toBe("?");
  });
});
