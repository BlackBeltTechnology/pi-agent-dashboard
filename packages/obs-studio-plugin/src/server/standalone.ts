/**
 * Standalone host `/apps/obs/` (design D6): a self-contained page (HTML + one
 * same-origin script, no build step) over the SAME plugin routes the embedded
 * panel uses — scenes, toggles, program preview polled at ≤ 1 fps while
 * visible with a 0.2 fps backoff after 3 errors. No dashboard chrome. Auth is
 * the dashboard's own (cookie session or local trust); the page never sees the
 * OBS password. Strings come from the plugin catalog (`en`/`zh-CN`/`hu`,
 * picked by `navigator.language`). Served from memory, rate-limited, behind
 * the network guard. See change: add-obs-studio-plugin.
 */
import type { PluginNetworkGuard } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { catalog, en } from "../i18n.js";
import { PREFIX } from "./routes.js";

const APP_PATH = "/apps/obs";

const HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OBS Studio</title>
<style>
:root{color-scheme:light dark;font-family:system-ui,sans-serif}
body{margin:0;padding:16px;background:Canvas;color:CanvasText}
button{font:inherit;font-size:13px;padding:6px 10px;margin:2px;border-radius:6px;border:1px solid GrayText;background:ButtonFace;color:ButtonText;min-height:32px}
button[aria-pressed=true]{outline:2px solid Highlight}
button:focus-visible,select:focus-visible{outline:2px solid Highlight;outline-offset:2px}
.muted{opacity:.75;font-size:13px}.warn{font-size:13px;color:#b45309}
img{max-width:100%;border-radius:6px;border:1px solid GrayText}
ul{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:4px}
</style></head>
<body><main id="app" data-testid="obs-standalone" aria-live="polite"></main>
<script type="module" src="${APP_PATH}/app.js"></script></body></html>`;

function appJs(): string {
  const strings = { en, ...catalog };
  return `const API=${JSON.stringify(PREFIX)};const CAT=${JSON.stringify(strings)};
const lang=(navigator.language||"en");const L=CAT[lang]||CAT[lang.split("-")[0]]||(lang.startsWith("zh")?CAT["zh-CN"]:null)||CAT.en;
const s=(k,v={})=>(L[k]||CAT.en[k]||k).replace(/\\{(\\w+)\\}/g,(m,n)=>n in v?String(v[n]):m);
document.documentElement.lang=lang;document.title=s("title");
const app=document.getElementById("app");
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const[k,v]of Object.entries(props)){if(k==="class")e.className=v;else if(k.startsWith("on"))e.addEventListener(k.slice(2),v);else e.setAttribute(k,v);}for(const c of kids)e.append(c);return e;};
const get=async(p,init)=>{const r=await fetch(p,{credentials:"same-origin",...init,headers:init&&init.body?{"content-type":"application/json"}:undefined});const b=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(b.error||"http-"+r.status),{status:r.status});return b;};
let selected="",status=null,denied=false,errors=0,timer=null,frame=null,busy=false;
function render(){app.replaceChildren();app.append(el("h1",{},s("title")));
 if(!status){app.append(el("p",{class:"muted"},s("loading")));return;}
 if(status.none){app.append(el("p",{},s("none")),el("p",{class:"muted"},s("provisionHint")));return;}
 if(status.state==="blocked"){app.append(el("p",{class:"warn"},s("blocked")));return;}
 if(status.state!=="healthy"){app.append(el("p",{},s("notHealthy",{state:status.state})));return;}
 if(denied){app.append(el("p",{class:"muted"},s("operateRequired")));return;}
 const live=status.live||{};const cur=live.current||live.currentScene||"";
 app.append(el("p",{class:"muted"},cur?s("programScene",{scene:cur}):s("preview")));
 if(frame)app.append(el("img",{src:frame,alt:s("preview"),"data-testid":"obs-preview",width:"640"}));else app.append(el("p",{class:"muted"},s("previewUnavailable")));
 const ul=el("ul",{"aria-label":s("scenes"),"data-testid":"obs-scenes"});
 for(const n of live.scenes||[])ul.append(el("li",{},el("button",{type:"button","aria-pressed":String(n===cur),"aria-label":s("switchTo",{scene:n}),onclick:()=>act("scene",{sceneName:n})},n)));
 app.append(ul);
 if(status.live){app.append(el("button",{type:"button","aria-pressed":String(!!live.virtualCam),onclick:()=>act("virtualcam",{on:!live.virtualCam})},s("virtualCam")+": "+(live.virtualCam?s("on"):s("off"))),
  el("button",{type:"button","aria-pressed":String(!!live.recording),onclick:()=>act("record",{on:!live.recording})},s("recording")+": "+(live.recording?s("on"):s("off"))));}
}
async function refresh(){try{status=await get(API+"/"+encodeURIComponent(selected)+"/status");}catch(e){status={state:e.message};}render();}
async function act(op,body){if(busy)return;busy=true;try{await get(API+"/"+encodeURIComponent(selected)+"/"+op,{method:"POST",body:JSON.stringify(body)});}catch(e){if(e.status===403)denied=true;}busy=false;await refresh();}
function schedule(ms){clearTimeout(timer);if(document.visibilityState==="visible")timer=setTimeout(tick,ms);}
async function tick(){if(document.visibilityState!=="visible"||!status||status.state!=="healthy"||denied){schedule(1000);return;}
 try{const r=await get(API+"/"+encodeURIComponent(selected)+"/screenshot");frame=r.result.imageData;errors=0;if(!status.live)await refresh();else render();}
 catch(e){errors++;if(e.status===403){denied=true;render();}}schedule(errors>=3?5000:1000);}
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")schedule(0);else clearTimeout(timer);});
(async()=>{try{const r=await get(API+"/instances");if(!r.instances.length){status={none:true};render();return;}selected=r.instances[0].id;await refresh();schedule(0);setInterval(()=>{if(document.visibilityState==="visible")refresh();},5000);}catch(e){status={state:e.message};render();}})();
`;
}

export async function mountStandalone(fastify: FastifyInstance, networkGuard: PluginNetworkGuard): Promise<void> {
  const js = appJs();
  await fastify.register(async (scope) => {
    await scope.register(rateLimit, { global: false });
    const opts = { preHandler: networkGuard, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } };
    const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
    scope.get(APP_PATH, opts, async (_req, reply) => reply.redirect(`${APP_PATH}/`, 308));
    scope.get(`${APP_PATH}/`, opts, async (_req, reply) => reply.headers(headers).type("text/html; charset=utf-8").send(HTML));
    scope.get(`${APP_PATH}/app.js`, opts, async (_req, reply) => reply.headers(headers).type("text/javascript; charset=utf-8").send(js));
  });
}
