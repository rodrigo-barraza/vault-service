# Vault — Centralized Secrets + Config Server

Self-hosted secrets and configuration service — the single source of truth for all credentials, non-secret config, ports, URLs, and project topology across the Sun ecosystem. Reads the master `.env` (secrets) and `projects.json` (config + registry) at startup, watches both for live changes, and serves them over HTTP with bearer token authentication.

**Port:** `5599` · **Runtime:** Node.js (ES Modules) · **Framework:** Express 5 · **DB:** None · **Zero runtime dependencies** (Express only)

## Architecture

### Directory Structure

```
vault-service/
├── server.js              # Express app — route handlers, .env parser, file watcher, URL resolver
├── projects.json          # Project registry + non-secret config (ports, deps, topology, flags, IDs)
├── .env                   # Master secrets file (gitignored) — API keys, tokens, passwords only
├── .env.example           # Template for .env — copy and fill in your credentials
├── vault.key              # Bearer token for auth (gitignored)
├── deploy.sh              # Deploy to Synology NAS
├── Dockerfile             # Node 22 Alpine container
├── docker-compose.yml     # Docker Compose config
└── package.json
```

### How It Works

```
┌───────────────────────────────────────────────────┐
│  Vault Service (Port 5599)                        │
│                                                   │
│  🔐 .env — API keys, tokens, passwords           │
│  📋 projects.json — registry + non-secret config  │
│  👁️  Watches both files for live changes           │
│  🔑 Bearer token auth via vault.key               │
│  🌐 Merges & serves all values over HTTP          │
└─────────────────────┬─────────────────────────────┘
                      │
     ┌────────────────┼────────────────┐
     ▼                ▼                ▼
  Machine A       Machine B       Machine C
  (services)      (services)      (containers)
```

### Two Files, One Response

The Vault merges values from both files into a single flat `{ KEY: "value" }` response. **`.env` entries always take precedence** — registry-derived values are fallbacks only.

| File | Contains | Examples |
|---|---|---|
| `.env` | **Secrets** — credentials that must never be public | API keys, tokens, passwords, OAuth secrets, connection strings |
| `projects.json` | **Config** — user-configurable, non-secret settings | Discord IDs, model names, feature flags, provider URLs, workspace paths |

### What Gets Auto-Derived

From `projects.json`, the vault automatically constructs:

| Derived Key | Source | Example |
|---|---|---|
| `{SERVICE}_PORT` | `service.port` | `PRISM_SERVICE_PORT=7777` |
| `{SERVICE}_URL` | `defaultHost + port` | `PRISM_SERVICE_URL=http://192.168.86.2:7777` |
| `{SERVICE}_WS_URL` | `defaultHost + wsPort` | `PRISM_SERVICE_WS_URL=ws://192.168.86.2:7777` |
| `{SERVICE}_MONGO_DB_NAME` | `service.db` | `PRISM_SERVICE_MONGO_DB_NAME=prism` |
| `{SERVICE}_MINIO_BUCKET_NAME` | `service.minioBucket` | `PRISM_SERVICE_MINIO_BUCKET_NAME=prism` |
| Any key in `service.config` | Flattened as-is | `GUILD_ID_PRIMARY=609471635308937237` |
| Any key in `infrastructure[].config` | Flattened as-is | `MINIO_PUBLIC_URL=http://...` |
| Any key in top-level `config` | Flattened as-is | `STICKERS_CLIENT_ID=...` |

### URL Resolution Priority

1. **Explicit override** in `.env` (e.g. `PRISM_SERVICE_URL=...`)
2. **Auto-constructed** from `projects.json` `defaultHost` + service `port`
3. **Localhost fallback** (dev-only, no host configured)

## API Endpoints

### Secrets

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | No | Public health check (secret count, project count, uptime) |
| `GET` | `/secrets` | Yes | All secrets + derived config as JSON, filterable by `?keys`, `?prefix`, `?exclude` |
| `GET` | `/keys` | Yes | List of all available key names (no values) |
| `POST` | `/reload` | Yes | Force-reload `.env` and `projects.json` |

### Registry

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/registry` | Yes | Full manifest — services + infrastructure with resolved URLs |
| `GET` | `/registry/projects` | Yes | All projects, filterable by `?id`, `?type`, `?deployTier` |
| `GET` | `/registry/projects/:id` | Yes | Single project by ID with resolved URL |
| `GET` | `/registry/infrastructure` | Yes | Infrastructure entries (MongoDB, MinIO, etc.) |

All registry endpoints accept `?resolve=false` to return raw manifest data without URL enrichment.

## projects.json — The Manifest

The manifest defines project topology **and** non-secret configuration. The `config` object on each project entry holds values that would traditionally go in `.env` but aren't actually secrets — Discord IDs, feature flags, model names, workspace paths, etc.

```jsonc
{
  "version": 1,
  "defaultHost": "192.168.86.2",

  // Top-level config — for entries not tied to a specific service
  "config": {
    "STICKERS_CLIENT_ID": "...",
    "OPENAI_VISION_MODEL": "gpt-4o"
  },

  "projects": [
    {
      "id": "prism-service",
      "label": "Prism Service",
      "port": 7777,
      "wsPort": 7777,           // ← auto-derives PRISM_SERVICE_WS_URL
      "healthPath": "/health",
      "db": "prism",
      "minioBucket": "prism",
      "deployTier": 1,
      "dependsOn": [...],
      "config": {               // ← non-secret settings, flattened into /secrets response
        "PROVIDER_LM_STUDIO_1_URL": "http://192.168.86.99:1234",
        "PROVIDER_LM_STUDIO_1_CONCURRENCY": "2",
        "PROVIDER_LM_STUDIO_1_NICKNAME": "Desktop"
      }
    }
  ],

  "infrastructure": [
    {
      "id": "minio",
      "label": "MinIO",
      "type": "object-store",
      "defaultPort": 9000,
      "urlEnv": "MINIO_ENDPOINT",
      "config": {               // ← infra config works the same way
        "MINIO_PUBLIC_URL": "https://storage.rod.dev"
      }
    }
  ],

  "devices": [
    { "id": "workstation", "hostname": "192.168.86.99", "type": "Desktop" }
  ],

  "domains": ["rod.dev", "clankerbox.com", "..."]
}
```

### Project Entry Fields

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique identifier, used to derive env var prefix (`prism-service` → `PRISM_SERVICE`) |
| `label` | `string` | Human-readable display name |
| `port` | `number` | HTTP port — used for auto-constructing URLs |
| `wsPort` | `number?` | WebSocket port — auto-derives `{PREFIX}_WS_URL` |
| `healthPath` | `string` | Health check endpoint path |
| `db` | `string?` | MongoDB database name — auto-derives `{PREFIX}_MONGO_DB_NAME` |
| `minioBucket` | `string\|string[]?` | MinIO bucket name(s) — string values auto-derive `{PREFIX}_MINIO_BUCKET_NAME` |
| `visibility` | `string` | `"internal"` or `"external"` |
| `domain` | `string?` | Public domain (external services only) |
| `deployTier` | `number` | Deploy order (0 = first, higher = later) |
| `dependsOn` | `array` | Service dependencies with criticality |
| `config` | `object?` | Non-secret key-value pairs flattened into the `/secrets` response |

## Client Usage

```js
import { createVaultClient } from "@rodrigo-barraza/utilities-library/vault";

const vault = createVaultClient({
  localEnvFile: "./.env",
  fallbackEnvFile: "../vault-service/.env",
});

// Fetch secrets + derived config (merged, flat object)
const secrets = await vault.fetch();

// Fetch the full infrastructure registry
const registry = await vault.fetchRegistry();

// Resolve a single service URL
const prismUrl = await vault.resolveServiceUrl("prism-service");

// Resolve an infrastructure URL
const mongoUri = await vault.resolveInfraUrl("mongodb");
```

Each service only needs two environment variables to reach Vault:
- `VAULT_SERVICE_URL` — where Vault is running (default: `http://localhost:5599`)
- `VAULT_SERVICE_TOKEN` — the bearer token from `vault.key`

## Security

- **Bearer token auth** — every request must include the token from `vault.key`
- **LAN-only** — bind to your local network, not the public internet
- **vault.key is gitignored** — never committed to source control
- **VAULT_SERVICE_TOKEN is stripped** — Vault never exposes its own token in responses
- **.env is gitignored** — secrets never enter version control

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Generate a bearer token
npm run generate-key > vault.key

# 3. Create your master .env (secrets only)
cp .env.example .env
# Fill in your API keys, tokens, passwords, and connection strings.
# Set VAULT_SERVICE_TOKEN to the contents of vault.key.

# 4. Create your projects.json (config + registry)
cp projects.example.json projects.json
# Set "defaultHost" to your server's LAN IP.
# Fill in per-service config blocks (Discord IDs, model names, etc.).
# Update "devices" with your machine hostnames.

# 5. Start the server
npm run dev
```

Both `projects.json` and `.env` are **gitignored** — only the `.example` templates are committed. This means each deployment gets its own config without risk of leaking values upstream.

### What Goes Where

| Put it in... | When it is... | Examples |
|---|---|---|
| `.env` | A credential, key, token, or password | `OPENAI_API_KEY`, `MONGO_URI`, `LUPOS_TOKEN` |
| `projects.json` → `config` | A non-secret setting anyone can see | `GUILD_ID_PRIMARY`, `LANGUAGE_MODEL_TYPE`, `DST_ENABLED` |
| `projects.json` → project entry | A structural property of the project | `port`, `db`, `minioBucket`, `dependsOn` |

### Overriding Config with .env

Any key in `projects.json` `config` can be overridden by setting the same key in `.env`. The `.env` value always wins. This lets you use `projects.json` as defaults while allowing per-deployment overrides.

## Adding a New Project

Every service in the ecosystem follows the same pattern. Here's the full checklist:

### 1. Register in `projects.json`

Add an entry to the `projects` array:

```jsonc
{
  "id": "my-service",              // Used to derive env var prefix: MY_SERVICE
  "label": "My Service",
  "port": 5610,                    // Pick an unused port
  "healthPath": "/health",
  "description": "What this service does",
  "db": "myservice",               // MongoDB database name (null if no DB)
  "minioBucket": "my-media",       // MinIO bucket (null if no object storage)
  "visibility": "internal",        // "internal" (LAN only) or "external" (has a domain)
  "domain": "",                    // Public domain (external services only)
  "repo": "",
  "dockerProject": "my-service",   // Docker image/container name
  "deployTier": 1,                 // 0 = vault, 1 = backend services, 2 = clients/bots
  "dependsOn": [
    { "id": "mongodb", "criticality": "required" },
    { "id": "vault-service", "criticality": "required" }
  ],
  "config": {                      // Non-secret config (optional)
    "MY_CUSTOM_FLAG": "true"
  }
}
```

This auto-derives: `MY_SERVICE_PORT=5610`, `MY_SERVICE_URL=http://{defaultHost}:5610`, `MY_SERVICE_MONGO_DB_NAME=myservice`, `MY_SERVICE_MINIO_BUCKET_NAME=my-media`.

### 2. Create `boot.js` — Vault Client Bootstrap

Every service uses `boot.js` as its entry point. It fetches secrets from Vault, hydrates `process.env`, then imports the actual server:

```js
import { createVaultClient } from "@rodrigo-barraza/utilities-library/vault";

const vault = createVaultClient({
  localEnvFile: "./.env",
  fallbackEnvFile: "../vault-service/.env",
});

const secrets = await vault.fetch();

for (const [key, value] of Object.entries(secrets)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}

await import("./server.js");
```

### 3. Create `config.js` — Typed Accessor

A clean accessor over `process.env`. No defaults, no secrets — Vault is the single source of truth:

```js
const CONFIG = {
  MY_SERVICE_PORT: process.env.MY_SERVICE_PORT,
  MONGODB_URI: process.env.MONGO_URI,
  MY_CUSTOM_FLAG: process.env.MY_CUSTOM_FLAG,
};

export default CONFIG;
```

### 4. Create `Dockerfile`

#### Service (Express)

```dockerfile
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN apk add --no-cache git && npm ci --omit=dev

COPY . .

RUN addgroup --system --gid 1001 myservice && \
    adduser --system --uid 1001 myservice
USER myservice

EXPOSE 5610

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 -O /dev/null http://127.0.0.1:5610/health || exit 1

CMD ["node", "boot.js"]
```

#### Client (Next.js)

```dockerfile
FROM node:22-alpine AS base

# --- Dependencies ---
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN apk add --no-cache git && npm ci

# --- Build ---
FROM base AS builder
WORKDIR /app

ARG VAULT_SERVICE_URL
ENV VAULT_SERVICE_URL=${VAULT_SERVICE_URL}

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN --mount=type=secret,id=VAULT_SERVICE_TOKEN \
  export VAULT_SERVICE_TOKEN=$(cat /run/secrets/VAULT_SERVICE_TOKEN 2>/dev/null) && \
  npx next build --webpack

# --- Production ---
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3005
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3005

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 -O /dev/null http://127.0.0.1:3005/ || exit 1

CMD ["node", "server.js"]
```

### 5. Create `docker-compose.yml`

```yaml
services:
  my-service:
    image: my-service:latest
    container_name: my-service
    restart: unless-stopped
    ports:
      - "5610:5610"
    env_file:
      - .env
    environment:
      - TZ=America/Los_Angeles
    volumes:
      - /usr/share/zoneinfo/America/Los_Angeles:/etc/localtime:ro
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "-O", "/dev/null", "http://localhost:5610/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
    deploy:
      resources:
        limits:
          memory: 256M
```

### 6. Create `deploy.sh`

All deploy logic lives in `deploy-kit/lib.sh` — each service just sources it:

```bash
#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE_NAME="my-service"
DISPLAY_NAME="🚀 My Service"

source "${SCRIPT_DIR}/../deploy-kit/lib.sh"
```

### 7. Add Secrets (if any)

If your service needs new API keys or credentials, add them to:
- `.env` — your real values
- `.env.example` — empty placeholders for other deployments

## Deploy

```bash
npm run deploy          # Full deploy to Synology NAS
npm run deploy:dry      # Validate without deploying
```
