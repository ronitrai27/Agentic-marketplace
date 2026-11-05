# ==============================================================================
# Multi-Stage Dockerfile for SeoAgent (Optimized for Northflank & Cloud Deployments)
# Stage 1: Build & Compile TypeScript
# Stage 2: Minimal Production Runtime
# ==============================================================================

# ──────────────────────────────────────────────────────────────────────────────
# STAGE 1: Builder
# ──────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install pnpm directly via npm
RUN npm install -g pnpm@10

# Copy package manifests first for optimal Docker layer caching
COPY package.json pnpm-lock.yaml ./

# Install dependencies (use --no-frozen-lockfile to prevent lockfile mismatch errors)
RUN pnpm install --no-frozen-lockfile

# Copy source code and configuration
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript to dist/
RUN pnpm build

# Copy static assets (HTML/CSS) to dist/public using Docker native COPY
COPY src/public ./dist/public

# ──────────────────────────────────────────────────────────────────────────────
# STAGE 2: Production Runner
# ──────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner

WORKDIR /app

# Set production environment flags
ENV NODE_ENV=production
ENV PORT=3000

# Install ca-certificates (required for Temporal Cloud TLS gRPC handshake)
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Copy pre-installed node_modules from builder (no network install needed, 100% reliable)
COPY --from=builder /app/node_modules ./node_modules

# Copy compiled JavaScript dist/ and package.json from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# Expose port (Northflank maps this or passes dynamic $PORT)
EXPOSE 3000

# Northflank & Docker Healthcheck probe using Catelog /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start the unified Catelog MAPS server + embedded Temporal Worker
CMD ["node", "dist/server.js"]
