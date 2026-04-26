# ============================================================
# Vault — Dockerfile
# ============================================================
# Minimal Node.js image for serving secrets over HTTP.
# No build step — just copies server.js and runs it.
# ============================================================

FROM node:22-alpine

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy application
COPY server.js ./

# Non-root user for security
RUN addgroup --system --gid 1001 vault && \
    adduser --system --uid 1001 vault
USER vault

EXPOSE 5599

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 -O /dev/null http://127.0.0.1:5599/health || exit 1

CMD ["node", "server.js"]
