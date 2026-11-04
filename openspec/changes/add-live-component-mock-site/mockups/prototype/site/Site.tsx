// GENERIC mock site shell — English only, no app names.
// Sidebar (search + categories, newest first) | frames: Current | Proposed side by side.
// Accept / Reject per MOCK (whole page) -> POST /__mock/decide -> mocks/decisions.json (git-visible). Only open frames are listed.
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { tipsOf, type Frame, type Mock, type Status, type Decision, RefBase, RefLink, refId } from "./kit.tsx";
import { MOCK_CONFIG } from "virtual:mock-config";

const loaded = import.meta.glob<{ default: Mock }>("../mocks/*.mock.tsx", { eager: true });
const ALL: Mock[] = Object.values(loaded).map((m) => m.default).sort((a, b) => b.id.localeCompare(a.id));
const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const frameText = (m: Mock, f: Frame) => fold([m.id, m.title, m.category, m.change ?? "", f.title, ...tipsOf([f.current, f.proposed])].join(" "));
const matches = (text: string, q: string) => fold(q).split(/\s+/).filter(Boolean).every((w) => text.includes(w));

type Theme = { id: string; label: string; attrs?: Record<string, string | null>; system?: { dark: string; light: string } };
const THEMES = MOCK_CONFIG.themes as Theme[];
const dark = matchMedia("(prefers-color-scheme: dark)");
function applyTheme(t: string) {
  let th = THEMES.find((x) => x.id === t) ?? THEMES[0];
  if (th.system) th = THEMES.find((x) => x.id === (dark.matches ? th.system!.dark : th.system!.light)) ?? th;
  if (!th.attrs) return;
  for (const [k, v] of Object.entries(th.attrs)) {
    if (v === null) document.documentElement.removeAttribute(k); else document.documentElement.setAttribute(k, v);
  }
}

/** `?pane=<id>/<n>/<current|proposed>` renders one pane only — used by the phone iframe. */
const PANE = new URLSearchParams(location.search).get("pane");
function PaneOnly({ spec }: { spec: string }): ReactElement {
  const [id, n, side] = spec.split("/");
  const f = ALL.find((m) => m.id === id)?.frames[Number(n) - 1];
  useEffect(() => {
    const apply = () => applyTheme(localStorage.getItem("mk-theme") ?? THEMES[0].id);
    apply(); addEventListener("storage", apply); dark.addEventListener("change", apply);
    document.body.classList.add("mk-pane-only");
    const post = () => parent.postMessage({ mkPane: spec, h: document.documentElement.scrollHeight }, "*");
    const ro = new ResizeObserver(post); ro.observe(document.body);
    return () => { removeEventListener("storage", apply); ro.disconnect(); };
  }, [spec]);
  return <RefBase.Provider value={spec}><div className="mk-canvas">{f ? (side === "current" ? f.current : f.proposed) : null}</div></RefBase.Provider>;
}
function PhonePane({ spec }: { spec: string }): ReactElement {
  const [h, setH] = useState(160);
  useEffect(() => {
    const on = (e: MessageEvent) => { if (e.data?.mkPane === spec) setH(e.data.h); };
    addEventListener("message", on); return () => removeEventListener("message", on);
  }, [spec]);
  return <iframe className="mk-phone" title={spec} src={`?pane=${encodeURIComponent(spec)}`} style={{ width: 375, height: h }} />;
}

export function Site(): ReactElement {
  return PANE ? <PaneOnly spec={PANE} /> : <Shell />;
}

function Shell(): ReactElement {
  const [q, setQ] = useState("");
  const [hash, setHash] = useState(() => location.hash.slice(1));
  const [theme, setTheme] = useState(() => localStorage.getItem("mk-theme") ?? THEMES[0].id);
  const [decisions, setDecisions] = useState<Record<string, Decision | Status>>({});
  const [showClosed, setShowClosed] = useState(false);

  useEffect(() => {
    const load = () => fetch("/__mock/decisions").then((r) => r.json()).then(setDecisions).catch(() => {});
    load(); import.meta.hot?.on("mock:decisions", load);
  }, []);
  useEffect(() => { const on = () => setHash(location.hash.slice(1)); addEventListener("hashchange", on); return () => removeEventListener("hashchange", on); }, []);
  useEffect(() => {
    applyTheme(theme); localStorage.setItem("mk-theme", theme);
    const on = () => applyTheme(theme); dark.addEventListener("change", on); return () => dark.removeEventListener("change", on);
  }, [theme]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "/" && document.activeElement?.id !== "mk-q") { e.preventDefault(); document.getElementById("mk-q")?.focus(); } };
    addEventListener("keydown", on); return () => removeEventListener("keydown", on);
  }, []);

  const decide = async (k: string, status: Status) => {
    setDecisions((d) => ({ ...d, [k]: { status, by: "user", at: new Date().toISOString() } }));
    await fetch("/__mock/decide", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: k, status }) });
  };
  // Decisions are per MOCK (a whole page / flow), never per frame.
  const decOf = (m: Mock): Decision | undefined => { const d = decisions[m.id]; return typeof d === "string" ? { status: d, by: "user", at: "" } : d; };
  const statusOf = (m: Mock): Status => decOf(m)?.status ?? "open";
  const visible = (m: Mock, _i?: number) => showClosed || statusOf(m) === "open";

  const MOCKS = ALL.filter((m) => visible(m));
  const [hid] = hash.split("/");
  const selected = MOCKS.find((m) => m.id === hid) ?? MOCKS[0];
  useEffect(() => {
    // deepest existing part wins: ring > side > frame (rings inside phone iframes fall back to their pane)
    const parts = hash.split("/");
    const t = setTimeout(() => {
      for (let k = parts.length; k > 1; k--) {
        const el = document.getElementById(refId(parts.slice(0, k).join("/")));
        if (!el) continue;
        el.scrollIntoView({ block: "center" });
        el.classList.remove("mk-hit"); void el.offsetWidth; el.classList.add("mk-hit");
        return;
      }
      if (parts.length === 1) scrollTo(0, 0);
    }, 50);
    return () => clearTimeout(t);
  }, [hash]);

  const hits = useMemo(() => (q.trim() ? MOCKS.map((m) => ({ m, frames: m.frames.map((f, i) => ({ f, i })).filter(({ f, i }) => visible(m, i) && matches(frameText(m, f), q)) })).filter((h) => h.frames.length) : []), [q, MOCKS]);
  const shown = q.trim() ? hits : selected ? [{ m: selected, frames: selected.frames.map((f, i) => ({ f, i })).filter(({ i }) => visible(selected, i)) }] : [];
  const categories = [...new Set(MOCKS.map((m) => m.category))];

  const pane = (m: Mock, i: number, f: Frame, side: "current" | "proposed") =>
    f.phone ? <PhonePane spec={`${m.id}/${i + 1}/${side}`} /> : <RefBase.Provider value={`${m.id}/${i + 1}/${side}`}><div className="mk-canvas">{side === "current" ? f.current : f.proposed}</div></RefBase.Provider>;

  return (
    <div className="mk-site">
      <aside className="mk-side">
        <div className="mk-brand">{MOCK_CONFIG.title}</div>
        <input id="mk-q" className="mk-q" type="search" placeholder="Search... (/)" aria-label="Search mocks" value={q}
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setQ(""); }} />
        {categories.map((c) => (
          <div key={c}>
            <div className="mk-sec">{c}</div>
            {MOCKS.filter((m) => m.category === c).map((m) => (
              <a key={m.id} href={`#${m.id}`} className={`mk-item${m.id === selected?.id && !q.trim() ? " on" : ""}`} onClick={() => setQ("")}>
                <span className="mk-it">{m.title}</span>
                <span className="mk-im">{m.id.slice(0, 10)} - {m.frames.length} frames - <span className={`mk-pill mk-${statusOf(m)}`}><span className="d" />{statusOf(m)}</span></span>
              </a>
            ))}
          </div>
        ))}
        <label className="mk-closed"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show accepted / rejected</label>
      </aside>
      <main className="mk-main">
        <div className="mk-bar">
          {selected && !q.trim() ? (
            <span className="mk-actions">
              {statusOf(selected) === "open" ? (
                <>
                  <button type="button" className="mk-btn mk-accept" onClick={() => decide(selected.id, "accepted")}>Accept page</button>
                  <button type="button" className="mk-btn mk-reject" onClick={() => decide(selected.id, "rejected")}>Reject page</button>
                </>
              ) : (
                <button type="button" className="mk-btn" onClick={() => decide(selected.id, "open")}>Reopen ({statusOf(selected)})</button>
              )}
            </span>
          ) : null}
          <span className="mk-sp" />
          <span className="mk-theme">
            {THEMES.map((t) => (
              <button key={t.id} type="button" aria-pressed={theme === t.id} onClick={() => setTheme(t.id)}>{t.label}</button>
            ))}
          </span>
        </div>
        {shown.length === 0 ? <p className="mk-empty">{q.trim() ? "No match." : "Nothing open. All mocks are decided."}</p> : null}
        {shown.map(({ m, frames }) => (
          <section key={m.id} className="mk-change">
            <header className={`mk-ch mk-st-${statusOf(m)}`}>
              <div>
                <h1>{m.title} <RefLink to={m.id} className="mk-ref">#{m.id}</RefLink></h1>
                <div className="mk-meta">{m.id.slice(0, 10)} - {m.category}{m.change ? <> - <code>{m.change}</code></> : null} - {m.frames.length} frames - <span className={`mk-pill mk-${statusOf(m)}`}><span className="d" />{statusOf(m)}</span>{decOf(m) ? <span className="mk-by"> by {decOf(m)!.by}</span> : null}</div>
                {decOf(m)?.note ? <p className="mk-note">{decOf(m)!.note}</p> : null}
              </div>
            </header>
            {frames.map(({ f, i }) => {
              const w = f.phone ? 375 : f.width ?? 640;
              return (
                <article key={i} id={refId(`${m.id}/${i + 1}`)} className="mk-frame">
                  <div className="mk-fh">
                    <RefLink to={`${m.id}/${i + 1}`} className="mk-fn">{i + 1}</RefLink>
                    <span className="mk-ft">{f.title}</span>
                    <RefLink to={`${m.id}/${i + 1}`} className="mk-ref">#{m.id}/{i + 1}</RefLink>
                  </div>
                  <div className="mk-pair">
                    {f.current !== undefined ? <div className="mk-pane" id={refId(`${m.id}/${i + 1}/current`)} style={{ width: w }}><RefLink to={`${m.id}/${i + 1}/current`} className="mk-lab mk-bad">Current</RefLink>{pane(m, i, f, "current")}</div> : null}
                    <div className="mk-pane" id={refId(`${m.id}/${i + 1}/proposed`)} style={{ width: w }}><RefLink to={`${m.id}/${i + 1}/proposed`} className="mk-lab mk-ok">{f.current === undefined ? "New" : "Proposed"}</RefLink>{pane(m, i, f, "proposed")}</div>
                  </div>
                </article>
              );
            })}
          </section>
        ))}
      </main>
    </div>
  );
}
