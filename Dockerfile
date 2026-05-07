# ============================================================
# Vault — Multi-stage Dockerfile
# ============================================================
# Minimal secrets server — serves API keys and service
# registry over HTTP. Uses token-based authentication.
# ============================================================

# ── Stage 1: Install dependencies ─────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN apk add --no-cache git && \
    git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" && \
    npm ci --omit=dev

# ── Stage 2: Runtime ──────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

# Copy pre-built node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY . .

# Non-root user for security
RUN addgroup --system --gid 1001 vault && \
    adduser --system --uid 1001 vault
USER vault

EXPOSE 5599

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 -O /dev/null http://127.0.0.1:5599/health || exit 1

CMD ["node", "server.js"]
