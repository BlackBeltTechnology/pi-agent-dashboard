# Generator pattern — shot table → HyperFrames composition

The composition is **generated**, never hand-edited. Write one small project-local
generator (Python or Node) with this structure; this skill deliberately ships no
generator script, because every project's shot tables differ.

## Inputs

| Input | Used for |
|---|---|
| Shot table per scene (in the generator) | clip id, file, source in-point, duration, framing (object-position / zoom), speed, on-screen copy, FX layer |
| `music/<stem>_edit.json` (`music-edit/1`) | root duration = `duration`; scene starts from `downbeats_video`; the drop-aligned boundaries |
| `music/<stem>_hits.json` (`music-hits/1`) | camera punches: `hits[]` + `recipe{}` (never hard-code the constants) |

Pass 1 runs with provisional scene durations and no `_edit.json` / `_hits.json`; pass 2
reads both. The generator must work in both modes.

## Outputs

```
hf/index.html                  root: data-duration = edit duration; one host per scene
                               (data-composition-src="compositions/sN.html", data-start = scene start)
                               + <audio id="music" src="assets/music/<edit>.wav"> (the id is mandatory)
hf/compositions/s1.html … sN.html   one sub-composition per scene
```

## Per scene sub-composition

```html
<div id="root" data-composition-id="s6" data-width="1920" data-height="1080" data-duration="14.46">
  <div class="cam" id="s6-cam">                          <!-- punch target: INSIDE the sub-composition -->
    <div class="shot" id="s6-a" data-layout-allow-overflow>   <!-- zoomed shots may overflow -->
      <div class="inner"><video src="assets/clips/c26.mp4" data-start="0" data-duration="3.2" …></video></div>
    </div>
    <div class="fxw"><video src="assets/fx/flare.mp4" …></video></div>   <!-- screen blend on the wrapper -->
  </div>
</div>
<script>
  // shot motion on .inner, punches on #s6-cam — all fromTo, seek-safe
  tl.fromTo("#s6-cam", {scale:1.12, y:-48, x:36, rotation:0.8},
            {scale:1, y:0, x:0, rotation:0, duration:0.6, ease:"expo.out", immediateRender:false}, 0.000);
</script>
```

## Rules the generator enforces

1. Scene `k` starts at a downbeat from `downbeats_video`; each confirmed drop starts a scene.
2. The last scene ends at the edit `duration` (end card holds through the music decay).
3. A hit at video time `t` inside scene `k` is tweened at `t − start_k` on scene `k`'s `.cam`.
4. Jolt direction alternates per hit (`x: +recipe.x, −recipe.x, …`).
5. After every generation: `npx hyperframes check` (0 errors) and snapshots at scene
   midpoints and at each hit + settle time.
