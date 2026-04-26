# Vault — Centralized Secrets Server

Self-hosted secrets service for the Sun ecosystem. Reads the master `.env` file and serves secrets over HTTP to all services on the LAN.

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
#    Set VAULT_TOKEN="<contents of vault.key>"

# 5. Start the server
npm run dev
```

## How It Works

```
┌──────────────────────────────────────────────┐
│  Vault Service (Port 5599)                   │
│                                              │
│  📄 Reads master .env at startup             │
│  👁️  Watches for file changes (auto-reload)   │
│  🔑 Bearer token auth via vault.key          │
│  🌐 Serves secrets over HTTP to all services │
└──────────────────────┬───────────────────────┘
                       │
      ┌────────────────┼────────────────┐
      ▼                ▼                ▼
  Workstation     Raspberry Pi     Synology
  (all services)    (Lupos)        (containers)
```

Services use the **vault client** (`shared/vault-client.js`) to fetch secrets at boot time. If Vault is unreachable, they fall back to reading the `.env` file directly.

## API

All endpoints except `/health` require a `Authorization: Bearer <token>` header.

### `GET /health`
Public health check.

### `GET /secrets`
Returns all secrets as a JSON object.

Query params (all optional, combinable):
- `?keys=KEY1,KEY2` — return only these keys
- `?prefix=PRISM_` — return keys starting with this prefix
- `?exclude=VAULT_` — exclude keys matching these prefixes

### `GET /keys`
Returns the list of available key names (no values).

### `POST /reload`
Force-reload the `.env` file without restarting.

## Security

- **Bearer token auth** — every request must include the token from `vault.key`
- **LAN-only** — bind to your local network, not the public internet
- **vault.key is gitignored** — never committed to source control
- **VAULT_TOKEN is stripped** — Vault never exposes its own token in responses

## Client Usage

```js
// In any service's secrets.js:
import { createVaultClient } from "../shared/vault-client.js";

const vault = createVaultClient({ fallbackEnvFile: "../vault/.env" });
const secrets = await vault.fetch();

export const OPENAI_API_KEY = secrets.OPENAI_API_KEY || "";
export const MONGO_URI = secrets.MONGO_URI || "";
```

Each service only needs two environment variables to reach Vault:
- `VAULT_URL` — where Vault is running (default: `http://localhost:5599`)
- `VAULT_TOKEN` — the bearer token from `vault.key`
