/**
 * Demo plugin client entry.
 * Fixture for dashboard-plugin-runtime end-to-end tests.
 * DO NOT use in production.
 */

import { oauthFlowClient, useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import { usePluginConfig, usePluginSend } from "@blackbelt-technology/dashboard-plugin-runtime/context";
import type React from "react";
import { lazy, useCallback, useEffect, useRef, useState } from "react";

export interface DemoConfig {
  greeting: string;
  count: number;
}

/**
 * DemoSettings — rendered in the General tab of SettingsPanel.
 */
export function DemoSettings() {
  const config = usePluginConfig<DemoConfig>();
  const send = usePluginSend();
  const [greeting, setGreeting] = useState(config.greeting ?? "");
  const [count, setCount] = useState(String(config.count ?? 0));

  return (
    <div
      data-testid="demo-settings"
      style={{ border: "1px dashed #555", padding: "8px", borderRadius: "4px" }}
    >
      <div style={{ fontSize: "11px", color: "#999", marginBottom: "4px" }}>
        Demo Plugin (fixture — dev/test only)
      </div>
      <label style={{ display: "block", marginBottom: "4px" }}>
        <span style={{ fontSize: "12px" }}>Greeting</span>
        <input
          data-testid="demo-greeting"
          type="text"
          value={greeting}
          onChange={(e) => setGreeting(e.target.value)}
          style={{ marginLeft: "8px", fontSize: "12px" }}
        />
      </label>
      <label style={{ display: "block", marginBottom: "4px" }}>
        <span style={{ fontSize: "12px" }}>Count</span>
        <input
          data-testid="demo-count"
          type="number"
          value={count}
          onChange={(e) => setCount(e.target.value)}
          style={{ marginLeft: "8px", fontSize: "12px" }}
        />
      </label>
      <button
        data-testid="demo-save"
        onClick={() =>
          send({
            type: "plugin_config_write",
            id: "demo",
            config: { greeting, count: parseInt(count, 10) || 0 },
          })
        }
        style={{ fontSize: "12px", padding: "2px 8px" }}
      >
        Save
      </button>
      <DemoSignIn />
    </div>
  );
}

type FlowState = React.ComponentProps<ReturnType<typeof useUiPrimitive<"ui:oauth-flow">>>["flow"];

type FlowStatus = NonNullable<FlowState["status"]>;

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** `complete`, or the flow's error / terminal status. */
function terminalOutcome(status: FlowStatus): string {
  if (status.status === "complete") return "complete";
  return status.error ?? status.status;
}

/** Poll a flow every 500 ms: `onPending` while pending, `onDone(outcome)` once terminal. */
function useFlowPoll(
  flowId: string | undefined,
  onPending: (status: FlowStatus) => void,
  onDone: (outcome: string) => void,
) {
  const pendingRef = useRef(onPending);
  const doneRef = useRef(onDone);
  pendingRef.current = onPending;
  doneRef.current = onDone;
  useEffect(() => {
    if (!flowId) return;
    let stopped = false;
    const tick = () =>
      oauthFlowClient.status(flowId).then(
        (status) => {
          if (stopped) return;
          if (status.status === "pending") pendingRef.current(status);
          else doneRef.current(terminalOutcome(status));
        },
        (err: unknown) => {
          if (!stopped) doneRef.current(errorText(err));
        },
      );
    const timer = setInterval(() => { void tick(); }, 500);
    return () => { stopped = true; clearInterval(timer); };
  }, [flowId]);
}

/**
 * DemoSignIn — exercises the plugin OAuth seam end-to-end: POST
 * /api/plugins/demo/sign-in starts a fake flow via `ctx.oauth.startFlow`, the
 * flow renders through the `ui:oauth-flow` primitive, and completion persists
 * via `ctx.credentials`. See change: expose-plugin-credential-and-oauth-seams (D8).
 */
function DemoSignIn() {
  const OAuthFlow = useUiPrimitive("ui:oauth-flow");
  const [flow, setFlow] = useState<FlowState | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  const refreshAccount = useCallback(async () => {
    try {
      const res = await fetch("/api/plugins/demo/account");
      if (res.ok) setSignedIn(((await res.json()) as { signedIn?: boolean }).signedIn === true);
    } catch { /* fixture: best-effort */ }
  }, []);

  useEffect(() => { void refreshAccount(); }, [refreshAccount]);

  const flowId = flow?.status?.flowId;
  useFlowPoll(flowId, (status) => setFlow({ phase: "waiting", status }), (outcomeText) => {
    setFlow(null);
    setOutcome(outcomeText);
    void refreshAccount();
  });

  const start = async () => {
    setOutcome(null);
    setFlow({ phase: "starting" });
    try {
      const res = await fetch("/api/plugins/demo/sign-in", { method: "POST" });
      const body = (await res.json()) as { flowId?: string; error?: string };
      if (!res.ok || !body.flowId) throw new Error(body.error ?? `HTTP ${res.status}`);
      setFlow({ phase: "waiting", status: await oauthFlowClient.status(body.flowId) });
    } catch (err) {
      setFlow(null);
      setOutcome(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div data-testid="demo-oauth" style={{ marginTop: "8px" }}>
      <div data-testid="demo-oauth-account" style={{ fontSize: "12px" }}>
        {signedIn ? "signed in" : "signed out"}
      </div>
      {outcome && (
        <div data-testid="demo-oauth-outcome" style={{ fontSize: "12px" }}>{outcome}</div>
      )}
      {flow ? (
        <OAuthFlow
          flow={flow}
          onSendInput={(id, value) => oauthFlowClient.input(id, value)}
          onCancel={(id) => { void oauthFlowClient.cancel(id); }}
        />
      ) : (
        <button
          type="button"
          data-testid="demo-oauth-start"
          onClick={() => void start()}
          style={{ fontSize: "12px", padding: "2px 8px" }}
        >
          Start demo sign-in
        </button>
      )}
    </div>
  );
}

/**
 * DemoToolRenderer — renders any tool_call with toolName "DashboardDemo".
 */
export function DemoToolRenderer({
  toolName,
  toolInput,
}: {
  toolName: string;
  toolInput: Record<string, unknown>;
  sessionId: string;
}) {
  return (
    <div
      data-testid="demo-tool-renderer"
      style={{
        background: "#1a3a1a",
        border: "1px solid #4a9a4a",
        borderRadius: "4px",
        padding: "8px",
        fontFamily: "monospace",
        fontSize: "12px",
      }}
    >
      <span style={{ color: "#4a9a4a" }}>✓ DemoPlugin</span>{" "}
      <span style={{ color: "#ccc" }}>{toolName}</span>
      {Object.keys(toolInput).length > 0 && (
        <pre style={{ margin: "4px 0 0 0", color: "#aaa" }}>
          {JSON.stringify(toolInput, null, 2)}
        </pre>
      )}
    </div>
  );
}

/**
 * Embedded fixture app route (`shell-overlay-route`, `presentation: "content"`).
 * `React.lazy` keeps the app module out of the statically-imported client
 * entry's chunk (the generated registry imports this file eagerly).
 * See change: add-plugin-app-host (task 2.8, D8).
 */
export const DemoAppRoute = lazy(() => import("./demo-app/DemoAppRoute.js"));
