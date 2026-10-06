/**
 * AI Team app against a REAL dashboard + REAL pi sessions, identity armed.
 *
 * Covers (test-plan add-team-plugin): F22 same-origin sign-in lands back on the requested
 * `/apps/team/…` path and no unauthenticated `/api/plugins/team/*` request leaves the page; F15
 * a second user sees neither the first user's private persona nor can subscribe to their
 * session; F16 a persona edit flags the conversation and "Restart to apply" resumes it; the real
 * spawn is owner-stamped, uses pi's default per-cwd session folder (D15) and the guard extension
 * signalled ready (D7 — a session without it would have been aborted).
 * Model-driven behaviour (prompt round trip, guard blocking, prompt assembly) is in
 * team-llm.spec.ts.
 *
 * Needs the `pi` CLI on PATH.
 */
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import WebSocket from "ws";
import { API, bootTeamHarness, enc, hasPi, type TeamHarness, type User } from "./team-harness.js";

test.skip(!hasPi, "needs the pi CLI on PATH to spawn real sessions");
test.describe.configure({ mode: "serial", timeout: 180_000 });

let h: TeamHarness;
let anna: User;
let bela: User;

test.beforeAll(async ({ browser }) => {
  h = await bootTeamHarness();
  anna = await h.signInViaApp(browser, "anna", `/apps/team/agent/${enc("shared:backend")}`);
  bela = await h.signInViaApp(browser, "bela", "/apps/team/");
});
test.afterAll(async () => h?.stop());

test("F22: signed-out visit signs in via the dashboard seam, lands back on the requested app path, no team data before sign-in", async () => {
  expect(anna.unauthenticatedTeamRequests).toEqual([]);
  expect(new URL(anna.page.url()).pathname).toBe(`/apps/team/agent/${enc("shared:backend")}`);
  const me = await h.api(anna, "GET", "/me");
  expect(me.json).toMatchObject({ mode: "multi", admin: true });
  expect((await h.api(bela, "GET", "/me")).json.admin).toBe(false);
});

test("admin creates a shared persona; the grid shows it; opening it spawns a real guarded session", async () => {
  const created = await h.api(anna, "POST", "/personas", {
    slug: "backend",
    scope: "shared",
    name: "Backend",
    description: "Backend helper",
    instructions: "MARKER-BACKEND-INSTRUCTIONS",
    tools: "files",
  });
  expect(created.status, JSON.stringify(created.json)).toBe(201);

  await anna.page.goto(`${h.base}/apps/team/`);
  const card = anna.page.locator('[data-key="shared:backend"]');
  await expect(card).toBeVisible();
  await card.getByTestId("talk").click();
  // create = real pi spawn + guard-ready wait (≤ 30 s)
  await expect(anna.page).toHaveURL(/\/apps\/team\/agent\/shared%3Abackend\/c\//, { timeout: 60_000 });
  await expect(anna.page.getByText("Ügynök indítása…")).toHaveCount(0, { timeout: 90_000 });

  const convs = await h.api(anna, "GET", `/agents/${enc("shared:backend")}/conversations?project=_ws`);
  expect(convs.json.conversations.length).toBe(1);
  const team = (await h.sessions()).find((s) => s.cwd.includes(`${path.sep}workspace`));
  expect(team, "team session registered in the user's own workspace").toBeTruthy();
  expect(team?.principalOwner?.sub).toBe("sub-anna");
  const encoded = `--${String(team?.cwd).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  expect(team?.sessionFile ?? "").toContain(`${path.sep}${encoded}${path.sep}`);
  const usersDir = path.join(h.inst.home, ".pi", "dashboard", "team", "users");
  const rendered = fs.readdirSync(usersDir, { recursive: true }).map(String).find((f) => f.endsWith(path.join("runtime", "shared-backend", "persona.md")));
  expect(rendered, "persona.md rendered under runtime/").toBeTruthy();
  expect(fs.readFileSync(path.join(usersDir, rendered as string), "utf8")).toContain("MARKER-BACKEND-INSTRUCTIONS");
});

test("F15: bela sees none of anna's data and cannot subscribe to her session", async () => {
  await h.api(anna, "POST", "/personas", { slug: "secret", name: "Secret", instructions: "x" });
  const belaPersonas = await h.api(bela, "GET", "/personas");
  expect(belaPersonas.json.personas.map((p: { key: string }) => p.key)).not.toContain("private:secret");
  expect((await h.api(bela, "PUT", `/personas/${enc("private:secret")}`, { name: "x", instructions: "" })).status).toBe(404);

  const annaSession = (await h.sessions()).find((s) => s.cwd.includes(`${path.sep}workspace`))?.id;
  expect(annaSession).toBeTruthy();
  const ticketRes = await fetch(`${h.base}/api/ws-ticket`, { method: "POST", headers: { authorization: `Bearer ${bela.token()}`, "content-type": "application/json" }, body: JSON.stringify({ scope: "browser" }) });
  const ticket = ((await ticketRes.json()) as { data: { ticket: string } }).data.ticket;
  const frames: Array<{ type?: string; sessionId?: string }> = [];
  const ws = new WebSocket(`${h.base.replace("http", "ws")}/ws?ticket=${enc(ticket)}`, { headers: { Origin: h.base } });
  ws.on("message", (raw) => {
    try {
      frames.push(JSON.parse(raw.toString()));
    } catch {
      /* ignore */
    }
  });
  await new Promise<void>((res, rej) => {
    ws.once("open", () => res());
    ws.once("error", rej);
  });
  ws.send(JSON.stringify({ type: "subscribe", sessionId: annaSession, lastSeq: 0 }));
  await new Promise((r) => setTimeout(r, 2_500));
  ws.close();
  expect(frames.some((f) => f.sessionId === annaSession && (f.type === "event" || f.type === "event_replay"))).toBe(false);
});

test("F16: a persona edit flags the conversation; 'Restart to apply' resumes the same conversation", async () => {
  // The stale flag only applies to a LIVE session: make sure there is one first.
  const convId = (await h.api(anna, "GET", `/agents/${enc("shared:backend")}/conversations?project=_ws`)).json.conversations[0].id as string;
  expect((await h.api(anna, "POST", `/agents/${enc("shared:backend")}/conversations/${convId}/session?project=_ws`)).status).toBe(200);
  await expect
    .poll(async () => (await h.api(anna, "GET", `/agents/${enc("shared:backend")}/conversations?project=_ws`)).json.conversations[0].status, { timeout: 30_000 })
    .toMatch(/running|busy/);
  const upd = await h.api(anna, "PUT", `/personas/${enc("shared:backend")}`, { name: "Backend", description: "Backend helper", instructions: "MARKER-EDITED", tools: "files" });
  expect(upd.status).toBe(200);
  await anna.page.goto(`${h.base}/apps/team/`);
  const card = anna.page.locator('[data-key="shared:backend"]');
  await expect(card.getByText("Újraindítás a frissítéshez")).toBeVisible({ timeout: 20_000 });
  await card.getByText("Újraindítás a frissítéshez").first().click();
  await expect(card.getByText("Újraindítás a frissítéshez")).toHaveCount(0, { timeout: 20_000 });
  await card.getByTestId("talk").click();
  await expect(anna.page).toHaveURL(new RegExp(`/c/${convId}`));
  await expect(anna.page.getByText("Előző beszélgetés folytatása…")).toHaveCount(0, { timeout: 90_000 });
  const after = (await h.api(anna, "GET", `/agents/${enc("shared:backend")}/conversations?project=_ws`)).json.conversations;
  expect(after.map((c: { id: string }) => c.id)).toEqual([convId]);
  expect(after[0].personaStale).toBe(false);
  expect(API).toBe("/api/plugins/team");
});
