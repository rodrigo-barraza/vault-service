# Vault — Centralized Secrets Server + Service Registry

Self-hosted secrets service and **service registry**. Reads the master `.env` file and `services.json` manifest, then serves both over HTTP to all services on the LAN. The single source of truth for secrets, ports, URLs, and service topology.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Create your master .env from the template
cp .env.example .env
# Fill in your real values.

# 3. Generate a bearer token
npm run generate-key > vault.key

# 4. Copy the token into .env
#    Set VAULT_SERVICE_TOKEN="<contents of vault.key>"

# 5. Start the server
npm run dev
```

## How It Works

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

Services use the **vault client** (`@rodrigo-barraza/utilities/vault`) to fetch secrets and service config at boot time. If Vault is unreachable, they fall back to reading the `.env` file directly.

## API

All endpoints except `/health` require a `Authorization: Bearer <token>` header.

### Secrets

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Public health check (no auth) |
| `GET` | `/secrets` | Returns all secrets as a JSON object |
| `GET` | `/keys` | Returns the list of key names (no values) |
| `POST` | `/reload` | Force-reload `.env` and `services.json` |

**`GET /secrets` query params** (all optional, combinable):
- `?keys=KEY1,KEY2` — return only these keys
- `?prefix=PRISM_` — return keys starting with this prefix
- `?exclude=VAULT_` — exclude keys matching these prefixes

### Registry

| Method | Path | Description |
|---|---|---|
| `GET` | `/registry` | Full manifest — services + infrastructure with resolved URLs |
| `GET` | `/registry/services` | All services, optionally filtered |
| `GET` | `/registry/services/:id` | Single service by ID |
| `GET` | `/registry/infrastructure` | Infrastructure entries (MongoDB, MinIO, etc.) |

**`GET /registry/services` query params** (all optional):
- `?id=prism-service` — filter by service ID
- `?type=client` — filter by type (`service`, `client`, `gateway`, `bot`, `infra`)
- `?deployTier=1` — filter by deploy tier
- `?resolve=false` — skip URL enrichment, return raw manifest

### URL Resolution

Registry endpoints automatically **enrich** each service with its resolved URL by looking up the service's `urlEnv` key (e.g., `PRISM_SERVICE_URL`) in the loaded secrets. If no URL is configured, it falls back to `http://localhost:{port}`.

```json
// GET /registry/services/prism-service
{
  "id": "prism-service",
  "label": "Prism",
  "type": "gateway",
  "port": 7777,
  "url": "http://192.168.86.2:7777",
  "healthPath": "/health",
  "description": "AI Gateway — multi-provider routing, agentic loop, memory, coordination",
  "dependsOn": [
    { "id": "mongodb", "criticality": "required" },
    { "id": "vault-service", "criticality": "required" }
  ]
}
```

## services.json — The Manifest

The `services.json` file defines the structural skeleton of your infrastructure. It is **deployment-agnostic** — it contains no hardcoded IPs, hostnames, or device-specific values. All environment-specific configuration (URLs, credentials) comes from the `.env` file.

```jsonc
{
  "version": 1,
  "services": [
    {
      "id": "prism-service",     // Canonical ID
      "label": "Prism",          // Human-readable name
      "type": "gateway",         // service | client | gateway | bot | infra
      "port": 7777,              // Default port
      "portEnv": "PRISM_SERVICE_PORT",   // Env var for port override
      "urlEnv": "PRISM_SERVICE_URL",     // Env var for URL override
      "healthPath": "/health",   // Health check endpoint path
      "db": "prism",             // MongoDB database name (null if none)
      "repo": "prism-service",   // Repository name
      "deployTier": 2,           // Boot order (0 = infra, 1 = services, 2 = gateways, 3 = clients)
      "dependsOn": [...]         // Service/infra dependencies with criticality
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

To set up the vault for your own project:

1. Clone this repo
2. Edit `services.json` to list your services
3. Create your `.env` with the actual URLs and secrets
4. Generate a `vault.key`
5. Your services pull config from the vault at boot

No code changes needed — the manifest is data, not code.

## Client Usage

```js
import { createVaultClient } from "@rodrigo-barraza/utilities/vault";

const vault = createVaultClient({
  localEnvFile: "./.env",
  fallbackEnvFile: "../vault-service/.env",
});

// Fetch secrets (existing behavior)
const secrets = await vault.fetch();

// Fetch the full infrastructure registry
const registry = await vault.fetchRegistry();
// registry.services        → [{id, label, port, url, ...}, ...]
// registry.infrastructure  → [{id, label, type, url, ...}, ...]

// Resolve a single service URL (with fallback chain)
const prismUrl = await vault.resolveServiceUrl("prism-service");
// → "http://192.168.86.2:7777" (or localhost fallback)

const mongoUri = await vault.resolveInfraUrl("mongodb");
// → "mongodb://user:pass@host:27017/..."
```

Each service only needs two environment variables to reach Vault:
- `VAULT_SERVICE_URL` — where Vault is running (default: `http://localhost:5599`)
- `VAULT_SERVICE_TOKEN` — the bearer token from `vault.key`

## Security

- **Bearer token auth** — every request must include the token from `vault.key`
- **LAN-only** — bind to your local network, not the public internet
- **vault.key is gitignored** — never committed to source control
- **VAULT_SERVICE_TOKEN is stripped** — Vault never exposes its own token in responses
