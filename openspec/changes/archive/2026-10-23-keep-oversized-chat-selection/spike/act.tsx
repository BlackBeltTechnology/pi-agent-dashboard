import React, { Activity, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
const w = window as any; w.effects = 0;
function Heavy({ i }: { i: number }) { useEffect(() => { w.effects++; }, []); return <div className="r">ROW-{i}</div>; }
let set: any;
function App() { const [mode, setMode] = useState<"none" | "plain" | "activity">("none"); set = setMode;
  return <div id="c">{mode === "plain" && Array.from({ length: 300 }, (_, i) => <Heavy key={i} i={i} />)}
    {mode === "activity" && <Activity mode="hidden">{Array.from({ length: 300 }, (_, i) => <Heavy key={i} i={i} />)}</Activity>}</div>; }
createRoot(document.getElementById("root")!).render(<App />);
w.run = (m: string) => { w.effects = 0; const t0 = performance.now();
  flushSync(() => set(m)); const n = document.querySelectorAll("#c .r").length; const txt = document.getElementById("c")!.textContent!.length;
  const effAfterMount = w.effects; flushSync(() => set("none")); return { m, domRows: n, txt, effAfterMount, effAfterRelease: w.effects, ms: +(performance.now() - t0).toFixed(1) }; };
