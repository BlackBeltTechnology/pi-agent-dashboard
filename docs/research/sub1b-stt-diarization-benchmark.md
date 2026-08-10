# Sub-1B Open-Source Speech-to-Text + Diarization: Landscape Research & Local CPU Benchmark

> Comprehensive session record. Research into open-source, sub-1B-parameter speech-to-text
> models that can detect speakers ("diarization"), followed by a hands-on local-CPU benchmark
> of **MOSS-Transcribe-Diarize** vs **Soniox** (cloud), then extended to **Parakeet-v3** and
> two diarizers (**pyannote** and **Sortformer**). Nothing omitted: full method, all transcripts,
> every speed/quality number, every gotcha, and the reproduction recipe.

- **Date context:** the machine clock read **July 2026**; "recent releases" = the mid-2026 wave (past most training cutoffs — all model facts pulled live from the Hugging Face API, not memory).
- **Goal (verbatim intent):** research recent (past month) open-source sub-1B STT models able to detect speaker, maybe intent, long conversation, for processing long recordings offline (not realtime). The user recalled a "special" model that "directly addresses diarization" — garbled as "dhydratization".
- **Decode:** "dhydratization" → **diarization** (speaker "who spoke when"). The special model = **MOSS-Transcribe-Diarize** (the name literally contains "Diarize"; diarization is built into the transcription model). Confirmed by the user.
- **User constraints (confirmed):** recordings in **Hungarian + English**; **CPU-only laptop** target (actual test box is an Intel Mac, details below); **no** intent/topic detection needed (understood to be a separate downstream LLM step, not in the STT model).

---

## 1. Test environment

| Property | Value |
|---|---|
| Machine | Intel Mac, **x86_64** |
| CPU | 16 cores |
| RAM | 64 GB |
| GPU | Discrete **AMD Radeon RX 580** (pre-M5, no simdgroup matmul) |
| Disk free | ~42 GB at start → ~28 GB after all installs (99% full) |
| Python | 3.12.6 (pyenv) |
| Key libs | onnxruntime 1.23.2, **torch 2.2.2** (Intel-Mac ceiling — PyTorch dropped x86-macOS wheels after 2.2.2), ffmpeg/ffprobe in /usr/local/bin |
| hf CLI | present (pyenv shim) |
| Cloud STT | Soniox (`stt-async-v3`), key in `~/Movies/.env` and `~/Documents/.env` |

**Audio corpus:** `~/Movies` is an iCloud symlink holding dozens of meeting recordings (`*.mp3`, many Hungarian) plus prior **Soniox `.srt` sidecars** (used as free ground truth). English test audio: `~/Downloads/JUDO Poscast.mp3`. Note: `find ~/Movies -iname '*.mp3'` may miss iCloud files — use `find -L ~/Movies` or `ls`.

---

## 2. Landscape research — sub-1B STT models (July 2026, live HF data)

### 2.1 Trending ASR models (downloads / likes, abridged)

```
nvidia/nemotron-3.5-asr-streaming-0.6b      dl 750k   likes 923
pyannote/speaker-diarization-3.1            dl 8.6M   likes 2814   (diarization only)
pyannote/speaker-diarization-community-1    dl 5.1M   likes 825    (diarization only)
openai/whisper-large-v3 / -turbo            dl 6-8M   (>1B, out of scope)
CohereLabs/cohere-transcribe-03-2026        dl 1.2M   (2B)
Qwen/Qwen3-ASR-1.7B / -0.6B                 dl 1.6M / 1.3M
mistralai/Voxtral-Mini-4B-Realtime-2602     dl 2.0M   (>1B)
nvidia/parakeet-tdt-0.6b-v3                  dl 93k    likes 1006
nvidia/diar_streaming_sortformer_4spk-v2.1  dl 108k   (diarization only)
nvidia/diar_sortformer_4spk-v1              dl 11k    (diarization only)
AutoArk-AI/Audio8-ASR-0.1B                  dl 504    (tiny 0.1B)
```

### 2.2 Sub-1B candidates (the shortlist)

| Model | Params | Diarization | Long audio | Languages | License |
|---|---|---|---|---|---|
| **MOSS-Transcribe-Diarize** ★ | 0.9B | ✅ built-in (joint) | ✅ long-form native | EN/ZH official (+14 tested) | Apache-2.0 |
| NVIDIA Nemotron 3.5 ASR | 0.6B | ❌ | streaming+batch | 40 locales (incl. hu) | OpenMDW-1.1 |
| NVIDIA Parakeet-tdt-0.6b-v3 | 0.6B | ❌ | 24 min full / 3 h local | 25 European (incl. **hu**) | CC-BY-4.0 |
| Qwen3-ASR-0.6B | 0.6B | ❌ (community FT exists) | chunked | 52 | Apache-2.0 |
| Audio8-ASR-0.1B | 0.1B | ❌ | short | 7 (en/zh/fr/ja/yue/de/ko) | CC-BY-NC-4.0 |
| NVIDIA Sortformer 4spk (v1 / v2.1) | ~0.6B | ✅ diarization ONLY | up to 4 spk | audio | NVIDIA-open |

### 2.3 The standout — MOSS-Transcribe-Diarize 0.9B

- Repo: `OpenMOSS-Team/MOSS-Transcribe-Diarize` (created 2026-05-19, ~112k downloads; 0.9B params; Apache-2.0; pipeline `audio-text-to-text` → an LLM-style decoder).
- Card blurb: *"turns real-world long-form audio into structured, speaker-aware transcripts in one pass. Instead of stitching together separate ASR and diarization systems, it jointly performs speech transcription and speaker diarization, producing time-aligned text with consistent speaker labels."*
- Also: timestamps + **acoustic-event awareness**. Tags: asr, diarization, timestamp-asr, long-form-audio, multimodal, multilingual, custom_code.
- Won **1st place, 2nd MLC-SLM Challenge (INTERSPEECH 2026)** across **14 languages** (EN, FR, DE, IT, PT, ES, JA, KO, RU, TH, VI, Tagalog, Urdu, TR) — **Hungarian not among them**; the card officially lists only **EN/ZH**.
- Precursor: `OpenMOSS-Team/MOSS-Transcribe-preview-2B` (2026-06-26).

### 2.4 "Intent" — honest caveat

None of these do intent natively; they are transcription/diarization models. Intent/topic/summary is a downstream NLU step (run an LLM over the transcript). MOSS is the closest since it's already a decoder-LM, but the released weights target transcription + diarization, not intent labels. The user confirmed intent is **not** required.

### 2.5 Language pre-verdict (before benchmarking)

MOSS is EN/ZH-strong and Hungarian-uncertain; the models that *explicitly* list Hungarian are the ASR-only ones (Parakeet-v3, Nemotron-3.5). So for Hungarian **speaker-aware** output you're pushed toward **ASR + separate diarizer**, unless MOSS's Hungarian proves good enough. This motivated the benchmark.

---

## 3. Benchmark methodology

### 3.1 The MOSS runner (moss-transcribe.cpp)

MOSS GGUF is a multimodal audio-LLM, not a standard GGUF — it needs a dedicated runner. Two HF GGUF repos exist with **incompatible formats**:
- `mudler/moss-transcribe.cpp-gguf` → for **moss-transcribe.cpp** (the runner used here).
- `handy-computer/moss-transcribe-diarize-gguf` → for a different `transcribe.cpp` — **NOT compatible** with the mudler binary.

Build (CPU-only) — **the critical `-DGGML_METAL=OFF`**:

```bash
git clone --recursive https://github.com/mudler/moss-transcribe.cpp
cd moss-transcribe.cpp
cmake -B build -DCMAKE_BUILD_TYPE=Release -DGGML_METAL=OFF -DGGML_ACCELERATE=ON -DGGML_BLAS=ON
cmake --build build -j        # -> build/moss-transcribe
```

**Metal crash (root cause + fix):** the default build auto-selects the Metal backend; on this Intel Mac's AMD RX 580 it aborts:
```
ggml_metal_op_encode_impl: error: unsupported op 'MUL_MAT'
... Abort trap: 6   (exit 134)
```
The RX 580 lacks simdgroup matrix-mul. Fix = rebuild with `-DGGML_METAL=OFF` (delete `build/` first). A true CPU-only laptop won't hit this; any Intel Mac + old GPU will.

Model download (Q5_K = 618 MB; quants q4_0/q4_k/q5_0/q5_k/q6_k/q8_0/f16 available):
```bash
hf download mudler/moss-transcribe.cpp-gguf moss-transcribe-q5_k.gguf --local-dir .
```
CLI: `moss-transcribe transcribe <model.gguf> <audio.wav> [--format text|srt|ass|json]`. MOSS labels speakers inline as `S01`/`S02`.

### 3.2 Soniox runner

The repo's `pi-transcribe` bin (`node_modules/.bin`) is **unbuilt** (TypeScript; throws `ERR_MODULE_NOT_FOUND: src/run.js`). Instead the Soniox async REST flow was replicated directly in a Node script (mirrors `packages/video-transcription/src/soniox.ts`):

1. `POST /v1/files` (multipart) → `file_id`
2. `POST /v1/transcriptions` `{ model: "stt-async-v3", enable_speaker_diarization: true, enable_language_identification: true, file_id }` → `id`
3. poll `GET /v1/transcriptions/{id}` until `status == "completed"`
4. `GET /v1/transcriptions/{id}/transcript` → tokens (`.text`, `.start_ms`, `.speaker`, `.language`)
5. `DELETE /v1/files/{id}`

Base `https://api.soniox.com/v1`, `Authorization: Bearer <key>`. Key loaded via `set -a; source ~/Movies/.env; set +a`. Output grouped by contiguous `.speaker` → `[n]` labels.

### 3.3 Samples (60 s each, 16 kHz mono WAV)

Cut with `ffmpeg -v error -y -ss <HH:MM:SS> -t 60 -i <src> -ac 1 -ar 16000 -c:a pcm_s16le <out>.wav`.

| ID | Type | Source | Window | Notes |
|---|---|---|---|---|
| **S1** | single-speaker HU | `SunbloomBlackbelt konzuláció…mp3` | 00:00:02 +60s | `[1]` monologue intro |
| **S2** | multi-speaker HU | same Sunbloom file | 00:02:15 +60s | dense `[1]/[2]/[3]` switches |
| **S3** | single-file EN | `~/Downloads/JUDO Poscast.mp3` | 00:00:20 +60s | 2 podcast hosts |

Speaker-dense window discovery (awk over an existing Soniox `.srt`):
```bash
awk '/-->/{split($1,a,",");t=a[1]} /^\[/{lbl=substr($1,2,1); print t,lbl}' file.srt \
 | awk 'NR>1 && $2!=prev{print $1" -> ["$2"]"} {prev=$2}'
```

Ground-truth speaker counts (from Soniox `.srt`): **S1 = 1, S2 = 2, S3 = 2**.

---

## 4. Results — MOSS (Q5_K) vs Soniox

### 4.1 Speed

| Clip (60 s) | MOSS Q5 local CPU | RTF | Soniox cloud wall |
|---|---|---|---|
| S1 HU single | 54 s | 0.90× | 8.0 s |
| S2 HU multi | 59 s | 0.98× | 8.2 s |
| S3 EN | 69 s | 1.15× | 11.8 s |

MOSS ≈ real-time on CPU (~1×). Soniox returns in seconds but is **cloud** (network + queue bound, parallelizable to 100 jobs, per-minute cost, audio leaves the machine). The speed comparison is I/O vs compute — not directly comparable.

### 4.2 S1 — single-speaker understanding (Hungarian)

**Soniox** (1 speaker, clean, punctuated):
> [1] Oké, elkezdődött. Köszönöm szépen akkor ezt az újabb alkalmat. Hadd mutassam be Csákány Robi kollégámat, ugye. Bertal, miután átnéztük a feladatot, azt gondoltuk, hogy a cégben ő leginkább alkalmas arra, hogy itt ezt a szoftvert megtervezze, meg végiggondolja. Úgyhogy el is merült azóta a minősítési témákban, amikről egyrészt szeretnénk ma beszélni. Tehát kettős célja volt a mai megbeszélésnek, és itt majd Robi ezekből készült. Az egyik az az, hogy a minősítés témakörét tovább körbejárjuk. Mondtad, hogy te is utána kérdezel. Ugye itt a NIS2, meg a Good Manufacturing Practice, ha jól emlékszem, ez volt a GAMP-nek a... ebben mi utánanéztünk, amit tudtunk, de természetesen leginkább az érdekelne, hogy ti milyen elvárásaitok vannak ennek terén. Úgyhogy ez az egyik dolog, amit.

**MOSS Q5** (collapsed from ~50 tiny SRT segments; mostly `S01`, one false `S02`):
> S01: Ok, elkezdődött. Ja, neki köszönöm szépen akkor ezt az újabb alkalmat. Hogy mutassam be Csákány Robbie kollégámat. Ugye mi a bárta, ha nem után átnéztük a feladatot, akkor azt gondoltuk, hogy a cégekben leginkább alkalmas arra, hogy ezt a szoftvert megtervezze, meg végiggondolja. Úgyhogy elismerült azóta a minősítési témákban, amikről egyrészt szeretnénk ma beszélni. Tehát kettős célja volt ugye a mai megbeszélésenek. És itt majd Robbie ezekből készült. Az egyik az az, hogy a minősítési témaköré tovább körebe járjuk. Mondhat, hogy te is utána kérdezel. Ugye itt a NIS 2, meg a valami, ugye a Good Manufacturing Practices, ha jól emlékszem, ugye ez volt.
> S02: Genp, igen.
> S01: Genpnek, ebbe mi utána néztünk, amit tudtunk, de természetesen leginkább azért az érdekelne, hogy ti milyen elvárásaitok vannak ennek terén. Úgyhogy ez az egyik dolog, amivel...

**Analysis:** Content mostly correct Hungarian, but MOSS is noisier — errors ("mi a bárta" vs "Bertal"; "elismerült" vs "el is merült"), heavy fragmentation, and a **false speaker split** ("Genp, igen" → S02, a garble of "GAMP-nek"). Soniox is cleaner. MOSS's Hungarian is **better than its EN/ZH-only card suggested** — usable, just noisier.

### 4.3 S2 — multi-speaker diarization (Hungarian)

**Soniox** (crisp 2-speaker turns):
> [1] Ööö.
> [2] Ja, értem, értem.
> [1] És én azért így 3-ig elég éhes leszek.
> [2] Jó, jó, jó.
> [1] Majd egy...
> [2] Oké, akkor.
> [1] Egy ilyen 10-15 percet. De lehet, hogy az lesz, hogy idehozom, és megeszem közben, és közben figyelek. Ha nem lehetek, nem baj, hogy ilyen híres vagyok.
> [2] Nekünk az is, nekünk az is megfelel.
> [1] Ööö, igen, mert... igazából az egész nap el van csúszva meeting ügyileg, mert senki nem ért be csak ilyen 10 után. Ugye itt Nógrád megyében azért gondolhatjátok, hogy milyen útviszonyok vártak minket így reggel.
> [2] Hát, Pesten itt se volt sokkal jobb a szitu.
> [1] Igen, úgyhogy én Veresről jöttem fel ide, és nagyjából végig szánkóztam, meg csúszkáltam, és...
> [2] Úristen.
> [1] Igen, úgyhogy emiatt egy picit így az egész nap el van... el van.
> [2] Jó, semmi gond. Még annyit szeretnék kérdezni, akkor mielőtt belevágunk, hogy ugye az Excel táblákat meg azokat nem kaptuk meg, de tudtál egyeztetni a kollégával? Vagy kollégáddal?
> [1] Én... én elküldtem egyébként, és ő is küldte, viszont...

**MOSS Q5** (2 speakers S01/S02; identity arbitrary vs Soniox):
> S01: Ja, értem, értem.
> S02: És én azértígy háromig elég éjszak.
> S01: Jó, jó, jó, oké.
> S02: Egy ilyen tíz, tizenöt percet, de lehet, hogy az, hogy ide hozom és meg ezt nem közben is, közben figyelek. Ha nem lehetek, nem baj, hogy ilyen.
> S01: Nekünk az is, nekünk az is megfelel.
> S02: Igen, mert az egész nap el van csúsz, amit így leg, mert senki nem értve csak ilyen tíz után. Ugye itt Nógrád megyében azért gondolhatjátok, hogy milyenútviszonyok várak minketígy reggel.
> S01: Hát itt se volt sokkal jobb a szitu.
> S02: Igen, úgyhogyén veresről jöttem fel ide és nagyjából végig szánkóztam, meg csúszkáltam.
> S01: Ó, rossz.
> S02: Igen, úgyhogy amiatt egy picit így az egész nap el van.
> S01: Jó, sem még onnan. Még annyit szeretnék kérdezni, akkor mielőtt belevágunk, hogy ugye az Excel táblákat meg azokat nem kaptuk meg, de tudtál egyeztetni a kollégát?
> S02: Én elküldtem egyébként és ő is küldte, viszont.

**Analysis:** Both correctly find 2 alternating speakers. Soniox boundaries + text are cleaner ("elég éhes leszek" vs MOSS "elég éjszak"; "senki nem ért be" vs "senki nem értve"). MOSS is usable but noisier.

### 4.4 S3 — English (2 podcast hosts) — MOSS's strong suit

**Soniox** (excellent, but misheard the product as "JEDA"):
> [1] Imagine this: you could build complex business applications with less code, fewer late nights, you know, hunting down bugs, and way more flexibility.
> [2] That's the promise of JEDA, this open-source low-code toolbox that's got everyone buzzing.
> [1] What's fascinating about JEDA is that it's not just about, uh, dragging and dropping boxes on a screen; it takes a different approach. It uses a text-based language called JSL to create, like, a detailed blueprint of your software. It gives you a level of control and precision that you don't always get with those, like, visual-based low-code tools.
> [2] Okay, I'm intrigued.
> [1] But let's unpack this a bit: why JEDA, and why should you, the listener, care? What's the big idea here?
> [2] Think about the traditional software development process: countless hours spent writing line after line of code, often repeating the same tasks over and over again.
> [1] It's time-consuming, it's prone to errors, and honestly, it can be pretty tedious.
> [2] You're telling me I've definitely had my fair share of those, uh, staring-at-the-screen-until-2 a.m. moments during the day.

**MOSS Q5** (fragmented but excellent content; **got the product name right**: "J U D O" and "J S L"):
> S01: Imagine this, you could build complex business applications with less code, fewer late nights, you know, hunting down bugs, and way more flexibility.
> S02: That's the promise of J U D O, this open source, low-code toolbox that's got everyone buzzing.
> S01: What's fascinating about J U D O is that it's not just about dragging and dropping boxes on a screen. It takes a different approach. It uses a text-based language called J S L to create like a detailed blueprint of your software. It gives you a level of control and precision that you don't always get with those like visual-based, low-code tools.
> S02: Okay, intrigued.
> S01: But let's unpack this a bit. Why J U D O and why should you, the listener, care? What's the big idea here?
> S02: Think about the traditional software development process. Countless hours spent writing line after line of code, often repeating the same tasks over and over again.
> S01: It's time-consuming, it's prone to errors, and honestly, it can be pretty tedious.
> S02: You're telling me, I've definitely had my fair share of those staring at the screen until 2 a.m. moments trying to

**Analysis:** On English MOSS is on par with — and on the domain term **better than** — Soniox (MOSS "JUDO" vs Soniox "JEDA"). Only weakness: over-fragmentation (cosmetic).

### 4.5 MOSS vs Soniox — verdict

```
                     MOSS (local)              Soniox (cloud)
Privacy/offline      ✅ 100% on-device          ❌ uploads audio
Cost                 ✅ free                     ❌ per-minute API
Speed (batch)        ⚠️ ~1× real-time           ✅ seconds, 100-parallel
Hungarian quality    ⚠️ usable, noisier         ✅ cleanest
English quality      ✅ excellent (won on JUDO)  ✅ excellent
Diarization          ✅ correct, coarser         ✅ correct, cleaner
Formatting           ❌ over-fragmented          ✅ sentence-grouped
```

---

## 5. Quantization: MOSS Q8_0 vs Q5_K

Q8_0 = 941 MB (vs Q5_K 618 MB). Speed slightly worse (RTF ~1.1–1.17× vs 0.9–1.15×).

| Clip | Q8 vs Q5 outcome |
|---|---|
| S1 HU single | **Wash.** Same false speaker-split on "GAMP" (Q5 "Genp"/Q8 "Gam"); Q8 stutters "Gampnek a, Gampnek a". Core errors persist in both. |
| S2 HU multi | **Wash.** Q8 wins one word ("miting ügyileg" ≈ "meeting ügyileg"), loses others ("Nohgrád", "szító"). Identical diarization. |
| S3 EN | **Byte-identical.** Zero difference. |

Q8_0 handy-computer WER table (LibriSpeech test-clean, informational): BF16 2.08%, F16 2.07%, **Q8_0 1.93%**, Q6_K 1.96%, Q5_K_M 1.99%, Q4_K_M 2.59%.

**Conclusion:** Q8_0 buys nothing measurable on this content (English byte-identical — the mudler README states "byte-identical through q5"; Hungarian a net wash) and costs ~20% speed + 320 MB. **The Hungarian gap is a model limitation, not a quantization one — you cannot quantize your way to Soniox-level Hungarian.** Recommendation: **use Q5_K.**

---

## 6. Adding Parakeet-v3 (NVIDIA parakeet-tdt-0.6b-v3)

Parakeet-v3 is a NeMo ASR model — **ASR-only, no built-in diarization** — but **officially supports Hungarian** (one of 25 European languages), exactly where MOSS is weak.

### 6.1 Runner dead ends (onnx-asr) — documented so nobody repeats them

`istupakov/parakeet-tdt-0.6b-v3-onnx` (38k dl) + the `onnx-asr` pip package looked like the clean CPU path, but:
1. **int8** (`onnx_asr.load_model("nemo-parakeet-tdt-0.6b-v3", quantization="int8")`) → emits **pure `<unk>` tokens** (broken int8 vocab).
2. **fp32** → onnxruntime **1.23.2 external-data init bug**: the fp32 encoder uses `encoder-model.onnx.data` (2.3 GB sidecar); onnx-asr loads the model into memory so onnxruntime can't resolve the sidecar →
   ```
   onnxruntime ... initializer.cc:45 ... !model_path.empty() was false.
   model_path must not be empty.
   ```
   **Not fixable** by: passing absolute path, monkeypatching `InferenceSession` to stringify the `Path`, or forcing `ORT_DISABLE_ALL` graph optimization (all tried; a bare `InferenceSession(str_path)` loads fine, but onnx-asr's own session setup still triggers the optimizer-stage failure).

### 6.2 Working path — sherpa-onnx

sherpa-onnx is the reference runtime for NeMo Parakeet transducers, with self-contained validated exports (no external-data drama):
```bash
pip install sherpa-onnx
hf download csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8 \
  encoder.int8.onnx decoder.int8.onnx joiner.int8.onnx tokens.txt --local-dir ./parakeet-sherpa
```
```python
rec = sherpa_onnx.OfflineRecognizer.from_transducer(
    encoder=".../encoder.int8.onnx", decoder=".../decoder.int8.onnx",
    joiner=".../joiner.int8.onnx", tokens=".../tokens.txt",
    num_threads=8, model_type="nemo_transducer")
# read 16k mono wav via wave+numpy (int16/32768.0)
s = rec.create_stream(); s.accept_waveform(sr, samples); rec.decode_stream(s)
# s.result exposes: text, tokens, timestamps, durations, words, segment_texts, segment_timestamps, ...
```

### 6.3 Parakeet-v3 speed — the headline

| Clip (60 s) | Parakeet-v3 local CPU | RTF |
|---|---|---|
| S1 HU single | 3.3 s | **0.055×** |
| S2 HU multi | 3.5 s | 0.058× |
| S3 EN | 3.2 s | 0.053× |

**~18× real-time** — a 1-hour meeting transcribes in ~3.5 min. Faster than MOSS (~1×) and faster than Soniox's cloud round-trip, fully offline.

### 6.4 Parakeet-v3 transcripts

**S1 (HU single):**
> Elkezdőd. Neki köszönöm szépen a ezt az újabb alkalmat. Hogy mutassam be csákány kollégámat, ugye Bártal, nemután átnéztük a feladatot, akkor azt gondoltuk, hogy a cégbe őünk leginkább alkalmas arra, hogy ittem ezt a szoft megtervezem meg végig gondolja, úgyhogy elismerült azóta a minősítési témákban, amiről egyrész szeretnénk ma beszélni. Tehát kettős célja volt ugye a mai megbeszélésnek, és itt majd Robi ezekből készült. Az egyik az az, hogy a minősítés témakörét tovább körbejárjuk mondat, hogy te is után kérdezel, ugye itt a nincs kettő meg valami a good manufacturing practice, ha jól emlékszem, ugye ez volt. GAMPnek a GAMPnek a, ebben mi utána néztünk, amit tudtunk, de természetesen leginkább azért az érdekelne, hogy ti, milyen elvárásaitok vannak ennek terén, úgyhogy ez az egyik dolog, amivel.

**S2 (HU multi) — one continuous block, NO speaker labels:**
> Jó értem. És én azért így háromig elégges leszek. Jó, jó. Egy ilyen 10 15 perc, de lehet, hogy az idehozom és megetem közben is közvefyelek. Ha nem lehetek nem baj, hogy ilyenek. Nünk az is megfelelő. Igen, mert az egész nap el van csúsz a meeting ügyileg, mert senki nem értve csak ilyen 10 után. Ugye Nógrád megyében azért gondolhatjátok, hogy milyen útviszonyok vártak minket így reggel. Igen, úgyhogy én veresről jöttem fel ide, és nagyjából végig szánkóztam, meg csúszkáltam. Igen, úgyhogy emiatt egy picit így az egész nap el van. Még annyit szeretnék kérdezni, akkor mi mielőtt belevágunk, hogy az excel táblákat, meg azokat nem kaptuk meg, de tudtál egyeztetni akkor kollégának. Én elküldtem egyébként, és ő is küldte, viszont.

**S3 (EN):**
> Imagine this. You could build complex business applications with less code, fewer late nights, you know, hunting down bugs, and way more flexibility. That's the promise of JUDA, this open source low-code toolbox that's got everyone buzzing. What's fascinating about JU is that it's not just about uh dragging and dropping boxes on a screen. It takes a different approach. It uses a text-based language called JSL to create like a detailed bluprint of your software. It gives you a level of control and precision that you don't always get with those like visual based low code tools. Okay, intrigues. But let's unpack this a bit. Why JUDO and why should you, the listener, care? What's the big idea here? Think about the traditional software development process. Countless hours spent writing line after line of code, often repeating the same tasks over and over again. It's time consuming, it's prone to errors, and honestly, it can be pretty tedious. You're telling me I've definitely had my fair share of those uh staring at the screen until 2 a.m. moments trying to

### 6.5 Parakeet-v3 analysis

- **Hungarian:** on par with MOSS — got the name "Bártal" closer, "meeting ügyileg" right; same "GAMPnek a GAMPnek a" stutter; misheard "NIS2" → "nincs kettő".
- **English:** excellent, but inconsistent on the domain term ("JUDA"/"JU"/"JUDO" in one pass; MOSS was steadier).
- **Diarization: none.** One continuous transcript, zero speaker labels — the dealbreaker for multi-speaker meetings unless a diarizer is bolted on.

---

## 7. Diarizers on Parakeet-v3 — pyannote vs Sortformer

Parakeet exposes per-token `timestamps` + `durations`, enabling a merge: assign each token to the diarizer turn containing the token's midpoint (`start + dur/2`), then group consecutive same-speaker tokens into `[speaker] text`.

### 7.1 Diarizer A — pyannote via sherpa-onnx (easy, no HF token)

No HF token was available, so the gated `pyannote.audio` models couldn't auto-download. sherpa-onnx has a built-in `OfflineSpeakerDiarization` (pyannote **segmentation** ONNX + a speaker-**embedding** ONNX):
```bash
hf download csukuangfj/sherpa-onnx-pyannote-segmentation-3-0 model.onnx --local-dir ./diar/seg
hf download csukuangfj/speaker-embedding-models \
  3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx --local-dir ./diar/emb
```
Config: `OfflineSpeakerDiarizationConfig(segmentation=…Pyannote(model=seg), embedding=…(model=emb), clustering=FastClusteringConfig(num_clusters=-1, threshold=T), min_duration_on=0.3, min_duration_off=0.5)` → `sd.process(x).sort_by_start_time()`.

**Over-clustering + threshold sweep** (num true speakers = 1/2/2):

| Clip (truth) | th 0.5 | 0.6 | 0.7 | 0.8 | 0.9 | 1.0 |
|---|---|---|---|---|---|---|
| S1 (1) | 4 | 3 | 3 | 2 | 2 | **1** |
| S2 (2) | 6 | 6 | 5 | 4 | **2** | 2 |
| S3 (2) | 4 | 4 | 4 | 4 | 4 | **2** |

At the default 0.5 it wildly over-clusters. **threshold = 1.0** gave correct counts for all three — but that required knowing the answer (an oracle knob you don't have in production). Diarization time ~7.5 s/60 s.

**Parakeet + pyannote (threshold 1.0) merged output:**

*S1 (1 speaker — correct):* full monologue as `[0]` (same text as §6.4 S1).

*S2 (2 speakers):*
> [0] Jó értem. És én azért így háromig elégges leszek. Jó, jó. Egy ilyen 10 15 perc, de lehet, hogy az idehoz
> [1] om és megetem közben is köz
> [0] vefyelek. Ha nem lehetek nem baj, hogy ilyenek. Nünk az is megfelelő. Igen, mert az egész nap el van csúsz a meeting ügyileg, mert senki nem értve csak ilyen 10 után. Ugye Nógrád megyében azért gondolhatjátok, hogy milyen útviszonyok vártak minket így reggel. Igen, úgyhogy én veresről jöttem fel ide, és nagyjából végig szánkóztam, meg csúszkáltam. Igen, úgyhogy emiatt egy picit
> [1] így az egész nap el van
> [0] . Még annyit szeretnék kérdezni, akkor mi mielőtt belevágunk, hogy az excel táblákat, meg azokat nem kaptuk meg, de tudtál egyeztetni akkor kollégának. Én elkül
> [1] dtem egyébként,
> [0] és ő is küldte
> [1] , viszont.

*S3 (2 speakers — good host A/B split):*
> [0] Imagine this. You could build complex business applications with less code, fewer late nights, you know, hunting down bugs, and way more flexibility. That's the promise of JUDA, this open source low-code toolbox that's got everyone buzzing. What's fascinating about JU is that it's not just about uh dragging and dropping boxes on a screen. It takes a different approach. It uses a text-based language called JSL to create like a detailed bluprint of your software. It gives you a level of control and precision that you don't always get with those like visual based low code tools.
> [1] Okay, intrigues.
> [0] But let's unpack this a bit. Why JUDO and why should you, the listener, care? What's the big idea here?
> [1] Think about the traditional software development process. Countless hours spent writing line after line of code, often repeating the same tasks over and over again.
> [0] It's time consuming, it's prone to errors, and honestly, it can be pretty tedious.
> [1] You're telling me I've definitely had my fair share of those uh staring at the
> [0] screen until 2 a.m. moments trying to

### 7.2 Diarizer B — Sortformer via NeMo (brutal setup on Intel Mac)

Model: `nvidia/diar_sortformer_4spk-v1`. Requires NeMo. **The full unlock sequence on this Intel Mac (torch 2.2.2 ceiling vs NeMo 2.6.1 wanting torch ≥ 2.4):**

1. **numba/llvmlite** wheels (source build of llvmlite fails on Python 3.12):
   ```bash
   pip install --only-binary :all: "llvmlite>=0.43" "numba>=0.60"   # → llvmlite 0.45.1, numba 0.62.1
   ```
2. `pip install "nemo_toolkit[asr]"` → NeMo 2.6.1 (bumps numpy→2.3.5, pandas→3.0.5, transformers→4.53.3).
3. **Stub two torch-2.4 APIs before importing nemo** (NeMo's megatron/FSDP2 strategy imports them but Sortformer never uses them):
   - `torch.distributed.tensor.parallel.SequenceParallel` (+ `ColwiseParallel`, `RowwiseParallel`, `PrepareModuleInput`, `PrepareModuleOutput`) → dummy classes.
   - a fake `torch.nn.attention` module: `sdpa_kernel` no-op contextmanager + `SDPBackend` enum (added in torch 2.3).
4. **Downgrade numpy < 2** (`pip install "numpy<2"` → 1.26.4): torch 2.2.2's `tensor.numpy()` raises `RuntimeError: Numpy is not available` on numpy 2.x.

After that, Sortformer loads and runs on CPU:
```python
m = SortformerEncLabelModel.from_pretrained("nvidia/diar_sortformer_4spk-v1", map_location="cpu")
m.eval()
pred = m.diarize(audio=[wav], batch_size=1)   # pred[0] = list of "start end speaker" strings → RTTM
```
Auto speaker count (no tuning, capped at 4). **Diarization ~2.2 s/60 s (~3× faster than pyannote) + ~2.5 s one-time model load.** A Linux box / torch ≥ 2.4 avoids the entire stub/downgrade dance.

**Sortformer raw speaker durations (S2):** speaker_0 45.2 s, speaker_1 15.4 s, speaker_2 4.2 s, speaker_3 0.4 s → 2 dominant + 2 spurious.

**Parakeet + Sortformer merged output:**

*S1 (2 raw, effectively 1 — 2nd is a 0.16 s "." blip):*
> [speaker_0] Elkezdőd. Neki köszönöm szépen a ezt az újabb alkalmat. … ugye ez volt
> [speaker_1] .
> [speaker_0] GAMPnek a GAMPnek a, ebben mi utána néztünk, … úgyhogy ez az egyik dolog, amivel.

*S2 (4 detected; 2 dominant correct + 2 spurious):*
> [speaker_0] Jó értem. És én azért így háromig elégges leszek.
> [speaker_1] Jó, jó. Egy il
> [speaker_0] yen 10 15 perc, de lehet, hogy az idehozom és megetem közben is közvefyelek. Ha nem lehetek nem baj, hogy ilyenek. Nünk
> [speaker_1] az is megfelelő.
> [speaker_0] Igen, mert az egész nap el van csúsz a meeting ügyileg, mert senki nem értve csak ilyen 10 után. Ugye Nógrád megyében azért gondolhatjátok, hogy milyen útviszonyok vártak minket így reggel.
> [speaker_2] Igen, úgyhogy én
> [speaker_0] veresről jöttem fel ide, és nagyjából végig szánkóztam, meg csúszkáltam. Igen, úgyhogy emiatt egy picit így az egész nap el van.
> [speaker_1] Még annyit szeretnék kérdezni, akkor mi mielőtt belevágunk, hogy az excel táblákat, meg azokat nem kaptuk meg, de tudtál egyeztetni akkor kollégának. É
> [speaker_0] n elküldtem egyébként, és ő is küldte, viszont.

*S3 (2 speakers — clean host A/B):*
> [speaker_0] Imagine this. You could build complex business applications with less code, fewer late nights, you know, hunting down bugs, and way more flexibility.
> [speaker_1] That's the promise of JUDA, this open source low-code toolbox that's got everyone buzzing.
> [speaker_0] What's fascinating about JU is that it's not just about uh dragging and dropping boxes on a screen. It takes a different approach. It uses a text-based language called JSL to create like a detailed bluprint of your software. It gives you a level of control and precision that you don't always get with those like visual based low code tools. Okay
> [speaker_1] , intrigues.
> [speaker_0] But let's unpack this a bit. Why JUDO and why should you, the listener, care? What's the big idea here?
> [speaker_1] Think about the traditional software development process. Countless hours spent writing line after line of code, often repeating the same tasks over and over again.
> [speaker_0] It's time consuming, it's prone to errors, and honestly, it can be pretty tedious.
> [speaker_1] You're telling me I've definitely had my fair share of those uh staring at the screen until 2 a.m. moments trying to

### 7.3 Diarizer comparison

**Speaker-count accuracy (vs ground truth 1/2/2):**

| Clip | Truth | Sortformer (auto) | pyannote (tuned) |
|---|---|---|---|
| S1 | 1 | 2 → really 1 (0.16 s blip) | 1 ✓ (only at threshold 1.0) |
| S2 | 2 | 4 → 2 real (45s+15s) + 2 spurious (4s,0.4s) | 2 ✓ (tuned) |
| S3 | 2 | **2 ✓** | 2 ✓ (tuned) |

**Speed (per 60 s clip, local CPU):**

| Stage | Parakeet + pyannote | Parakeet + Sortformer |
|---|---|---|
| ASR (Parakeet) | 3.5 s | 3.5 s |
| Diarization | 7.5 s | **2.2 s** |
| **Total** | ~11 s (**~5.5× RT**) | ~6 s (**~10× RT**) |

**Setup difficulty (the real differentiator):**

| | pyannote (sherpa-onnx) | Sortformer (NeMo) |
|---|---|---|
| Effort | trivial: `pip install sherpa-onnx` + 2 ONNX files | brutal on Intel Mac (binary numba/llvmlite → NeMo 2.6.1 → 2 torch-API stubs → numpy<2) |
| Tuning | needs per-audio threshold tuning | none (end-to-end auto count, capped 4) |

**Merge artifact (both):** assigning speaker at each token's midpoint cuts mid-word (`idehoz|om`, `busin|ess`). Fixable by snapping diarizer boundaries to Parakeet word boundaries.

---

## 8. Final four-way verdict

```
                       Speed(local)  Diarize quality     Setup    Tuning-free  Offline  Cost
Parakeet+Sortformer    ~10× RT ⭐     good, over-splits   brutal   ✅           ✅       free
Parakeet+pyannote      ~5.5× RT      good (tuned)        easy     ❌           ✅       free
MOSS (one model)       ~1× RT        built-in, ok        easy     ✅           ✅       free
Soniox (cloud)         cloud         cleanest ⭐          trivial  ✅           ❌       per-min
```

**Recommendations for the user's speaker-aware Hungarian recordings:**
- **Fastest local, speaker-aware, no tuning:** Parakeet + Sortformer (~10× RT) — *if* the NeMo setup is acceptable (trivial on Linux / torch ≥ 2.4).
- **Easiest local:** Parakeet + pyannote — but budget for threshold tuning per recording type.
- **Cleanest Hungarian diarization, zero fuss:** Soniox (cloud + cost).
- **Simplest single-model local:** MOSS Q5 if ~1× RT is acceptable.
- **English or privacy-sensitive:** Parakeet-v3 (or MOSS) shine locally; MOSS was steadiest on the "JUDO" domain term.

**Key cross-cutting findings:**
- MOSS's Hungarian is usable but noisier than its EN/ZH-only card implied; the gap to Soniox is a **model** limit, not a quantization one (Q8 ≈ Q5).
- Parakeet-v3 is the **local speed king (~18× RT)** but ASR-only.
- Diarizer counting is fragile: pyannote over-clusters without tuning; Sortformer auto-counts but over-splits.
- **Platform reality:** an Intel Mac (torch 2.2.2 ceiling) makes NeMo-based Sortformer painful; a Linux box removes all that friction.

---

## 9. Reproduction artifacts

All artifacts live in `~/moss-bench/` (outside the repo):

| Path | Contents |
|---|---|
| `moss-transcribe.cpp/build/moss-transcribe` | CPU-only MOSS runner (built with `-DGGML_METAL=OFF`) |
| `moss-transcribe-q5_k.gguf` / `-q8_0.gguf` | MOSS models (618 MB / 941 MB) |
| `parakeet-sherpa/` | sherpa-onnx Parakeet-v3 int8 (encoder/decoder/joiner/tokens) |
| `parakeet-v3-onnx/` | onnx-asr fp32 attempt (dead end; kept for reference) |
| `diar/seg/model.onnx`, `diar/emb/…campplus…onnx` | pyannote segmentation + speaker embedding (sherpa) |
| `S1_single_hu.wav`, `S2_multi_hu.wav`, `S3_single_en.wav` | 16 kHz mono samples |
| `*.moss.srt`, `*.q8.srt` | MOSS Q5 / Q8 transcripts |
| `*.soniox.txt` | Soniox transcripts |
| `pk.out`, `parakeet.out` | Parakeet transcripts |
| `*.rttm` | Sortformer diarization outputs |
| `soniox.mjs`, `parakeet_sherpa.py`, `pipeline.py`, `sortformer.py` | runner + merge scripts |

**Reusable procedure** captured as the project skill **`benchmark-moss-gguf-vs-soniox`**
(`~/.pi/agent/projects-memory/pi-agent-dashboard/skills/benchmark-moss-gguf-vs-soniox/SKILL.md`) —
carries the full four-engine procedure and every gotcha above; auto-loads on
"benchmark MOSS vs Soniox / Parakeet / diarizer".

### Model + tool references
- `OpenMOSS-Team/MOSS-Transcribe-Diarize` (0.9B, Apache-2.0) · runner `github.com/mudler/moss-transcribe.cpp` · GGUF `mudler/moss-transcribe.cpp-gguf`
- `nvidia/parakeet-tdt-0.6b-v3` · sherpa export `csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8` · `pip install sherpa-onnx`
- pyannote: `csukuangfj/sherpa-onnx-pyannote-segmentation-3-0` + `csukuangfj/speaker-embedding-models`
- Sortformer: `nvidia/diar_sortformer_4spk-v1` via `nemo_toolkit[asr]` 2.6.1
- Soniox: `stt-async-v3` async REST API (diarization + language-ID)
- Other sub-1B candidates noted: `nvidia/nemotron-3.5-asr-streaming-0.6b`, `Qwen/Qwen3-ASR-0.6B`, `AutoArk-AI/Audio8-ASR-0.1B`, `nvidia/diar_streaming_sortformer_4spk-v2.1`
