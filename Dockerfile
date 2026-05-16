# ============================================================
# Vault — Multi-stage Dockerfile
# ============================================================
# Minimal secrets server — serves API keys and service
# registry over HTTP. Uses token-based authentication.
# ============================================================

# ── Stage 1: Install dependencies + build TypeScript ──────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN apk add --no-cache git openssh-client
RUN mkdir -p -m 0700 ~/.ssh && ssh-keyscan github.com >> ~/.ssh/known_hosts
RUN --mount=type=ssh npm ci
RUN npx tsc

# ── Stage 2: Production dependencies ─────────────────────────
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN apk add --no-cache git openssh-client
RUN mkdir -p -m 0700 ~/.ssh && ssh-keyscan github.com >> ~/.ssh/known_hosts
RUN --mount=type=ssh npm ci --omit=dev

# ── Stage 3: Runtime ─────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

# Copy pre-built artifacts
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=deps /app/dist ./dist

# Copy non-source files needed at runtime
COPY package.json ./
COPY projects.example.json ./projects.example.json

# Non-root user for security
RUN addgroup --system --gid 1001 vault && \
    adduser --system --uid 1001 vault
USER vault

EXPOSE 5599

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 -O /dev/null http://127.0.0.1:5599/health || exit 1

CMD ["node", "dist/server.js"]
