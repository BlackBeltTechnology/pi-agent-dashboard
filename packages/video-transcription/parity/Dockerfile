# Docker-based parity harness for the video-transcription package (task 10.2).
# Clean environment with ffmpeg + tsx; runs parity/parity-check.ts.
# Build context = the package dir (packages/video-transcription).
FROM node:22-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN npm install -g tsx@4

# Install the runtime dependency (@blackbelt-technology/pi-dashboard-shared, the
# safe-subprocess wrapper imported by src/ffmpeg.ts). Copy the manifest first for
# layer caching; --omit=dev skips vitest and other dev-only packages.
COPY package.json ./package.json
RUN npm install --omit=dev
COPY src ./src
COPY parity ./parity

# Offline tier always runs; live tier activates when SONIOX_API_KEY + PARITY_SAMPLE
# are provided at `docker run` time (mount the sample into the container).
ENTRYPOINT ["tsx", "parity/parity-check.ts"]
