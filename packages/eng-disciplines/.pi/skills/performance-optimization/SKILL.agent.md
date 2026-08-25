# SKILL.md — performance-optimization index

Pull-only condensed map. Source: packages/eng-disciplines/.pi/skills/performance-optimization/SKILL.md. Keys on triggers, Core Web Vitals thresholds, MEASURE→GUARD workflow, bottleneck diagnosis, anti-pattern fixes, budgets.

## When to Use
- Triggers — "it's slow", "profile this", "optimize perf", "fix the bottleneck", "improve load time / Core Web Vitals". Perf requirements in spec, slow reports, suspected regression, large data/high traffic.
- NOT — no evidence of problem; premature optimization costs more than it gains.

## Core Web Vitals Targets
- LCP ≤2.5s good / ≤4.0 needs improvement / >4.0 poor. INP ≤200ms / ≤500ms / >500ms. CLS ≤0.1 / ≤0.25 / >0.25.

## The Optimization Workflow
- 1 MEASURE baseline → 2 IDENTIFY bottleneck → 3 FIX → 4 VERIFY re-measure → 5 GUARD monitoring/tests.

### Step 1: Measure
- Synthetic (Lighthouse, DevTools Performance) — reproducible, CI regression detection.
- RUM (`web-vitals` onLCP/onINP/onCLS, CrUX) — validates fix in real conditions.
- Backend — response-time logging, APM, DB query timing (`console.time`).

### Where to Start Measuring
- First load — bundle size, TTFB waterfall; DNS→dns-prefetch/preconnect, TCP/TLS→HTTP/2, render-blocking CSS/JS.
- Sluggish interaction — main-thread long tasks (>50ms), re-renders/controlled components, layout thrashing.
- After navigation — API response times, waterfalls, N+1 fetches, render time.
- Backend — single endpoint slow→queries/indexes; all slow→pool/memory/CPU; intermittent→locks/GC/external deps.

### Step 2: Identify the Bottleneck
- Slow LCP — large images, render-blocking, slow server. High CLS — images without dimensions, late content, font shifts. Poor INP — heavy main-thread JS, large DOM updates.
- Slow API — N+1, missing indexes. Memory growth — leaks/unbounded caches. CPU spikes — sync compute, regex backtracking.

### Step 3: Fix Common Anti-Patterns
- N+1 — single query with `include`/join, not per-row fetch in loop. Unbounded fetch — paginate `take`/`skip` + orderBy.
- Images — `<picture media>` art direction + `srcset`/`sizes`; LCP `fetchpriority="high"`; below-fold `loading="lazy" decoding="async"`; always width/height.
- Re-renders — stable refs (module const), `React.memo`, `useMemo` with deps. Bundle — `lazy()` + Suspense; tree-shaking needs ESM + `sideEffects: false`.
- Caching — TTL cache for read-heavy data; static `maxAge:'1y' immutable:true` (content-hashed names); API `Cache-Control: public, max-age=300`.

## Performance Budget
- JS <200KB gzipped initial; CSS <50KB; images <200KB above-fold; fonts <100KB; API <200ms p95; TTI <3.5s on 4G; Lighthouse ≥90.
- Enforce in CI — `npx bundlesize --config bundlesize.config.json`, `npx lhci autorun`.

## Common Rationalizations
- "We'll optimize later" — perf debt compounds. "Fast on my machine" — profile representative hardware. "This optimization is obvious" — no measurement, no knowledge. "Framework handles performance" — can't fix N+1/oversized bundles.

## Red Flags
- Optimization without profiling data; N+1; list endpoints without pagination; images without dimensions/lazy/responsive; bundle growth unreviewed; no prod monitoring; `React.memo`/`useMemo` everywhere.

## Verification
- Before/after measurements exist; bottleneck identified; CWV within Good; bundle not grown; no N+1 in new code; budget passes CI; tests still pass.
