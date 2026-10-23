/**
 * Static same-origin assets for the pre-auth passkey pages (`passkey-pages.ts`), served by
 * `passkey-routes.ts` under `/auth/passkey/`. Moving the scripts/styles out of the HTML lets the strict
 * CSP (`script-src 'self' 'nonce-…'`, no `'unsafe-inline'`) cover these pages with no nonce.
 * Per-request data reaches `login.js` through a `<script type="application/json" id="pk-data">` island,
 * never through script text. Sources are TS string constants so packaging needs no extra copy step.
 *
 * See change: harden-cors-and-csp-reporting (D9).
 */

export interface PasskeyAsset {
  /** `Content-Type` of the response. */
  type: string;
  body: string;
}

const COMMON_JS = `var MSG={
unstable_origin:"Passkeys are unavailable on this dashboard address.",
passkeys_disabled:"Passkey sign-in is not enabled.",
invite_invalid:"This invite link is not valid.",invite_expired:"This invite has expired. Ask an operator for a new one.",
invite_exhausted:"This invite has already been used. Ask an operator for a new one.",
orphaned_credential:"This passkey belongs to a previous dashboard address. Ask an operator for a new invite, or use sign in with phone.",
unknown_credential:"This passkey is not registered (or the user was revoked).",
verification_failed:"The passkey could not be verified.",challenge_invalid:"The request expired. Please try again.",
duplicate_credential:"This passkey is already registered.",rate_limited:"Too many attempts. Wait a minute and try again.",
too_many_requests:"Too many pending sign-in requests. Try again shortly.",invalid:"That code is not valid or has expired.",
expired:"This sign-in request has expired.",origin_mismatch:"Open this page on the dashboard's primary address."};
function msg(c){return MSG[c]||"Something went wrong. Please try again.";}
async function post(u,b){var r=await fetch(u,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b||{}),credentials:"same-origin"});var d={};try{d=await r.json();}catch(e){}return{ok:r.ok,d:d};}`;

const LOGIN_JS = `(function(){
var RET=JSON.parse(document.getElementById("pk-data").textContent).returnUrl;var err=document.getElementById("pk-err");function show(m){err.textContent=m;}
var opts=null;async function prefetch(){var o=await post("/auth/passkey/login/options");opts=o.ok?o.d:null;if(!o.ok)show(msg(o.d.error));}
prefetch();setInterval(prefetch,240000);
document.getElementById("pk-login").onclick=async function(){show("");if(!opts){await prefetch();if(!opts)return;}var o=opts;opts=null;
try{var resp=await SimpleWebAuthnBrowser.startAuthentication({optionsJSON:o.options});}catch(e){show("Passkey sign-in was cancelled.");prefetch();return;}
var v=await post("/auth/passkey/login/verify",{challengeId:o.challengeId,response:resp});if(v.ok){location.assign(RET);}else{show(msg(v.d.error));prefetch();}};
var timer=null;document.getElementById("pk-phone").onclick=async function(){show("");var s=await post("/auth/passkey/phone/start");if(!s.ok)return show(msg(s.d.error));
document.getElementById("pk-phone-box").hidden=false;document.getElementById("pk-qr").src=s.d.qrDataUrl;document.getElementById("pk-code").textContent=s.d.shortCode;
var st=document.getElementById("pk-status");st.textContent="Waiting for approval on your phone…";if(timer)clearInterval(timer);
timer=setInterval(async function(){var d={};try{var r=await fetch("/auth/passkey/phone/poll/"+encodeURIComponent(s.d.requestId),{credentials:"same-origin"});d=await r.json();}catch(e){return;}
if(d.status==="pending")return;clearInterval(timer);timer=null;
if(d.status==="approved"){location.assign(RET);}else if(d.status==="rejected"){st.textContent="Sign-in was declined on the phone.";}else{st.textContent="The sign-in request expired. Try again.";}},2000);};
})();`;

const INVITE_JS = `(function(){
var token=location.hash.slice(1);history.replaceState(null,"",location.pathname);
var m=document.getElementById("msg"),go=document.getElementById("go"),opts=null;
async function prefetch(){var o=await post("/auth/passkey/register/options",{token:token});if(!o.ok){m.textContent=msg(o.d.error);go.disabled=true;return;}
opts=o.d;go.disabled=false;var n=o.d.options&&o.d.options.user&&o.d.options.user.displayName;if(n)document.getElementById("who").textContent="Create a passkey for "+n+" on this device.";}
if(!token){m.textContent=msg("invite_invalid");}else{prefetch();}
go.onclick=async function(){m.textContent="";if(!opts)return;var o=opts;opts=null;go.disabled=true;
try{var resp=await SimpleWebAuthnBrowser.startRegistration({optionsJSON:o.options});}catch(e){m.textContent="Passkey creation was cancelled.";prefetch();return;}
var v=await post("/auth/passkey/register/verify",{challengeId:o.challengeId,token:token,response:resp});
if(v.ok){m.className="muted";m.textContent="Your passkey is ready. You can now sign in to the dashboard with it, or approve sign-ins from this phone.";document.getElementById("open").hidden=false;}
else{m.textContent=msg(v.d.error);if(v.d.error==="challenge_invalid")prefetch();}};
})();`;

const PHONE_JS = `(function(){
var token=location.hash.slice(1);history.replaceState(null,"",location.pathname);
var m=document.getElementById("msg"),ap=document.getElementById("approve"),opts=null;
function done(t,ok){document.getElementById("req").hidden=true;document.getElementById("code-form").hidden=true;m.className=ok?"muted":"err";m.textContent=t;}
async function prefetch(){var o=await post("/auth/passkey/login/options");if(!o.ok){m.textContent=msg(o.d.error);return;}opts=o.d;ap.disabled=false;}
async function load(){var v=await post("/auth/passkey/phone/view",{token:token});if(!v.ok)return done(msg(v.d.error||"expired"),false);
var r=v.d.requester;document.getElementById("r-browser").textContent=r.browser;document.getElementById("r-os").textContent=r.os;
document.getElementById("r-host").textContent=r.host;document.getElementById("r-ip").textContent=r.ip;document.getElementById("r-code").textContent=v.d.shortCode;
document.getElementById("code-form").hidden=true;document.getElementById("req").hidden=false;prefetch();}
document.getElementById("code-go").onclick=async function(){m.textContent="";var c=await post("/auth/passkey/phone/lookup",{code:document.getElementById("code").value});
if(!c.ok)return(m.textContent=msg(c.d.error));token=c.d.approvalToken;load();};
ap.onclick=async function(){m.textContent="";if(!opts)return;var o=opts;opts=null;ap.disabled=true;
try{var resp=await SimpleWebAuthnBrowser.startAuthentication({optionsJSON:o.options});}catch(e){m.textContent="Passkey approval was cancelled.";prefetch();return;}
var a=await post("/auth/passkey/phone/approve",{token:token,challengeId:o.challengeId,response:resp});
if(a.ok)done("Approved. The other screen is now signed in. You can close this page.",true);else{m.textContent=msg(a.d.error);prefetch();}};
document.getElementById("deny").onclick=async function(){var d=await post("/auth/passkey/phone/deny",{token:token});done(d.ok?"Sign-in denied.":msg(d.d.error||"expired"),d.ok);};
if(token){load();}else{document.getElementById("code-form").hidden=false;}
})();`;

const PAGES_CSS = `body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f172a;color:#e2e8f0;}
.card{background:#1e293b;padding:40px;border-radius:12px;max-width:400px;width:100%;text-align:center;box-sizing:border-box;}
h1{margin:0 0 24px;font-size:24px;}
.btn{display:block;width:100%;margin:10px 0;padding:12px 24px;background:#2563eb;color:#fff;border:0;border-radius:6px;font-size:16px;cursor:pointer;text-decoration:none;box-sizing:border-box;}
.btn.secondary{background:#334155;}
.btn:disabled{background:#475569;color:#94a3b8;cursor:not-allowed;}
.muted{color:#94a3b8;font-size:14px;}
.err{color:#fca5a5;min-height:1.2em;}
dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;text-align:left;margin:16px 0;}
dt{color:#94a3b8;}dd{margin:0;word-break:break-all;}
input{font-size:20px;padding:8px;width:100%;box-sizing:border-box;text-align:center;letter-spacing:2px;text-transform:uppercase;border-radius:6px;border:1px solid #475569;background:#0f172a;color:#e2e8f0;}
img.qr{background:#fff;padding:8px;border-radius:8px;width:200px;height:200px;}
hr{border:0;border-top:1px solid #334155;margin:20px 0;}`;

/** `/auth/passkey/<name>` → asset. The page HTML references exactly these names. */
export const PASSKEY_ASSETS: Readonly<Record<string, PasskeyAsset>> = {
  "common.js": { type: "application/javascript; charset=utf-8", body: COMMON_JS },
  "login.js": { type: "application/javascript; charset=utf-8", body: LOGIN_JS },
  "invite.js": { type: "application/javascript; charset=utf-8", body: INVITE_JS },
  "phone.js": { type: "application/javascript; charset=utf-8", body: PHONE_JS },
  "pages.css": { type: "text/css; charset=utf-8", body: PAGES_CSS },
};
