FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    git \
    g++ \
    make \
    python3 \
    procps \
    libnss3 \
    libnspr4 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    fonts-liberation \
    fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

RUN npm install --ignore-scripts \
  && npm rebuild node-pty \
  && npm install -g @mariozechner/pi-coding-agent \
  && PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers npx playwright install --with-deps chromium

RUN npm run build

RUN chmod +x qa/worktree-placeholder/test-runner.sh

ENTRYPOINT ["bash", "qa/worktree-placeholder/test-runner.sh"]
