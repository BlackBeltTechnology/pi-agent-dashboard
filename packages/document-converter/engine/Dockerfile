# pi-doc-engine — self-contained Python document engine.
#
# Quarantines the vendored Python engine behind a Docker boundary. The TS facade
# is the only caller; it pipes one JSON request to engine_cli.py over stdin and
# reads one JSON response from stdout.
#
# Build context MUST be this `engine/` directory. The image references NO
# home-directory (~/Documents) path — everything is copied from the build context.
#
#   docker build -t pi-doc-engine:<tag> packages/document-converter/engine
#
# Bundles: docling (+ EasyOCR/Tesseract/RapidOCR), python-docx/pptx, openpyxl,
# pandoc, LibreOffice (PDF), @mermaid-js/mermaid-cli (mmdc) + an arch-selected
# headless browser (chrome-headless-shell on amd64, distro chromium on arm64),
# @the-focus-ai/nano-banana, frontmatter_filler, markdown_table_profiler.

FROM python:3.12-slim-trixie AS base

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    # mmdc/puppeteer use the browser provisioned below; never host Chrome.
    PUPPETEER_EXECUTABLE_PATH=/opt/chrome-headless-shell/chrome-headless-shell \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1

# --- System tooling: pandoc, LibreOffice, Tesseract, fonts, Node, headless deps ---
RUN apt-get update && apt-get install -y --no-install-recommends \
      pandoc \
      libreoffice-writer \
      tesseract-ocr tesseract-ocr-eng tesseract-ocr-hun tesseract-ocr-deu \
      fonts-dejavu fonts-liberation fonts-noto-core \
      curl ca-certificates gnupg unzip \
      libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
      libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
      libgl1 libglib2.0-0 \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# --- Node CLIs + arch-selected headless browser ---
# amd64: pinned chrome-headless-shell (Chrome for Testing publishes no linux-arm64
# build, so an unconditional install runs under qemu on arm64 and cannot exec).
# arm64: distro chromium, symlinked to the path PUPPETEER_EXECUTABLE_PATH expects.
RUN set -eu; \
    case "$(dpkg --print-architecture)" in \
      amd64) \
        npx --yes @puppeteer/browsers install chrome-headless-shell@155.0.8059.84 \
          --path /opt/chrome-headless-shell-dl; \
        ln -s "$(find /opt/chrome-headless-shell-dl -name chrome-headless-shell -type f | head -1 | xargs dirname)" \
          /opt/chrome-headless-shell ;; \
      arm64) \
        apt-get update; \
        apt-get install -y --no-install-recommends chromium; \
        rm -rf /var/lib/apt/lists/*; \
        [ -x /usr/bin/chromium ] || { echo "chromium not executable at /usr/bin/chromium" >&2; exit 1; }; \
        mkdir -p /opt/chrome-headless-shell; \
        ln -s /usr/bin/chromium /opt/chrome-headless-shell/chrome-headless-shell ;; \
      *) \
        echo "unsupported build architecture: $(dpkg --print-architecture)" >&2; exit 1 ;; \
    esac; \
    npm install -g @mermaid-js/mermaid-cli@11.17.0 @the-focus-ai/nano-banana

# --- Python engine deps (docling pulls OCR/ML model libs) ---
# CPU-only torch FIRST: the default torch wheel bundles ~3.4GB of CUDA/triton
# GPU libs that are dead weight in this CPU-only container. Installing the CPU
# build up front satisfies docling/easyocr's torch dep without the nvidia stack.
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch torchvision \
 && pip install \
      "docling" \
      "python-docx>=1.0.0" "python-pptx>=0.6.23" "openpyxl>=3.1" \
      "pypandoc>=1.11" "Pillow>=10.0.0" \
      "ruamel.yaml>=0.18" "PyYAML>=6.0" \
      "easyocr" "rapidocr-onnxruntime"

# --- mmdc shim: force --no-sandbox + baked chrome (container runs as root) ---
# Vendored mermaid_renderer.py calls bare `mmdc` with only `-c`; it never passes
# a puppeteer config, so Chrome refuses to launch as root. A shim earlier in PATH
# (/usr/local/bin precedes /usr/bin) injects `-p` without editing vendored code.
RUN printf '{"executablePath":"%s","args":["--no-sandbox","--disable-gpu","--disable-dev-shm-usage"]}\n' \
      "$PUPPETEER_EXECUTABLE_PATH" > /opt/puppeteer.json \
    && printf '#!/bin/sh\n[ -z "$PI_DOC_MMDC_MARKER" ] || : > "$PI_DOC_MMDC_MARKER"\nexec node /usr/lib/node_modules/@mermaid-js/mermaid-cli/src/cli.js -p /opt/puppeteer.json "$@"\n' \
      > /usr/local/bin/mmdc \
    && chmod +x /usr/local/bin/mmdc

# --- Vendored engine (the ONLY app source; no home-dir path) ---
WORKDIR /engine
COPY . /engine/

# Build-time smoke: render a two-node diagram through the engine's own default
# path (SVG -b transparent + PNG -b transparent -w 1200 -s 2) and through the
# fallback argv (-b white -w 1400 -s 2). Fails the build if the browser cannot
# launch on this architecture, instead of failing at a user's produce call.
RUN python -c "from pathlib import Path; from document_converter.mermaid_renderer import render_diagram; d='graph TD; A-->B'; p=Path('/tmp/smoke.png'); render_diagram(d, p, extract_dimensions=True, format='png'); assert p.exists()" \
    && printf 'graph TD; A-->B\n' > /tmp/smoke.mmd \
    && mmdc -i /tmp/smoke.mmd -o /tmp/smoke2.png -b white -w 1400 -s 2 \
    && test -s /tmp/smoke2.png \
    && rm -f /tmp/smoke*

# Pre-warm docling model artifacts so first run does not download at runtime.
# (Best-effort: skip silently if offline at build time.)
RUN python -c "from docling.utils.model_downloader import download_models; download_models()" || true

ENV PYTHONPATH=/engine

# JSON-over-stdin/stdout contract. `docker run -i pi-doc-engine < req.json`.
ENTRYPOINT ["python", "/engine/engine_cli.py"]
