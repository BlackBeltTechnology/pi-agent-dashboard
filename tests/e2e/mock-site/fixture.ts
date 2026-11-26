import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root (this file lives at tests/e2e/mock-site/). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const MARKER = path.join(os.tmpdir(), "pi-mock-site-e2e.json");
export const FIXTURE_MOCK = "2026-11-04-e2e-fixture";
export const PILLS_MOCK = "2026-11-03-session-pills";
export const SCRIPTED_MOCK = "2026-11-07-e2e-scripted";
export const SOLID_MOCK = "2026-11-07-e2e-solid";
/** mock-player-step-controls fixtures: dated older than the others, so they never become the default page. */
export const STAGE_MOCK = "2026-10-03-e2e-stage";
export const GUARD_MOCK = "2026-10-02-e2e-guard";
export const STEP_MOCK = "2026-10-01-e2e-step";
/** The F4 pane: the app module focuses an element at module top level (before setup / render). */
export const EARLY_FOCUS_PANE = `${GUARD_MOCK}/1/proposed`;

export type Marker = { root: string; port: number; pid: number; url: string };
export const readMarker = (): Marker => JSON.parse(fs.readFileSync(MARKER, "utf8")) as Marker;

const pkg = (p: string) => path.join(REPO_ROOT, "packages", p);

/**
 * Scripted / fixture scenarios (add-mock-site-exact-env test-plan E11, E12, F3-F5, F7-F10).
 * Frames: 1 late target (3000 ms, default timeout) · 2 never target · 3 target at 1500 ms with
 * timeout 1000 · 4 unless/expect · 5 stateful fixture toggle, both panes, 3-step script ·
 * 6 WebSocket fixture · 7 unfixtured GET · 8 typing (runs beside 5) · 9 counter (reduced motion).
 */
const SCRIPTED_SRC = `import { useEffect, useState } from "react";
import type { Fixtures, Mock } from "mock-site/kit";
function Late({ ms, id }: { ms: number; id: string }) {
  const [on, setOn] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOn(true), ms); return () => clearTimeout(t); }, [ms]);
  return <div>{on ? <button type="button" data-testid={id}>{id}</button> : "waiting"}</div>;
}
function Raw() {
  const [clicks, setClicks] = useState(0);
  return <div><input data-testid="raw-input" defaultValue="0 17 * * *" /><button type="button" data-testid="raw-toggle" onClick={() => setClicks((c) => c + 1)}>toggle</button><span data-testid="raw-clicks">clicks: {clicks}</span></div>;
}
function Flag() {
  const [on, setOn] = useState<boolean | null>(null);
  const [aim, setAim] = useState("");
  const load = () => fetch("/api/flag").then((r) => r.json()).then((d) => setOn(d.on));
  useEffect(() => { void load(); }, []);
  const click = async (e: React.MouseEvent) => {
    const c = document.querySelector<HTMLElement>(".mk-cursor");
    const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (c) setAim(Math.abs(Number(c.dataset.x) - (b.left + b.width / 2)) <= 2 && Math.abs(Number(c.dataset.y) - (b.top + b.height / 2)) <= 2 ? "on-target" : "off-target");
    await fetch("/api/flag", { method: "POST" });
    await load();
  };
  return <div data-flag={on === null ? "loading" : on ? "on" : "off"}>flag: {on === null ? "..." : on ? "on" : "off"} <button type="button" data-testid="toggle" onClick={click}>toggle</button> <span data-testid="aim">{aim}</span></div>;
}
function Feed() {
  const [msg, setMsg] = useState("connecting");
  useEffect(() => { const ws = new WebSocket(\`ws://\${location.host}/ws/feed\`); ws.onmessage = (e) => setMsg(String(e.data)); return () => ws.close(); }, []);
  return <div data-testid="feed">{msg}</div>;
}
function Unmocked() {
  const [s, setS] = useState("loading");
  useEffect(() => { void fetch("/api/unmocked").then((r) => setS("status " + r.status)); void fetch("/api/unmocked"); }, []);
  return <div data-testid="unmocked">{s}</div>;
}
function Counter() {
  const [n, setN] = useState(0);
  return <div><button type="button" data-testid="inc" onClick={() => setN((x) => x + 1)}>inc</button><span data-testid="count">count: {n}</span></div>;
}
const flagFixtures = (): Fixtures => { let on = false; return { http: { "GET /api/flag": () => ({ on }), "POST /api/flag": () => { on = !on; return { ok: true }; } } }; };
const mock: Mock = {
  title: "E2E scripted",
  category: "Fixture",
  frames: [
    { title: "Late target", loop: false, proposed: <Late ms={3000} id="late" />, script: [{ say: "click late", target: "late", act: "click" }] },
    { title: "Never target", loop: false, proposed: <div>none</div>, script: [{ say: "click never", target: "never", act: "click" }] },
    { title: "Short timeout", loop: false, proposed: <Late ms={1500} id="slow" />, script: [{ say: "click slow", target: "slow", act: "click", timeout: 1000 }] },
    { title: "Unless and expect", loop: false, proposed: <Raw />, script: [
      { say: "switch to raw mode", target: "raw-toggle", act: "click", unless: "raw-input" },
      { say: "expect the impossible", target: "raw-input", act: "click", expect: "nope", timeout: 500 },
    ] },
    { title: "Stateful toggle", fixtures: flagFixtures, current: <Flag />, proposed: <Flag />, script: [
      { say: "Toggle the flag", target: "toggle", act: "click", expect: "[data-flag=on]" },
      { say: "Flag is on", act: "wait", target: "[data-flag=on]" },
      { say: "Hover the toggle", target: "toggle", act: "hover" },
    ] },
    { title: "WebSocket feed", fixtures: () => ({ ws: { "/ws/feed": (s) => { setTimeout(() => s.send("hello from fixture"), 50); } } }), proposed: <Feed /> },
    { title: "Unmocked request", fixtures: () => ({}), proposed: <Unmocked /> },
    { title: "Typing", proposed: <input data-testid="name" />, script: [
      { say: "Clear", target: "name", act: "clear" },
      { say: "Type hello", target: "name", act: "type", text: "hello", expect: (d) => (d.querySelector("input") as HTMLInputElement).value === "hello" },
    ] },
    { title: "Counter steps", loop: false, proposed: <Counter />, script: [
      { say: "one", target: "inc", act: "click" },
      { say: "two", target: "inc", act: "click" },
      { say: "three", target: "inc", act: "click" },
    ] },
  ],
};
export default mock;
`;

/**
 * Fixed stage (mock-player-step-controls test-plan P1, F6, F7, F11, F15, F17, F18, X1, X5).
 * Frames: 1 expand / collapse a 400 px panel · 2 static (below) · 3 target never appears
 * (30 s timeout) · 4 300-char failing step (2 s timeout) · 5 static (below) · 6 step 1 grows
 * 300 px, step 2 misses · 7 phone counter · 8 static (below) · 9 counter inside a ring ·
 * 10 grows 100 px then 300 px more (monotonic: reduced-motion step panes, F11).
 */
const STAGE_SRC = `import { useState } from "react";
import { Fix, type Mock } from "mock-site/kit";
function Panel() {
  const [o, setO] = useState(false);
  return <div><button type="button" data-testid="expand" onClick={() => setO(true)}>expand</button> <button type="button" data-testid="collapse" onClick={() => setO(false)}>collapse</button>{o ? <div data-testid="panel" style={{ height: 400 }}>panel</div> : null}</div>;
}
function Grow() {
  const [o, setO] = useState(false);
  return <div><button type="button" data-testid="grow" onClick={() => setO(true)}>grow</button>{o ? <div data-testid="block" style={{ height: 300 }}>block</div> : null}</div>;
}
function Counter() {
  const [n, setN] = useState(0);
  return <div><button type="button" data-testid="inc" onClick={() => setN((x) => x + 1)}>inc</button><span data-testid="count">count: {n}</span></div>;
}
function Steps() {
  const [n, setN] = useState(0);
  return <div><div style={{ height: 200 }}>base</div><button type="button" data-testid="add" onClick={() => setN((x) => x + 1)}>add</button>{n > 0 ? <div data-testid="b1" style={{ height: 100 }}>b1</div> : null}{n > 1 ? <div data-testid="b2" style={{ height: 300 }}>b2</div> : null}</div>;
}
const Box = ({ t, h = 120 }: { t: string; h?: number }) => <div style={{ height: h }}>{t}</div>;
const LONG = "${"Long failing step ".repeat(17).trim()}";
const mock: Mock = {
  title: "E2E stage",
  category: "Fixture",
  frames: [
    { title: "Expand collapse", proposed: <Panel />, script: [
      { say: "Expand", target: "expand", act: "click", expect: "panel" },
      { say: "Collapse", target: "collapse", act: "click", expect: (d) => !d.querySelector("[data-testid=panel]") },
    ] },
    { title: "Below one", proposed: <Box t="below one" /> },
    { title: "Never target", loop: false, proposed: <div>none</div>, script: [{ say: "wait forever", target: "nope", act: "click", timeout: 30000 }] },
    { title: "Long error", loop: false, proposed: <div>no target</div>, script: [{ say: LONG, target: "missing", act: "click", timeout: 2000 }] },
    { title: "Below four", proposed: <Box t="below four" /> },
    { title: "Missing step two", loop: false, proposed: <Grow />, script: [
      { say: "Grow", target: "grow", act: "click", expect: "block" },
      { say: "Missing", target: "missing", act: "click", timeout: 300 },
    ] },
    { title: "Phone counter", phone: true, proposed: <Counter />, script: [
      { say: "one", target: "inc", act: "click" },
      { say: "two", target: "inc", act: "click" },
    ] },
    { title: "Below phone", proposed: <Box t="below phone" /> },
    { title: "Ring in a script", proposed: <Fix n={1} tip="ring"><Counter /></Fix>, script: [{ say: "inc", target: "inc", act: "click" }] },
    { title: "Grow in steps", proposed: <Steps />, script: [
      { say: "Add 100", target: "add", act: "click", expect: "b1" },
      { say: "Add 300", target: "add", act: "click", expect: "b2" },
    ] },
  ],
};
export default mock;
`;

/**
 * Pane scroll guard (mock-player-step-controls test-plan P2, F1-F5, F9, F10).
 * Frames: 1 app-module focus (fixtures only, not scripted; first, so nothing above it
 * resizes) · 2 component scrollIntoView + focus() on open, 700 px down · 3 targets at the top
 * and 1000 px down · 4 inner lists (overflow auto / hidden) revealed by the component ·
 * 5 typed suggestion list portaled to the body (300 px) · 6 block appearing after 1500 ms ·
 * 7 tall static (room to scroll).
 */
const GUARD_SRC = `import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Mock } from "mock-site/kit";
function Opener() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open && ref.current) { ref.current.scrollIntoView(); ref.current.focus(); } }, [open]);
  return <div><button type="button" data-testid="open" onClick={() => setOpen(true)}>open</button> <button type="button" data-testid="close" onClick={() => setOpen(false)}>close</button><div style={{ height: 700 }} />{open ? <input data-testid="focused" ref={ref} /> : <div style={{ height: 24 }} />}</div>;
}
const Targets = () => <div><button type="button" data-testid="top">top</button><div style={{ height: 1000 }} /><button type="button" data-testid="far">far</button></div>;
const rows = () => Array.from({ length: 50 }, (_, i) => <div key={i} tabIndex={-1} data-row={i + 1} style={{ height: 30 }}>row {i + 1}</div>);
function Lists() {
  const a = useRef<HTMLDivElement>(null);
  const b = useRef<HTMLDivElement>(null);
  const go = () => { for (const l of [a.current!, b.current!]) { (l.children[29] as HTMLElement).scrollIntoView(); (l.children[39] as HTMLElement).focus(); } };
  return <div><button type="button" data-testid="go" onClick={go}>go</button><div style={{ display: "flex", gap: 8 }}><div ref={a} data-testid="list-auto" style={{ height: 200, width: 150, overflow: "auto" }}>{rows()}</div><div ref={b} data-testid="list-hidden" style={{ height: 200, width: 150, overflow: "hidden" }}>{rows()}</div></div></div>;
}
function Suggest() {
  const [v, setV] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  const r = ref.current?.getBoundingClientRect();
  return <div><input data-testid="q" ref={ref} value={v} onChange={(e) => setV(e.target.value)} />{v && r ? createPortal(<ul data-testid="sugg" style={{ position: "absolute", top: r.bottom + scrollY, left: r.left, height: 300, width: 200, margin: 0 }}><li>{v}1</li><li>{v}2</li></ul>, document.body) : null}</div>;
}
function Delayed() {
  const [on, setOn] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOn(true), 1500); return () => clearTimeout(t); }, []);
  return <div><span data-testid="base">base</span>{on ? <div data-testid="extra" style={{ height: 200 }}>extra</div> : null}</div>;
}
const mock: Mock = {
  title: "E2E guard",
  category: "Fixture",
  frames: [
    { title: "Early focus", fixtures: () => ({}), proposed: <div>early</div> },
    { title: "Focus on open", proposed: <Opener />, script: [
      { say: "Open", target: "open", act: "click", expect: "focused" },
      { say: "Close", target: "close", act: "click" },
    ] },
    { title: "Top and far targets", proposed: <Targets />, script: [
      { say: "Click top", target: "top", act: "click" },
      { say: "Click far", target: "far", act: "click" },
    ] },
    { title: "Inner lists", loop: false, proposed: <Lists />, script: [{ say: "Go", target: "go", act: "click" }] },
    { title: "Typed suggestions", proposed: <Suggest />, script: [
      { say: "Type", target: "q", act: "type", text: "ab", expect: "sugg" },
      { say: "See", target: "sugg", act: "wait" },
    ] },
    { title: "Delayed block", proposed: <Delayed />, script: [{ say: "Look", target: "base", act: "wait" }] },
    { title: "Room", proposed: <div style={{ height: 2000 }}>room</div> },
  ],
};
export default mock;
`;

/**
 * Step controls (mock-player-step-controls test-plan F14, F16, F19, X3, X4).
 * Frames: 1 chain of three clicks, each target appearing 500 ms after the previous click ·
 * 2 static · 3 counter (a second scripted pane) · 4 tall static (room to scroll off).
 */
const STEP_SRC = `import { useEffect, useState } from "react";
import type { Mock } from "mock-site/kit";
function Chain() {
  const [n, setN] = useState(0);
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(false); const t = setTimeout(() => setReady(true), 500); return () => clearTimeout(t); }, [n]);
  return <div><span data-testid="n">n: {n}</span> {ready ? <button type="button" data-testid={"c" + (n + 1)} onClick={() => setN(n + 1)}>next</button> : null}</div>;
}
function Counter() {
  const [n, setN] = useState(0);
  return <div><button type="button" data-testid="inc" onClick={() => setN((x) => x + 1)}>inc</button><span data-testid="count">count: {n}</span></div>;
}
const mock: Mock = {
  title: "E2E step",
  category: "Fixture",
  frames: [
    { title: "Chain", proposed: <Chain />, script: [
      { say: "first", target: "c1", act: "click" },
      { say: "second", target: "c2", act: "click" },
      { say: "third", target: "c3", act: "click" },
    ] },
    { title: "Static", proposed: <div style={{ height: 80 }}>static</div> },
    { title: "Counter", proposed: <Counter />, script: [{ say: "inc", target: "inc", act: "click" }] },
    { title: "Room", proposed: <div style={{ height: 2500 }}>room</div> },
  ],
};
export default mock;
`;

/**
 * Temp project for the mock-site E2E: the package example mock
 * (`packages/mockup-loop/examples/`, never a mock root) + an
 * e2e-only mock exercising ring lint, Tailwind scan, containment and a phone
 * edge ring. Decisions written by tests land here, never in the repo.
 */
export function makeE2eProject(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-mock-site-e2e-")));
  fs.symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(root, "node_modules"), "dir");
  const mockups = path.join(root, "mockups");
  fs.mkdirSync(mockups, { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, "packages", "mockup-loop", "examples", PILLS_MOCK, "mock.tsx"), path.join(mockups, PILLS_MOCK, "mock.tsx"), { recursive: true });
  fs.mkdirSync(path.join(root, "openspec", "changes"), { recursive: true });
  const w = (rel: string, body: string) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), body); };
  w("mockups/mock-site.css", `@import ${JSON.stringify(path.join(pkg("client"), "src/index.css"))};
@source ${JSON.stringify(path.join(pkg("client"), "src"))};
@source ".";
@source "../openspec/changes";
`);
  w("mockups/mock-site.app.tsx", `${fs.readFileSync(path.join(REPO_ROOT, "mockups", "mock-site.app.tsx"), "utf8")}
// e2e (mock-player-step-controls F4): one pane focuses an element 600 px down at module top level.
if (new URLSearchParams(location.search).get("pane") === ${JSON.stringify(EARLY_FOCUS_PANE)}) {
  const i = document.createElement("input");
  i.dataset.testid = "early";
  i.style.cssText = "position:absolute;top:600px";
  document.body.append(i);
  i.focus();
  (window as unknown as { __mkEarlyFocused?: boolean }).__mkEarlyFocused = document.activeElement === i;
}
`);
  // App build config (inherited by the mock site) + a plain options file (never a build config).
  w("vite.config.ts", `import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
const pkg = (p: string) => path.join(${JSON.stringify(path.join(REPO_ROOT, "packages"))}, p);
export default {
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@blackbelt-technology/pi-dashboard-shared": pkg("shared/src"), "@blackbelt-technology/pi-dashboard-client-utils": pkg("client-utils/src"), "@blackbelt-technology/pi-dashboard-app-kit/react": pkg("app-kit/src/react/index.ts"), "@blackbelt-technology/pi-dashboard-app-kit": pkg("app-kit/src/index.ts") } },
  server: { port: 3999, hmr: { clientPort: 3999 }, proxy: { "/api": "http://127.0.0.1:9" } },
  build: { target: "es2022", outDir: "dist" }, esbuild: { target: "es2022" }, optimizeDeps: { esbuildOptions: { target: "es2022" } },
};
`);
  w("mockups/mock-site.config.ts", `import path from "node:path";
export default {
  title: "E2E mocks", app: "./mock-site.app.tsx",
  themes: [
    { id: "system", label: "System", system: { dark: "dark", light: "light" } },
    { id: "dark", label: "Dark", attrs: { "data-theme": null } },
    { id: "light", label: "Light", attrs: { "data-theme": "light" } },
  ],
  aliases: { "@app": ${JSON.stringify(path.join(pkg("client"), "src"))} },
};
`);
  w(`mockups/${SCRIPTED_MOCK}/mock.tsx`, SCRIPTED_SRC);
  w(`mockups/${STAGE_MOCK}/mock.tsx`, STAGE_SRC);
  w(`mockups/${GUARD_MOCK}/mock.tsx`, GUARD_SRC);
  w(`mockups/${STEP_MOCK}/mock.tsx`, STEP_SRC);
  w(`mockups/${SOLID_MOCK}/mock.tsx`, "export default { title: 'Solid mock', category: 'Fixture', framework: 'solid', frames: [{ title: 'x', proposed: 'solid' }] };\n");
  w(`mockups/${FIXTURE_MOCK}/mock.tsx`, `import { InlineMessage } from "@app/components/primitives/InlineMessage.tsx";
import { Fix, Issue, type Mock } from "mock-site/kit";
const Box = ({ t }: { t: string }) => <div style={{ padding: 8 }}>{t}</div>;
const mock: Mock = {
  title: "E2E fixture",
  category: "Fixture",
  frames: [
    {
      title: "Lint, Tailwind, containment",
      width: 700,
      why: "${"w".repeat(121)}",
      current: (
        <div style={{ display: "grid", gap: 24, padding: 20 }}>
          <Issue n={1} tip="exactly forty characters long tip text!!"><Box t="forty" /></Issue>
          <Issue n="x-2" tip="this tip is forty-one characters long...."><Box t="forty-one" /></Issue>
          <div className="mt-[13px]" data-testid="tw-mock">tw</div>
          <InlineMessage severity="warning" title="App component">app css</InlineMessage>
        </div>
      ),
      proposed: (
        <div style={{ display: "grid", gap: 24, padding: 20 }}>
          <Fix n={1} tip="ok"><Box t="one" /></Fix>
          <Fix n="a/b" tip="bad n"><Box t="bad" /></Fix>
          <div className="fixed top-0 left-0 z-50 w-full h-10 bg-red-500" data-testid="fixed-child">fixed</div>
        </div>
      ),
    },
    {
      title: "Phone edge ring",
      phone: true,
      current: <Issue n={1} tip="edge"><div style={{ height: 40 }}>edge</div></Issue>,
      proposed: <Fix n={1} tip="edge"><div style={{ height: 40 }}>edge</div></Fix>,
    },
    {
      title: "Animated steps",
      play: true,
      steps: [{ label: "one", proposed: <Box t="scene one" /> }, { label: "two", proposed: <Box t="scene two" /> }],
    },
    {
      title: "Steps and panes",
      current: <Box t="ignored" />,
      steps: [{ label: "only", proposed: <Box t="step wins" /> }],
    },
    {
      title: "Phone steps",
      phone: true,
      steps: [{ label: "one", proposed: <Box t="phone one" /> }, { label: "two", proposed: <Box t="phone two" /> }],
    },
  ],
};
export default mock;
`);
  return root;
}
