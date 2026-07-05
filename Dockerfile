# ============================================================
# Vault — Multi-stage Dockerfile
# ============================================================
# Minimal secrets server — serves API keys and service
# registry over HTTP. Uses token-based authentication.
# ============================================================

# ── Stage 1: Install dependencies + build TypeScript ──────────
FROM node:26-alpine AS deps
WORKDIR /app
RUN npm install -g pnpm@11.8.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY src ./src
RUN apk add --no-cache git
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm exec tsc

# ── Stage 2: Production dependencies ─────────────────────────
FROM node:26-alpine AS prod-deps
WORKDIR /app
RUN npm install -g pnpm@11.8.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN apk add --no-cache git
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod

# ── Stage 3: Runtime ─────────────────────────────────────────
FROM node:26-alpine
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
