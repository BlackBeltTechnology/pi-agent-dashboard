## 0. Gating probes

- [ ] 0.1 FilmCraft: SRT/caption import or caption track support; fallback = EffectCraft-rendered caption overlays
- [ ] 0.2 SoundCraft: loudness measurement + limiter/normalize commands for a LUFS target; fallback = ffmpeg `loudnorm`
- [ ] 0.3 FilmCraft: placing edits at beat times (`sequence.addEdit` + `playhead.set`) from a `music-hits/1` file
- [ ] 0.4 EffectCraft: template render (`render --template … --values …`) round-trip

## 1. Shared

- [ ] 1.1 Skill lint: every workflow step has an output + `pi-craft verify` gate; step 0 has sibling checks; resume step present
- [ ] 1.2 Router (`craft-studio`) table rows for the 4 workflows + FilmCraft/HyperFrames split

## 2. Workflows (each: write skill → execute once end-to-end on fixtures → fix)

- [ ] 2.1 `craft-video-post` (W1)
- [ ] 2.2 `craft-beat-cut` (W2)
- [ ] 2.3 `craft-podcast-master` (W3)
- [ ] 2.4 `craft-motion-titles` (W4)

## 3. Docs + QA

- [ ] 3.1 README section + `AGENTS.md` rows
- [ ] 3.2 Manual: pi session runs W1 on a 30 s sample with captions and music; verify reports all pass
- [ ] 3.3 `review-code`
