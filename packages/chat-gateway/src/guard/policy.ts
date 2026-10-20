/**
 * L3 tool-call policy — re-export of the shared PURE decision engine.
 *
 * The engine moved to `@blackbelt-technology/pi-dashboard-shared/tool-gate/policy.js`
 * so the dashboard bridge's supervised gate can reuse it. chat-gateway keeps the
 * deny-first posture: its policy is parsed with `allowedDefaults: ["deny","approve"]`
 * (see `index.ts`), so `"allow"` is never reachable here.
 *
 * See change: add-chat-gateway, add-supervised-tool-approval.
 */
export { decideToolCall } from "@blackbelt-technology/pi-dashboard-shared/tool-gate/policy.js";
