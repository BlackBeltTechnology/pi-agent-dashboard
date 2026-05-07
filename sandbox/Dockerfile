FROM node:22-bookworm-slim

# Install system dependencies for pi, headless Chromium, and screenshot tooling
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    git \
    python3 \
    make \
    gcc \
    g++ \
    chromium \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Install agent-browser globally for screenshot capture
RUN npm install -g @mariozechner/agent-browser

ENV CHROME_BIN=/usr/bin/chromium \
    AGENT_BROWSER_CDP_URL=http://localhost:9222

# Install pi and openspec globally
RUN npm install -g @mariozechner/pi @fission-ai/openspec

# Create non-root user for pi and set up directory structure
RUN useradd -m -s /bin/bash pi && \
    mkdir -p /home/pi/.pi/dashboard && \
    mkdir -p /home/pi/.pi/agent/sessions && \
    chown -R pi:pi /home/pi/.pi

# Install dashboard dependencies (for dev mode)
WORKDIR /app
COPY package.json package-lock.json ./
# Copy postinstall script so npm ci can run it
COPY packages/server/scripts/fix-pty-permissions.cjs ./packages/server/scripts/fix-pty-permissions.cjs
RUN npm ci

# Dashboard source (read-only, for pi-dashboard --dev)
COPY . /app

# Expose dashboard port
EXPOSE 8000

# Use entrypoint script
COPY --chmod=755 sandbox/entrypoint.sh /entrypoint.sh
USER pi

ENTRYPOINT ["/entrypoint.sh"]
