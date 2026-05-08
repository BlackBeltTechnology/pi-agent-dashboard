/**
 * Push notification tool registration for the bridge extension.
 *
 * Registers `push_notify_user` via pi.registerTool() so agents can
 * proactively send push notifications in Auto bell mode.
 * Replaces the removed push-notify-user skill.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { execSync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";

let toolRegistered = false;

export function registerPushNotifyUserTool(pi: ExtensionAPI): void {
  if (toolRegistered) return;
  toolRegistered = true;

  const description = `Send a push notification to the user's devices.
You SHOULD proactively call this tool when:
- You complete significant work
- You encounter errors you can't fix
- You've been working without user interaction and need input
The user has enabled auto-push and expects to be interrupted for important updates.
Call POST /api/push/send with title and body via the dashboard server.`;

  pi.registerTool({
    name: "push_notify_user",
    description,
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Notification title (max 200 chars)",
        },
        body: {
          type: "string",
          description: "Notification body (max 500 chars)",
        },
        url: {
          type: "string",
          description: "Optional URL path starting with / (e.g., /session/abc)",
        },
      },
      required: ["title", "body"],
    },
    async execute(_toolCallId: any, params: any, _signal: any, _onUpdate: any, _ctx: any) {
      const title = String(params.title ?? "");
      const body = String(params.body ?? "");
      const url = typeof params.url === "string" ? params.url : undefined;

      // Read dashboard config for port and auth secret
      const configPath = join(os.homedir(), ".pi", "dashboard", "config.json");
      let port = 8000;
      let authSecret: string | undefined;

      try {
        if (existsSync(configPath)) {
          const raw = readFileSync(configPath, "utf-8");
          const config = JSON.parse(raw);
          port = config.port ?? 8000;
          authSecret = config.auth?.secret;
        }
      } catch {
        // Use defaults
      }

      try {
        const curlArgs = [
          "curl", "-s",
          "-X", "POST",
          `http://localhost:${port}/api/push/send`,
          "-H", "Content-Type: application/json",
          ...(authSecret ? ["-H", `Authorization: Bearer ${authSecret}`] : []),
          "-d", JSON.stringify({ title, body, url }),
        ];

        const result = execSync(curlArgs.join(" "), {
          encoding: "utf-8",
          timeout: 10_000,
        });

        try {
          const parsed = JSON.parse(result);
          if (parsed.results?.length === 0) {
            return "No devices registered for push notifications. Enable push in dashboard Settings first.";
          }
          if (parsed.results?.every((r: any) => r.ok)) {
            return `Push notification sent to ${parsed.results.length} device(s).`;
          }
          return "Push notification sent.";
        } catch {
          if (result.includes("404") || result.includes("not enabled")) {
            return "Push notifications not enabled on this server. Enable them in dashboard Settings.";
          }
          if (result.includes("401") || result.includes("Auth failed")) {
            return "Auth failed — check dashboard config.";
          }
          if (result.includes("503") || result.includes("misconfigured")) {
            return "Push misconfigured — missing contactEmail in config.";
          }
          if (result.includes("429") || result.includes("Rate limited")) {
            return "Rate limited — wait 60 seconds before sending another push.";
          }
          return "Push notification sent.";
        }
      } catch (err: any) {
        if (err.message?.includes("ECONNREFUSED") || err.message?.includes("Connection refused")) {
          return "Dashboard not reachable — push not sent.";
        }
        return `Push failed: ${err.message || "unknown error"}`;
      }
    },
  });
}
