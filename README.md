# Vault — Centralized Secrets Server + Service Registry

Self-hosted secrets service and **service registry** — the single source of truth for all secrets, ports, URLs, and service topology across the Sun ecosystem. Reads the master `.env` file and `services.json` manifest at startup, watches both for live changes, and serves them over HTTP with bearer token authentication.

**Port:** `5599` · **Runtime:** Node.js (ES Modules) · **Framework:** Express 5 · **DB:** None · **Zero runtime dependencies** (Express only)

## Architecture

### Directory Structure

```
vault-service/
├── server.js              # Express app — route handlers, .env parser, file watcher, URL resolver
├── services.json          # Deployment-agnostic service manifest (ports, deps, topology)
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
│  📄 Reads master .env at startup                  │
│  📋 Reads services.json manifest at startup       │
│  👁️  Watches both files for live changes           │
│  🔑 Bearer token auth via vault.key               │
│  🌐 Serves secrets + registry over HTTP           │
└─────────────────────┬─────────────────────────────┘
                      │
     ┌────────────────┼────────────────┐
     ▼                ▼                ▼
  Machine A       Machine B       Machine C
  (services)      (services)      (containers)
```

### Dual Role

1. **Secrets Server** — Parses the master `.env` and serves key-value secrets via `GET /secrets` with filtering by keys, prefix, and exclusion.
2. **Service Registry** — Loads `services.json` and serves it via `GET /registry`. Each service entry is enriched with its resolved URL from the loaded secrets.

### URL Resolution

Service URLs are resolved with the following priority:

1. **Explicit per-service URL override** — e.g. `PRISM_SERVICE_URL` set in `.env`
2. **Auto-constructed** from `DEFAULT_HOST` env var + service port
3. **`localhost` fallback** (dev-only)

## API Endpoints

### Secrets

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | No | Public health check (secret count, service count, uptime) |
| `GET` | `/secrets` | Yes | All secrets as JSON, filterable by `?keys`, `?prefix`, `?exclude` |
| `GET` | `/keys` | Yes | List of secret key names (no values) |
| `POST` | `/reload` | Yes | Force-reload `.env` and `services.json` |

### Registry

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/registry` | Yes | Full manifest — services + infrastructure with resolved URLs |
| `GET` | `/registry/services` | Yes | All services, filterable by `?id`, `?type`, `?deployTier` |
| `GET` | `/registry/services/:id` | Yes | Single service by ID with resolved URL |
| `GET` | `/registry/infrastructure` | Yes | Infrastructure entries (MongoDB, MinIO, etc.) |

## services.json — The Manifest

The manifest is **deployment-agnostic** — no hardcoded IPs, hostnames, or device-specific values. All environment-specific configuration comes from `.env`.

```jsonc
{
  "services": [
    {
      "id": "prism-service",
      "label": "Prism Service",
      "type": "service",
      "port": 7777,
      "healthPath": "/health",
      "db": "prism",
      "deployTier": 2,
      "dependsOn": [...]
    }
  ],
  "infrastructure": [
    {
      "id": "mongodb",
      "label": "MongoDB",
      "type": "database",
      "defaultPort": 27017,
      "urlEnv": "MONGO_URI"
    }
  ]
}
```

### Fork-Friendly

To deploy on your own infrastructure:
1. Clone this repo
2. Edit `services.json` to list your services
3. Create your `.env` with actual URLs and secrets
4. Generate a `vault.key`
5. Your services pull config from the vault at boot

## Client Usage

```js
import { createVaultClient } from "@rodrigo-barraza/utilities/vault";

const vault = createVaultClient({
  localEnvFile: "./.env",
  fallbackEnvFile: "../vault-service/.env",
});

// Fetch secrets
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

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Create your master .env
cp .env.example .env
# Fill in your real values

# 3. Generate a bearer token
npm run generate-key > vault.key

# 4. Set the token in .env
#    VAULT_SERVICE_TOKEN="<contents of vault.key>"

# 5. Start the server
npm run dev
```

## Deploy

```bash
npm run deploy          # Full deploy to Synology NAS
npm run deploy:dry      # Validate without deploying
```
