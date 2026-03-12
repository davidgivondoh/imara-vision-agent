# ── Stage 1: Build ──────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src/ src/

RUN npx tsc --outDir dist

# ── Stage 2: Production ────────────────────────────────────────
FROM node:20-slim AS production

WORKDIR /app

# Install only production dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy compiled output
COPY --from=builder /app/dist dist/

# Create non-root user
RUN groupadd --gid 1001 neura && \
    useradd --uid 1001 --gid neura --create-home neura && \
    mkdir -p /app/data && \
    chown -R neura:neura /app

USER neura

# Runtime configuration
ENV NODE_ENV=production
ENV NEURA_ENGINE_PORT=4100
ENV NEURA_ENGINE_HOST=0.0.0.0
ENV NEURA_LOG_LEVEL=info
ENV NEURA_DATA_DIR=/app/data

EXPOSE 4100

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://localhost:4100/api/agent/live').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/engine/server.js"]
