#!/usr/bin/env node
// Paired calibration analysis: archetype framing vs field framing, same subjects.
import { readFileSync } from "node:fs";
const rows = process.argv.slice(2).flatMap(f => readFileSync(f,"utf8").split("\n").filter(Boolean).map(JSON.parse));
const subj = id => id.replace(/^(arch|field)-/,"");
const fram = id => id.startsWith("arch-") ? "arch" : "field";
const CHECKS = ["kb_first","used_kb"];
const rate = rs => { const v = rs.filter(r=>r!=="na"); return v.length ? v.filter(r=>r==="pass").length/v.length : NaN; };
console.log(`runs parsed: ${rows.length}\n`);
for (const c of CHECKS) {
  console.log(`── ${c} ──`);
  console.log("subject                    archetype        field        Δ(field−arch)");
  const subs=[...new Set(rows.map(r=>subj(r.taskId)))].sort();
  let aAll=[],fAll=[];
  for (const s of subs) {
    const a = rows.filter(r=>subj(r.taskId)===s&&fram(r.taskId)==="arch").map(r=>r.checks[c]);
    const f = rows.filter(r=>subj(r.taskId)===s&&fram(r.taskId)==="field").map(r=>r.checks[c]);
    aAll.push(...a); fAll.push(...f);
    const ra=rate(a), rf=rate(f);
    const pct=v=>isNaN(v)?"  n/a":`${(100*v).toFixed(0).padStart(3)}%`;
    console.log(`${s.padEnd(26)} ${pct(ra)}(${a.filter(x=>x!=="na").length})       ${pct(rf)}(${f.filter(x=>x!=="na").length})      ${isNaN(ra)||isNaN(rf)?"":((100*(rf-ra)).toFixed(0)+"pp").padStart(6)}`);
  }
  const RA=rate(aAll), RF=rate(fAll);
  console.log(`${"POOLED".padEnd(26)} ${(100*RA).toFixed(0).padStart(3)}%(${aAll.filter(x=>x!=="na").length})       ${(100*RF).toFixed(0).padStart(3)}%(${fAll.filter(x=>x!=="na").length})      ${((100*(RF-RA)).toFixed(0)+"pp").padStart(6)}`);
  // two-proportion z on pooled
  const na=aAll.filter(x=>x!=="na").length, nf=fAll.filter(x=>x!=="na").length;
  if(na&&nf){const p=(RA*na+RF*nf)/(na+nf), se=Math.sqrt(p*(1-p)*(1/na+1/nf));
    const z=se?(RF-RA)/se:0; const erf=x=>{const t=1/(1+0.3275911*Math.abs(x));const y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-x*x);return x>=0?y:-y};
    console.log(`  z=${z.toFixed(2)}  p=${(2*(1-0.5*(1+erf(Math.abs(z)/Math.SQRT2)))).toFixed(4)}`);}
  console.log();
}
// fall-through: did the run use kb AND still grep?
const SEARCH=/(^|\s|\|)(rg|grep)\s/;
const ft = rows.filter(r=>r.checks.used_kb==="pass" && (r.toolSeq||[]).some(t=>(typeof t==="string"?t:t.name)==="bash"));
console.log(`runs that used kb_search and still ran bash afterwards: ${ft.length}/${rows.filter(r=>r.checks.used_kb==="pass").length}`);
const tok=rows.reduce((a,r)=>a+(r.usage?.total||0),0), cost=rows.reduce((a,r)=>a+(r.usage?.cost||0),0);
console.log(`total tokens ${tok.toLocaleString()}  cost $${cost.toFixed(2)}`);
