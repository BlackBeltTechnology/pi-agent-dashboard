/**
 * E31 — `OAuthFlowView` is registered as the `ui:oauth-flow` UI primitive and
 * renders the auth link + paste field for a `manual_code` status; answering
 * and cancelling go through the host callbacks.
 * See change: expose-plugin-credential-and-oauth-seams (D6).
 */
import fs from "node:fs";
import path from "node:path";
import { useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import { withUiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import type { UiOAuthFlowViewProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OAuthFlowView } from "../components/settings/OAuthFlowView.js";

afterEach(cleanup);

function PluginSlot(props: UiOAuthFlowViewProps) {
  const View = useUiPrimitive("ui:oauth-flow");
  return <View {...props} />;
}

const manualFlow: UiOAuthFlowViewProps["flow"] = {
  phase: "waiting",
  status: {
    flowId: "f1",
    provider: "plugin:demo:k",
    status: "pending",
    authUrl: "https://example.test/authorize?state=s",
    pending: { kind: "manual_code", message: "Paste the code" },
  },
};

describe("ui:oauth-flow primitive (E31)", () => {
  it("renders via useUiPrimitive: auth link + paste field; submit and cancel reach the host", async () => {
    const onSendInput = vi.fn(async () => {});
    const onCancel = vi.fn();
    render(
      withUiPrimitiveProvider(
        { "ui:oauth-flow": OAuthFlowView },
        <PluginSlot flow={manualFlow} onSendInput={onSendInput} onCancel={onCancel} />,
      ),
    );
    const link = screen.getByRole("link", { name: /example\.test\/authorize/ });
    expect(link.getAttribute("href")).toBe("https://example.test/authorize?state=s");
    expect(screen.getByLabelText("Paste the code")).toBeTruthy();

    fireEvent.change(screen.getByTestId("dialog-input-field"), { target: { value: "ok" } });
    fireEvent.click(screen.getByTestId("dialog-input-submit"));
    await waitFor(() => expect(onSendInput).toHaveBeenCalledWith("f1", "ok"));

    fireEvent.click(screen.getByTestId("dialog-cancel"));
    expect(onCancel).toHaveBeenCalledWith("f1");
  });

  it("renders nothing once the flow is no longer starting/waiting", () => {
    const { container } = render(
      <OAuthFlowView flow={{ phase: "error", error: "x" }} onSendInput={async () => {}} onCancel={() => {}} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("is registered under ui:oauth-flow at client startup (main.tsx)", () => {
    const main = fs.readFileSync(path.resolve(__dirname, "../main.tsx"), "utf-8");
    expect(main).toMatch(/registerUiPrimitive\(primitiveRegistry, UI_PRIMITIVE_KEYS\.oauthFlow, OAuthFlowView\)/);
  });
});
