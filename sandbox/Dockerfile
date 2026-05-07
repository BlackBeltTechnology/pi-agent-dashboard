FROM node:22-bookworm-slim

# Install system dependencies for pi and headless Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    git \
    python3 \
    make \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

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
COPY sandbox/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
USER pi

ENTRYPOINT ["/entrypoint.sh"]
