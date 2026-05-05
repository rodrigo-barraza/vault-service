// ============================================================
// Vault — Centralized Secrets Server + Service Registry
// ============================================================
// Reads the master .env file and serves secrets over HTTP.
// Also serves the infrastructure manifest (services.json) as
// a service registry — the single source of truth for ports,
// URLs, dependencies, and topology.
//
// Auth: Bearer token from vault.key file.
// Fallback: Services can read the .env file directly if Vault
//           is unreachable.
//
// Usage:
//   npm run dev          (hot reload via --watch)
//   npm start            (production)
//   npm run generate-key (create a new vault.key)
// ============================================================

import express from "express";
import { readFileSync, watchFile, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Configuration ──────────────────────────────────────────────
// Container mount: ./env/.env + ./env/vault.key  (Docker)
// Local:           ./.env     + ./vault.key      (development)
const ENV_FILE_PATH = existsSync(resolve(__dirname, "env/.env"))
  ? resolve(__dirname, "env/.env")
  : resolve(__dirname, ".env");

const KEY_FILE_PATH = existsSync(resolve(__dirname, "env/vault.key"))
  ? resolve(__dirname, "env/vault.key")
  : resolve(__dirname, "vault.key");

const SERVICES_FILE_PATH = resolve(__dirname, "services.json");

const PORT = parseInt(process.env.VAULT_SERVICE_PORT || "5599", 10);
const RELOAD_INTERVAL_MS = 5_000;

// ── Load Bearer Token ──────────────────────────────────────────
let BEARER_TOKEN = "";

function loadBearerToken() {
  if (existsSync(KEY_FILE_PATH)) {
    BEARER_TOKEN = readFileSync(KEY_FILE_PATH, "utf-8").trim();
  }

  if (!BEARER_TOKEN) {
    console.error("╔══════════════════════════════════════════════════════════╗");
    console.error("║  ❌  vault.key not found or empty.                      ║");
    console.error("║                                                          ║");
    console.error("║  Generate one with:                                      ║");
    console.error("║    npm run generate-key > vault.key                      ║");
    console.error("║                                                          ║");
    console.error("║  The vault.key file is gitignored.                       ║");
    console.error("╚══════════════════════════════════════════════════════════╝");
    process.exit(1);
  }
}

loadBearerToken();

// ── Parse .env ─────────────────────────────────────────────────
let secrets = {};
let lastLoadedAt = null;

/**
 * Parse a .env file into a key-value object.
 * Supports quoted values, comments, blank lines, and inline comments.
 */
function parseEnvFile(content) {
  const parsed = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }

  return parsed;
}

function loadSecrets() {
  try {
    const content = readFileSync(ENV_FILE_PATH, "utf-8");
    const parsed = parseEnvFile(content);

    // Never expose the vault's own bearer token
    delete parsed.VAULT_SERVICE_TOKEN;

    secrets = parsed;
    lastLoadedAt = new Date().toISOString();

    console.log(`✅ Loaded ${Object.keys(secrets).length} secrets from .env`);
  } catch (err) {
    console.error(`❌ Failed to load .env: ${err.message}`);
  }
}

loadSecrets();

// Watch for file changes and auto-reload
watchFile(ENV_FILE_PATH, { interval: RELOAD_INTERVAL_MS }, () => {
  console.log("🔄 .env changed — reloading secrets");
  loadSecrets();
});

// ── Load Service Registry ──────────────────────────────────────
let registry = { version: 0, services: [], infrastructure: [], devices: [] };
let registryLoadedAt = null;

function loadRegistry() {
  try {
    const content = readFileSync(SERVICES_FILE_PATH, "utf-8");
    registry = JSON.parse(content);
    registryLoadedAt = new Date().toISOString();
    console.log(`📋 Loaded registry — ${registry.services?.length || 0} services, ${registry.infrastructure?.length || 0} infrastructure, ${registry.devices?.length || 0} devices`);
  } catch (err) {
    console.error(`❌ Failed to load services.json: ${err.message}`);
  }
}

loadRegistry();

// Watch for manifest changes and auto-reload
watchFile(SERVICES_FILE_PATH, { interval: RELOAD_INTERVAL_MS }, () => {
  console.log("🔄 services.json changed — reloading registry");
  loadRegistry();
});

/**
 * Resolve the effective host for auto-constructing service URLs.
 * Priority: services.json defaultHost → DEFAULT_HOST env var → localhost.
 */
function resolveDefaultHost() {
  return registry.defaultHost || process.env.DEFAULT_HOST || "localhost";
}

/**
 * Derive the env var prefix from a service ID.
 * E.g. "prism-service" → "PRISM_SERVICE", "lupos-bot" → "LUPOS_BOT"
 */
function envPrefix(id) {
  return id.toUpperCase().replace(/-/g, "_");
}

/**
 * Enrich a service entry with its resolved URL from the secrets store.
 *
 * Resolution order:
 *   1. Explicit per-service URL override (e.g. PRISM_SERVICE_URL in .env)
 *   2. Auto-constructed from resolved host + service port
 *   3. Localhost fallback (dev-only, no host configured)
 */
function enrichService(service) {
  const enriched = { ...service };
  const urlEnv = `${envPrefix(service.id)}_URL`;

  if (secrets[urlEnv]) {
    enriched.url = secrets[urlEnv];
  } else if (service.port) {
    enriched.url = `http://${resolveDefaultHost()}:${service.port}`;
  }

  return enriched;
}

/**
 * Enrich an infrastructure entry with its display URL.
 * Uses the same resolveDefaultHost() + port pattern as services.
 * The urlEnv field exists for services that need the actual connection
 * string — it is NOT used here to avoid leaking credentials into the
 * registry response.
 */
function enrichInfrastructure(infra) {
  const enriched = { ...infra };

  if (infra.defaultPort) {
    enriched.url = `http://${resolveDefaultHost()}:${infra.defaultPort}`;
  }

  return enriched;
}

/**
 * Derive env-var-shaped key-value pairs from the services.json registry.
 *
 * All env var names are derived from the service ID using the convention:
 *   {ID_UPPERCASED}_PORT, {ID_UPPERCASED}_URL, {ID_UPPERCASED}_MONGO_DB_NAME, etc.
 *
 * This lets services receive ports, auto-constructed URLs, and database/bucket
 * names via the normal /secrets → boot.js → process.env pipeline, even when
 * those values are not explicitly set in the master .env file.
 *
 * These are returned as a flat object to be merged as fallbacks (never
 * overwriting explicit .env entries).
 */
function deriveRegistrySecrets() {
  const derived = {};
  const host = resolveDefaultHost();

  for (const service of registry.services || []) {
    const prefix = envPrefix(service.id);

    // Port
    if (service.port) {
      derived[`${prefix}_PORT`] = String(service.port);
    }

    // URL — auto-construct if not explicitly overridden in .env
    const urlKey = `${prefix}_URL`;
    if (!secrets[urlKey] && service.port) {
      derived[urlKey] = `http://${host}:${service.port}`;
    }

    // Database name
    if (service.db) {
      derived[`${prefix}_MONGO_DB_NAME`] = service.db;
    }

    // MinIO bucket name (single string only; arrays use custom env var naming)
    if (service.minioBucket && typeof service.minioBucket === "string") {
      derived[`${prefix}_MINIO_BUCKET_NAME`] = service.minioBucket;
    }
  }

  return derived;
}

// ── Express App ────────────────────────────────────────────────
const app = express();

// ── Auth Middleware ────────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }

  if (header.slice(7) !== BEARER_TOKEN) {
    return res.status(403).json({ error: "Invalid bearer token" });
  }

  next();
}

// ── Routes ─────────────────────────────────────────────────────

/**
 * GET /health
 * Public — no auth required.
 */
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "vault",
    secretCount: Object.keys(secrets).length,
    serviceCount: registry.services?.length || 0,
    lastLoadedAt,
    registryLoadedAt,
    uptime: Math.floor(process.uptime()),
  });
});

/**
 * GET /secrets
 *
 * Query params (all optional, combinable):
 *   ?keys=KEY1,KEY2      — return only these specific keys
 *   ?prefix=PRISM_       — return keys starting with this prefix
 *   ?exclude=VAULT_,CI_  — exclude keys matching these prefixes
 *
 * Returns: JSON object of { KEY: "value" } pairs.
 */
app.get("/secrets", requireAuth, (req, res) => {
  const { keys, prefix, exclude } = req.query;

  // Start with registry-derived values as the base layer (lowest priority),
  // then layer .env secrets on top (explicit values always win).
  const registryDerived = deriveRegistrySecrets();
  let result = { ...registryDerived, ...secrets };

  // Filter by specific keys
  if (keys) {
    const keyList = keys.split(",").map((k) => k.trim());
    const filtered = {};

    for (const key of keyList) {
      if (result[key] !== undefined) {
        filtered[key] = result[key];
      }
    }

    result = filtered;
  }

  // Filter by prefix
  if (prefix) {
    const prefixes = prefix.split(",").map((p) => p.trim());
    const filtered = {};

    for (const [key, value] of Object.entries(result)) {
      if (prefixes.some((p) => key.startsWith(p))) {
        filtered[key] = value;
      }
    }

    result = filtered;
  }

  // Exclude by prefix
  if (exclude) {
    const excludePrefixes = exclude.split(",").map((p) => p.trim());

    for (const key of Object.keys(result)) {
      if (excludePrefixes.some((p) => key.startsWith(p))) {
        delete result[key];
      }
    }
  }

  res.json(result);
});

/**
 * POST /reload
 * Force-reload the .env file without waiting for the watcher.
 */
app.post("/reload", requireAuth, (_req, res) => {
  loadSecrets();
  loadRegistry();
  res.json({
    status: "reloaded",
    secretCount: Object.keys(secrets).length,
    serviceCount: registry.services?.length || 0,
    lastLoadedAt,
    registryLoadedAt,
  });
});

/**
 * GET /keys
 * Returns the list of available secret key names (not values).
 * Includes both .env keys and registry-derived keys.
 * Useful for debugging and client bootstrapping.
 */
app.get("/keys", requireAuth, (_req, res) => {
  const registryDerived = deriveRegistrySecrets();
  const merged = { ...registryDerived, ...secrets };
  res.json(Object.keys(merged));
});


// ── Registry Routes ────────────────────────────────────────────

/**
 * GET /registry
 * Returns the full infrastructure manifest with URLs resolved
 * from the loaded secrets. This is the single source of truth
 * for service topology, ports, and dependency graphs.
 *
 * Query params (optional):
 *   ?resolve=false   — skip URL enrichment, return raw manifest
 */
app.get("/registry", requireAuth, (req, res) => {
  const shouldResolve = req.query.resolve !== "false";

  const result = {
    version: registry.version,
    services: shouldResolve
      ? (registry.services || []).map(enrichService)
      : (registry.services || []),
    infrastructure: shouldResolve
      ? (registry.infrastructure || []).map(enrichInfrastructure)
      : (registry.infrastructure || []),
    devices: registry.devices || [],
  };

  res.json(result);
});

/**
 * GET /registry/services
 * Returns the services array, optionally filtered.
 *
 * Query params (all optional, combinable):
 *   ?id=prism-service       — return only this service
 *   ?type=client            — filter by type (service, client, bot, infra)
 *   ?deployTier=1           — filter by deploy tier
 *   ?resolve=false          — skip URL enrichment
 */
app.get("/registry/services", requireAuth, (req, res) => {
  const { id, type, deployTier, resolve: shouldResolveParam } = req.query;
  const shouldResolve = shouldResolveParam !== "false";

  let services = registry.services || [];

  if (id) {
    services = services.filter((s) => s.id === id);
  }

  if (type) {
    const types = type.split(",").map((t) => t.trim());
    services = services.filter((s) => types.includes(s.type));
  }

  if (deployTier !== undefined) {
    const tier = parseInt(deployTier, 10);
    services = services.filter((s) => s.deployTier === tier);
  }

  if (shouldResolve) {
    services = services.map(enrichService);
  }

  res.json(services);
});

/**
 * GET /registry/services/:id
 * Returns a single service by ID with its URL resolved.
 */
app.get("/registry/services/:id", requireAuth, (req, res) => {
  const service = (registry.services || []).find((s) => s.id === req.params.id);

  if (!service) {
    return res.status(404).json({ error: `Service "${req.params.id}" not found` });
  }

  const shouldResolve = req.query.resolve !== "false";
  res.json(shouldResolve ? enrichService(service) : service);
});

/**
 * GET /registry/infrastructure
 * Returns the infrastructure entries (databases, object stores, etc.)
 * with URLs resolved from the secrets store.
 */
app.get("/registry/infrastructure", requireAuth, (req, res) => {
  const shouldResolve = req.query.resolve !== "false";
  const infra = registry.infrastructure || [];

  res.json(shouldResolve ? infra.map(enrichInfrastructure) : infra);
});

// ── Start Server ───────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║                                                          ║");
  console.log(`║  🔐  Vault listening on port ${String(PORT).padEnd(28)}║`);
  console.log(`║  📄  Serving ${String(Object.keys(secrets).length).padEnd(3)} secrets from master .env             ║`);
  console.log(`║  📋  Registry: ${String((registry.services || []).length).padEnd(3)} services, ${String((registry.infrastructure || []).length).padEnd(1)} infrastructure, ${String((registry.devices || []).length).padEnd(1)} devices  ║`);
  console.log("║  🔑  Bearer token loaded from vault.key                  ║");
  console.log("║  👁️   Watching .env + services.json for live changes      ║");
  console.log("║                                                          ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log("");
});
