/**
 * Type-negative fixture for S1. Each intentionally-malformed `send()` is guarded
 * by `@ts-expect-error`: `tsc` errors on an UNUSED directive, so this file
 * compiles cleanly ONLY IF every bad payload is genuinely rejected by the types
 * AND the well-formed payload genuinely compiles. The S1 test runs `tsc` over
 * this file and asserts success.
 *
 * See OpenSpec change: add-dashboard-bus-client-scripting (test-plan #S1).
 */
import { BusClient } from "../../client.js";

const dash = new BusClient();

// @ts-expect-error — unknown verb type is not in BrowserToServerMessage.
dash.send({ type: "not_a_real_verb" });

// @ts-expect-error — spawn_session requires `cwd`.
dash.send({ type: "spawn_session" });

// @ts-expect-error — `cwd` must be a string, not a number.
dash.send({ type: "spawn_session", cwd: 123 });

// @ts-expect-error — abort requires `sessionId`.
dash.send({ type: "abort" });

// Well-formed payloads MUST compile with no directive.
dash.send({ type: "abort", sessionId: "s1" });
dash.send({ type: "spawn_session", cwd: "/proj" });
dash.send({ type: "send_prompt", sessionId: "s1", text: "hello" });
