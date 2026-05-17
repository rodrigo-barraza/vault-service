# Vault Service

Self-hosted secrets and configuration server — the single source of truth for all credentials, non-secret config, ports, URLs, and project topology. Reads `.env` (secrets) and `projects.json` (config + registry) at startup, watches both for live changes, and serves them over HTTP with bearer token authentication.

**Port:** `5599` · **Runtime:** Node.js (TypeScript) · **Framework:** Express 5 · **Zero runtime dependencies** (Express only)

## Quick Start

```bash
npm install

# 1. Generate a bearer token
npm run generate-key > vault.key

# 2. Create master .env (secrets only)
cp .env.example .env
# Fill in API keys, tokens, passwords. Set VAULT_SERVICE_TOKEN to contents of vault.key.

# 3. Create project registry (config + topology)
cp projects.example.json projects.json
# Set "defaultHost" to your server's LAN IP.

# 4. Start
npm run dev
```

Both `projects.json` and `.env` are **gitignored** — only `.example` templates are committed.

## How It Works

The Vault merges values from both files into a single flat `{ KEY: "value" }` response. **`.env` entries always take precedence** — registry-derived values are fallbacks only.

| File | Contains | Examples |
|---|---|---|
| `.env` | **Secrets** — credentials that must never be public | API keys, tokens, passwords, OAuth secrets |
| `projects.json` | **Config** — non-secret settings | Discord IDs, model names, feature flags, provider URLs |

### Auto-Derived Keys

From `projects.json`, the vault automatically constructs:

| Derived Key | Source | Example |
|---|---|---|
| `{SERVICE}_PORT` | `service.port` | `PRISM_SERVICE_PORT=7777` |
| `{SERVICE}_URL` | `defaultHost + port` | `PRISM_SERVICE_URL=http://192.168.86.2:7777` |
| `{SERVICE}_WS_URL` | `defaultHost + wsPort` | `PRISM_SERVICE_WS_URL=ws://192.168.86.2:7777` |
| `{SERVICE}_MONGO_DB_NAME` | `service.db` | `PRISM_SERVICE_MONGO_DB_NAME=prism` |
| `{SERVICE}_MINIO_BUCKET_NAME` | `service.minioBucket` | `PRISM_SERVICE_MINIO_BUCKET_NAME=prism` |
| Any key in `config` | Flattened as-is | `GUILD_ID_PRIMARY=609471635308937237` |

URL resolution priority: explicit `.env` override → auto-constructed from `projects.json` → localhost fallback.

## API Endpoints

### Secrets

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | No | Public health check |
| `GET` | `/secrets` | Yes | All secrets + derived config (`?keys`, `?prefix`, `?exclude`) |
| `GET` | `/keys` | Yes | List all key names (no values) |
| `POST` | `/reload` | Yes | Force-reload both files |

### Registry

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/registry` | Yes | Full manifest — services + infrastructure with resolved URLs |
| `GET` | `/registry/projects` | Yes | Projects (`?id`, `?type`, `?deployTier`) |
| `GET` | `/registry/projects/:id` | Yes | Single project with resolved URL |
| `GET` | `/registry/infrastructure` | Yes | Infrastructure entries (MongoDB, MinIO, etc.) |

All registry endpoints accept `?resolve=false` for raw manifest data.

## Client Usage

```ts
import { createVaultClient } from "@rodrigo-barraza/utilities-library/vault";

const vault = createVaultClient({
  localEnvFile: "./.env",
  fallbackEnvFile: "../vault-service/.env",
});

const secrets = await vault.fetch();
const registry = await vault.fetchRegistry();
const prismUrl = await vault.resolveServiceUrl("prism-service");
```

Each service only needs `VAULT_SERVICE_URL` and `VAULT_SERVICE_TOKEN` to reach Vault.

## Security

- **Bearer token auth** — every request requires token from `vault.key`
- **LAN-only** — bind to local network, not public internet
- **vault.key, .env** — both gitignored, never committed
- **VAULT_SERVICE_TOKEN stripped** — never exposed in responses

## Adding a New Project

### 1. Register in `projects.json`

```tsonc
{
  "id": "my-service",
  "label": "My Service",
  "port": 5610,
  "healthPath": "/health",
  "db": "myservice",
  "minioBucket": "my-media",
  "visibility": "internal",
  "deployTier": 1,
  "dependsOn": [
    { "id": "mongodb", "criticality": "required" },
    { "id": "vault-service", "criticality": "required" }
  ],
  "config": { "MY_CUSTOM_FLAG": "true" }
}
```

This auto-derives: `MY_SERVICE_PORT`, `MY_SERVICE_URL`, `MY_SERVICE_MONGO_DB_NAME`, `MY_SERVICE_MINIO_BUCKET_NAME`.

### 2. Create `boot.ts`

Every service uses `boot.ts` as entry point — fetches secrets from Vault, hydrates `process.env`, then imports the server:

```ts
import { createVaultClient } from "@rodrigo-barraza/utilities-library/vault";

const vault = createVaultClient({ localEnvFile: "./.env", fallbackEnvFile: "../vault-service/.env" });
const secrets = await vault.fetch();
for (const [key, value] of Object.entries(secrets)) {
  if (process.env[key] === undefined) process.env[key] = value;
}
await import("./server.js"); // Compiled JS file from server.ts
```

### 3. Create `config.ts`

Clean accessor over `process.env` — no defaults, Vault is the source of truth.

### 4. Create `deploy.sh`

```bash
#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE_NAME="my-service"
DISPLAY_NAME="🚀 My Service"
source "${SCRIPT_DIR}/../deploy-kit/lib.sh"
```

### 5. Add Secrets

Add credentials to `.env` and empty placeholders to `.env.example`.

## Scripts

```bash
npm start              # Start server
npm run dev            # Start with auto-reload (nodemon)
npm run lint           # Run ESLint
npm run lint:fix       # Auto-fix lint issues
npm run format         # Format with Prettier
npm run format:check   # Check formatting
npm test               # Run tests (Vitest)
npm run test:watch     # Run tests in watch mode
npm run deploy         # Deploy to production
npm run deploy:dry     # Validate deployment without deploying
npm run generate-key   # Generate a random API key
```

