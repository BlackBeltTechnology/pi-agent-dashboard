# research/test-suite-performance.md — index

Research dossier. WHY `npm test` takes 12 min: 728.81s wall / 1456 files, 3547 worker-s ÷ 8 workers (`maxWorkers: "50%"`) → ~443s floor = too much work + poor packing. 4 bottlenecks: mutation-harness 238.0s critical path (33% wall); 50% cores idle (client threads+100% = 124.2s vs 178.0s); jsdom env 743.98s vs 169.25s tests; `maxWorkers: 1` projects serial AFTER pool. Levers A–G, A+B+D → ~3–4 min. RESEARCH ONLY. → see `research/test-suite-performance.md.AGENTS.md`
